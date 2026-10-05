"""Persistent history storage for State Grid Info integration.

设计原则：
- StateGridStorage 是所有账户历史数据的唯一真相源。
- 不直接暴露实体，不直接操作 MQTT。
- 提供原子读写、历史合并、派生汇总、统计游标接口。
- 由 coordinator 调用；sensor 只读取 coordinator 的运行时快照。

存储载体（沿用 4.2 版的格式与位置，不做迁移）：
- 每个户号一个 JSON 文件：``<config>/state_grid_info_<户号>.json``
- 顶层键沿用 4.2 版的命名与含义：
    ``date`` / ``balance`` / ``consumer_name`` / ``dayList`` / ``monthList`` /
    ``yearList`` / ``totalEleNum`` / ``rechargeList``
  ``dayList`` / ``monthList`` / ``yearList`` 依旧是「按 day / month / year 去重、
  最新在前」的列表，元素字段名（dayEleNum / monthEleNum / yearEleNum ...）也与
  4.2 版完全一致。
- 本版本只在上面「追加」若干附加键，不重命名、不搬位置。旧文件缺失这些键时按
  默认值处理；旧版本读到本文件写出的内容也会直接忽略它们。因此新旧格式可以互相
  读取，老用户升级不会丢历史数据：
    ``source``            数据源标记
    ``last_official_day`` 最后一条官方结算日
    ``sourceMonthly``     抓取到的原始月账单（融合来源，非最终值）
    ``sourceYearly``      抓取到的原始年账单
    ``statistics``        长期统计导入游标
  另外 ``dayList`` 元素上追加 ``official`` / ``source_updated_at`` 两个字段，
  用于跨重启的可信度比较。
- 内存结构仍是重构版的三级账本（daily / monthly / yearly + source_* +
  statistics + meta），读写时与上述扁平格式互相转换。
"""

import json
import logging
import os
from calendar import monthrange
from datetime import date, datetime
from typing import Any, Optional

from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

STORAGE_SCHEMA_VERSION = 1

# 日/月/年数据均全量保留，不做时间窗口裁剪。
# （原 DAILY_RETENTION_YEARS = 5 的清理逻辑已移除，避免静默删除历史日数据）

# 扁平格式中的列表字段定义（与 4.2 版一致）
_DAY_FIELDS = ("day", "dayEleNum", "dayEleCost", "dayTPq", "dayPPq", "dayNPq", "dayVPq")
_MONTH_FIELDS = ("month", "monthEleNum", "monthEleCost", "monthTPq", "monthPPq", "monthNPq", "monthVPq")
_YEAR_FIELDS = ("year", "yearEleNum", "yearEleCost", "yearTPq", "yearPPq", "yearNPq", "yearVPq")

# 由本类自己管理的顶层键；其余键（如 4.2 版的 totalEleNum）原样透传，避免丢数据
_MANAGED_FLAT_KEYS = {
    "date",
    "balance",
    "consumer_name",
    "dayList",
    "monthList",
    "yearList",
    "rechargeList",
    "source",
    "last_official_day",
    "sourceMonthly",
    "sourceYearly",
    "statistics",
}


def _is_day_all_zero(item) -> bool:
    """判断单条日用电数据是否全为 0（日用电量、电费、尖峰平谷各段均为 0）。"""
    if not isinstance(item, dict):
        return False
    return (
        item.get("dayEleNum", 0) == 0
        and item.get("dayEleCost", 0) == 0
        and item.get("dayTPq", 0) == 0
        and item.get("dayPPq", 0) == 0
        and item.get("dayNPq", 0) == 0
        and item.get("dayVPq", 0) == 0
    )


def _is_placeholder_day(item) -> bool:
    """判断一条日记录是否为数据源的「占位条目」。

    青龙脚本等数据源会把「当月完整日历」一次性推送过来，其中：

    - **晚于今天的日期**：各项均为 0，纯粹是占位，永远不会是真实读数；
    - **今天的日期**：日结算尚未完成（次日才出数），同样是全 0 占位。

    这两类条目没有统计与展示意义，一旦进入账本就会表现为「月底一堆 0 值
    日期」，并污染实体属性 daylist。故在入口丢弃、在出口兜底过滤。

    注意与 :func:`_is_day_all_zero` 的区别：后者只判数值全 0，本函数还结合了
    日期。判断"今天是否有真实数据"要看数值，因此今天必须全 0 才算占位 ——
    若数据源在当天提供了真实用电量，仍会正常保留。

    本函数管不到「已过去但尚未结算」的全 0 日（如 10-02 时数据源给出的 10-01
    仍是 0）。这类条目只能在列表层面识别（它们紧挨最新端），由
    :func:`_visible_day_list` 统一剔除，切勿在此处按"过去 N 天"硬编码窗口 ——
    那会误伤真实的零用电日。
    """
    if not isinstance(item, dict):
        return False
    day = item.get("day")
    if not day:
        return False
    try:
        day_date = date.fromisoformat(str(day))
    except (TypeError, ValueError):
        return False

    today = date.today()
    if day_date > today:
        return True
    return day_date == today and _is_day_all_zero(item)


def _trim_consecutive_zero_days(day_list: list) -> list:
    """删除 dayList 首尾连续的全 0 日数据，保留中间有效区段。

    dayList 约定为「最新日期在前」。国网日用电列表在月初/月末常出现连续全 0
    （未来占位日、未抄表日），这些条目无统计与展示意义。参照 state_grid_app
    的 recent_30_daily_ele_list 处理，剔除首尾连续全 0 的天数：

    - 首部连续全 0：最新端（如当月尚未到的未来日 ``2026-09-30``）连续为 0 → 删除；
    - 尾部连续全 0：最旧端（如开户前）连续为 0 → 删除。

    只影响「对外输出」（写文件与实体属性），内存账本不受影响 —— 未结算日的
    记录仍留在账本里，等数据源补上真实数值后自动转为可见。
    """
    if not day_list:
        return day_list
    n = len(day_list)
    lead = 0
    while lead < n and _is_day_all_zero(day_list[lead]):
        lead += 1
    if lead == n:
        # 全部为 0，返回空列表
        return []
    tail = n - 1
    while tail > lead and _is_day_all_zero(day_list[tail]):
        tail -= 1
    if lead == 0 and tail == n - 1:
        return day_list
    return day_list[lead : tail + 1]


def _visible_day_list(records) -> list:
    """把账本中的日记录整理成「对外可见」的列表（最新在前）。

    统一三处口径：持久化文件 dayList、coordinator.data["dayList"]、
    实体属性 daylist。三者必须完全一致，否则会出现「文件里没有、实体属性里有」
    的鬼数据（真实踩过：数据源按整月日历推送，10-01 这种尚未结算的日子全是 0，
    只按 :func:`_is_placeholder_day` 过滤时它不算占位日，于是写进账本并被实体属性
    暴露，而写文件时又被 :func:`_trim_consecutive_zero_days` 干掉）。

    规则：
    1. 按 day 降序；
    2. 剔除占位日（晚于今天 / 今天尚未结算的全 0）；
    3. 剔除最新端（以及最旧端）连续的全 0 日 —— 未结算日通常紧邻最新端。
    """
    ordered = sorted(records, key=lambda x: str(x.get("day", "")), reverse=True)
    return _trim_consecutive_zero_days(
        [item for item in ordered if not _is_placeholder_day(item)]
    )


class StateGridStorage:
    """统一管理单个户号的历史日/月/年数据及统计游标。

    4.2 版起一个配置项对应一个户号、一个独立 JSON 文件，因此本类实例与户号
    一一对应；内部仍保留 accounts 包装（键即该户号），以便 coordinator 与
    statistics 的取数方式保持不变。
    """

    def __init__(self, hass: HomeAssistant, consumer_number: str) -> None:
        self._hass = hass
        self._consumer_number = str(consumer_number)
        self._file_path = hass.config.path(f"state_grid_info_{self._consumer_number}.json")
        self._data: dict[str, Any] = {
            "version": STORAGE_SCHEMA_VERSION,
            "accounts": {},
        }
        # 非本类管理的顶层键（例如 4.2 版的 totalEleNum）原样保留
        self._passthrough: dict[str, Any] = {}

    # ------------------------------------------------------------------
    # 基础 I/O
    # ------------------------------------------------------------------

    @property
    def file_path(self) -> str:
        """返回该户号对应的 JSON 文件路径。"""
        return self._file_path

    @property
    def data(self) -> dict[str, Any]:
        """以 4.2 版的扁平字典形式返回当前数据（只读用途）。"""
        return self._account_to_flat(self._ensure_account(self._consumer_number))

    async def async_load(self) -> None:
        """从 JSON 文件加载数据（旧的扁平格式直接映射到三级账本）。"""
        await self._hass.async_add_executor_job(self._load_sync)

    def _load_sync(self) -> None:
        raw: dict[str, Any] = {}
        try:
            if os.path.exists(self._file_path):
                with open(self._file_path, "r", encoding="utf-8") as f:
                    raw = json.load(f) or {}
                _LOGGER.info(
                    "已加载持久化数据: %s (dayList=%d条, monthList=%d条, yearList=%d条)",
                    self._file_path,
                    len(raw.get("dayList") or []),
                    len(raw.get("monthList") or []),
                    len(raw.get("yearList") or []),
                )
            else:
                _LOGGER.info("持久化文件不存在，初始化空账本: %s", self._file_path)
        except (json.JSONDecodeError, OSError) as ex:
            _LOGGER.error("加载持久化数据失败，将从空账本开始: %s", ex)
            raw = {}

        self._passthrough = {
            k: v for k, v in raw.items() if k not in _MANAGED_FLAT_KEYS
        }
        self._data = {
            "version": STORAGE_SCHEMA_VERSION,
            "accounts": {self._consumer_number: self._account_from_flat(raw)},
        }

    async def async_save(self) -> None:
        """把内存账本写回 4.2 版格式的 JSON 文件。"""
        await self._hass.async_add_executor_job(self._save_sync)

    def _save_sync(self) -> None:
        account = self._ensure_account(self._consumer_number)

        # 落盘前先把「文件里有、内存账本里没有」的日记录并回内存，再重建月/年汇总。
        #
        # 背景：本 JSON 由集成整份覆写（定时刷新、卸载/重载、新数据到达时都会 save）。
        # 若外部直接往文件里补写历史日数据（脚本回填），内存里的账本还是旧的一份，
        # 下一次 save 就会把补写内容整段抹掉 —— 表现为「一重载集成，补的历史就没了」。
        # 卸载流程 async_unload() 里的那次 save 尤其致命：它在重载的读取动作之前执行。
        # 这里的合并沿用 _merge_day_record 的优先级，只增不删，符合本文件
        # 「日数据全量保留、不静默丢数据」的口径。
        if self._merge_disk_daily_records(account):
            self._rebuild_monthly_sync(account)
            self._rebuild_yearly_sync(account)

        flat = self._account_to_flat(account)
        try:
            with open(self._file_path, "w", encoding="utf-8") as f:
                json.dump(flat, f, ensure_ascii=False, indent=2)
            _LOGGER.debug("已保存持久化数据: %s", self._file_path)
        except OSError as ex:
            _LOGGER.error("保存持久化数据失败: %s", ex)

    def _merge_disk_daily_records(self, account: dict[str, Any]) -> bool:
        """把持久化文件中内存账本还不认识的日记录合并进内存，返回是否有变化。

        只做「新增日」与「同日择优」，不会删除内存中的任何记录；读取失败时
        直接放弃合并（宁可按原样保存，也不冒风险污染账本）。
        """
        try:
            if not os.path.exists(self._file_path):
                return False
            with open(self._file_path, "r", encoding="utf-8") as f:
                raw = json.load(f) or {}
        except (json.JSONDecodeError, OSError) as ex:
            _LOGGER.warning("保存前读取持久化数据失败，跳过磁盘合并: %s", ex)
            return False

        if not isinstance(raw, dict):
            return False

        disk_daily = self._account_from_flat(raw).get("daily") or {}
        daily = account["daily"]
        changed = False

        for day, disk_rec in disk_daily.items():
            existing = daily.get(day)
            if existing is None:
                daily[day] = disk_rec
                changed = True
                continue
            merged = self._merge_day_record(existing, disk_rec)
            if merged is not existing:
                daily[day] = merged
                changed = True

        if changed:
            _LOGGER.info(
                "保存前合并了持久化文件中的历史日记录（户号 %s，合并后共 %d 天）",
                self._consumer_number,
                len(daily),
            )
        return changed

    # ------------------------------------------------------------------
    # 扁平格式 <-> 三级账本
    # ------------------------------------------------------------------

    def _account_from_flat(self, raw: dict[str, Any]) -> dict[str, Any]:
        """把 4.2 版的扁平字典转换为内部账户结构。"""
        daily: dict[str, dict[str, Any]] = {}
        for item in raw.get("dayList") or []:
            if not isinstance(item, dict):
                continue
            day = str(item.get("day") or "")
            if not day:
                continue
            record: dict[str, Any] = {"day": day}
            for field in _DAY_FIELDS:
                if field == "day":
                    continue
                record[field] = self._to_float(item.get(field))
            # 4.2 版文件没有这两个字段：老数据一律来自官方账单，因此视为 official。
            # 否则升级后 statistics.py 会把全部历史日数据判为不可信而不回填能源面板。
            record["official"] = bool(item.get("official", True))
            record["source_updated_at"] = str(item.get("source_updated_at") or "")
            daily[day] = record

        def _load_list(fields: tuple[str, ...], key: str, items: Any) -> dict[str, dict[str, Any]]:
            records: dict[str, dict[str, Any]] = {}
            for item in items or []:
                if not isinstance(item, dict):
                    continue
                record_key = str(item.get(key) or "")
                if not record_key:
                    continue
                record: dict[str, Any] = {key: record_key}
                for field in fields:
                    if field == key:
                        continue
                    record[field] = self._to_float(item.get(field))
                if item.get("source_updated_at"):
                    record["source_updated_at"] = str(item["source_updated_at"])
                records[record_key] = record
            return records

        meta = {
            "consumer_number": self._consumer_number,
            "consumer_name": str(raw.get("consumer_name") or ""),
            "source": str(raw.get("source") or ""),
            "last_payload_at": str(raw.get("date") or ""),
            "last_official_day": str(raw.get("last_official_day") or ""),
            "last_balance": self._to_float(raw.get("balance")),
            "schema_version": STORAGE_SCHEMA_VERSION,
        }

        recharge = raw.get("rechargeList")
        statistics = raw.get("statistics")

        return {
            "meta": meta,
            "daily": daily,
            "monthly": _load_list(_MONTH_FIELDS, "month", raw.get("monthList")),
            "yearly": _load_list(_YEAR_FIELDS, "year", raw.get("yearList")),
            "source_monthly": _load_list(_MONTH_FIELDS, "month", raw.get("sourceMonthly")),
            "source_yearly": _load_list(_YEAR_FIELDS, "year", raw.get("sourceYearly")),
            "statistics": dict(statistics) if isinstance(statistics, dict) else {},
            "recharge": list(recharge) if isinstance(recharge, list) else [],
        }

    def _account_to_flat(self, account: dict[str, Any]) -> dict[str, Any]:
        """把内部账户结构转换回 4.2 版的扁平字典。"""
        meta = account.get("meta", {})

        day_list: list[dict[str, Any]] = []
        for record in sorted(
            account.get("daily", {}).values(), key=lambda x: x.get("day", ""), reverse=True
        ):
            item: dict[str, Any] = {"day": record.get("day", "")}
            for field in _DAY_FIELDS:
                if field == "day":
                    continue
                item[field] = self._to_float(record.get(field))
            item["official"] = bool(record.get("official", False))
            item["source_updated_at"] = record.get("source_updated_at", "")
            day_list.append(item)

        flat: dict[str, Any] = dict(self._passthrough)
        flat["date"] = meta.get("last_payload_at", "")
        flat["balance"] = meta.get("last_balance", 0.0)
        flat["consumer_name"] = meta.get("consumer_name", "")
        flat["dayList"] = _visible_day_list(day_list)
        flat["monthList"] = self._export_list(account.get("monthly", {}), _MONTH_FIELDS, "month")
        flat["yearList"] = self._export_list(account.get("yearly", {}), _YEAR_FIELDS, "year")
        flat["rechargeList"] = account.get("recharge", [])
        flat["source"] = meta.get("source", "")
        flat["last_official_day"] = meta.get("last_official_day", "")
        flat["sourceMonthly"] = self._export_list(
            account.get("source_monthly", {}), _MONTH_FIELDS, "month"
        )
        flat["sourceYearly"] = self._export_list(
            account.get("source_yearly", {}), _YEAR_FIELDS, "year"
        )
        flat["statistics"] = account.get("statistics", {})
        return flat

    @staticmethod
    def _export_list(
        records: dict[str, dict[str, Any]], fields: tuple[str, ...], key: str
    ) -> list[dict[str, Any]]:
        """把 {key: record} 字典导出为「最新在前」的列表。"""
        exported: list[dict[str, Any]] = []
        for record in sorted(
            records.values(), key=lambda x: str(x.get(key, "")), reverse=True
        ):
            item: dict[str, Any] = {key: str(record.get(key, ""))}
            for field in fields:
                if field == key:
                    continue
                item[field] = StateGridStorage._to_float(record.get(field))
            if record.get("source_updated_at"):
                item["source_updated_at"] = record["source_updated_at"]
            exported.append(item)
        return exported

    @staticmethod
    def _to_float(raw: Any) -> float:
        """宽松转 float，非法值按 0 处理（旧文件里可能存在 "-"）。"""
        if raw in (None, "", "-"):
            return 0.0
        try:
            return float(raw)
        except (TypeError, ValueError):
            return 0.0

    # ------------------------------------------------------------------
    # 账户结构管理
    # ------------------------------------------------------------------

    def _ensure_account(self, consumer_number: str) -> dict:
        """确保账户结构存在，不存在则初始化。"""
        consumer_number = str(consumer_number or self._consumer_number)
        accounts = self._data.setdefault("accounts", {})
        if consumer_number not in accounts:
            accounts[consumer_number] = {
                "meta": {
                    "consumer_number": consumer_number,
                    "consumer_name": "",
                    "source": "",
                    "last_payload_at": "",
                    "last_official_day": "",
                    "last_balance": 0.0,
                    "schema_version": STORAGE_SCHEMA_VERSION,
                },
                "daily": {},          # {"2026-03-18": {...}}
                "monthly": {},        # {"2026-03": {...}}
                "yearly": {},         # {"2026": {...}}
                "source_monthly": {}, # 抓取到的原始月账单
                "source_yearly": {},  # 抓取到的原始年账单
                "statistics": {},     # 长期统计导入游标
                "recharge": [],       # 充值记录（网上国网 App 数据源）
            }
        return accounts[consumer_number]

    async def async_get_account(self, consumer_number: str) -> dict:
        """返回账户数据字典（可变引用）。"""
        return self._ensure_account(consumer_number)

    # ------------------------------------------------------------------
    # 历史合并
    # ------------------------------------------------------------------

    async def async_merge_daily_records(
        self,
        consumer_number: str,
        records: list[dict],
        meta: Optional[dict] = None,
    ) -> None:
        """将来自数据源的日记录增量合并到存储中。

        合并优先级（由高到低）：
        1. official=True 优先于非 official
        2. 分时字段填充更完整的优先（非零字段数量）
        3. source_updated_at 更新的优先
        4. dayEleNum 更大的优先（最终兜底）
        """
        account = self._ensure_account(consumer_number)
        daily = account["daily"]
        now_iso = datetime.now().astimezone().isoformat()
        dropped_placeholder = 0

        for rec in records:
            day = rec.get("day")
            if not day:
                continue

            # 占位条目（未来日期、或今天尚未结算的全 0 记录）不是真实抄表数据，
            # 直接丢弃，避免污染实体属性与月度汇总。
            if _is_placeholder_day(rec):
                dropped_placeholder += 1
                continue

            incoming: dict[str, Any] = {
                "day": day,
                "dayEleNum": float(rec.get("dayEleNum", 0) or 0),
                "dayTPq": float(rec.get("dayTPq", 0) or 0),
                "dayPPq": float(rec.get("dayPPq", 0) or 0),
                "dayNPq": float(rec.get("dayNPq", 0) or 0),
                "dayVPq": float(rec.get("dayVPq", 0) or 0),
                "official": bool(rec.get("official", False)),
                "source_updated_at": rec.get("source_updated_at", now_iso),
            }
            # 保留上游已算好的 dayEleCost（如 HassBox）
            if "dayEleCost" in rec:
                incoming["dayEleCost"] = float(rec["dayEleCost"] or 0)

            existing = daily.get(day)
            if existing is None:
                daily[day] = incoming
            else:
                daily[day] = self._merge_day_record(existing, incoming)

        if dropped_placeholder:
            _LOGGER.debug(
                "已丢弃 %s 条占位日数据（未来日期 / 今天尚未结算，户号 %s）",
                dropped_placeholder,
                consumer_number,
            )

        # 顺带清理账本中历史遗留的占位日（旧版本曾把未来日期直接写入账本）。
        # 只对「日期不早于今天」的键做判断，正常情况下只有 0~1 个，开销可忽略。
        today_str = date.today().isoformat()
        stale_days = [
            d for d in list(daily) if d >= today_str and _is_placeholder_day(daily[d])
        ]
        for d in stale_days:
            daily.pop(d, None)
        if stale_days:
            _LOGGER.debug(
                "已清理 %s 条历史遗留的占位日数据（户号 %s）", len(stale_days), consumer_number
            )

        # 更新 meta 字段（仅覆盖非 None 值）
        if meta:
            acct_meta = account["meta"]
            for k, v in meta.items():
                if v is not None:
                    acct_meta[k] = v

        # 不做时间窗口裁剪：日数据全量保留。
        # 原逻辑此处会删除超过 DAILY_RETENTION_YEARS 年的日数据，属静默丢数据。
        # （daily 是 account["daily"] 的引用，上面的增量合并已直接写入账本）

    async def async_merge_monthly_records(
        self,
        consumer_number: str,
        records: list[dict],
    ) -> None:
        """合并抓取到的月汇总；抓取值视为比计算值更可信。"""
        account = self._ensure_account(consumer_number)
        source_monthly = account.setdefault("source_monthly", {})
        now_iso = datetime.now().astimezone().isoformat()

        for rec in records:
            month = self._normalize_month_key(rec.get("month", ""))
            if not month:
                continue
            incoming = {
                "month": month,
                "monthEleNum": float(rec.get("monthEleNum", 0) or 0),
                "monthEleCost": float(rec.get("monthEleCost", 0) or 0),
                "monthTPq": float(rec.get("monthTPq", 0) or 0),
                "monthPPq": float(rec.get("monthPPq", 0) or 0),
                "monthNPq": float(rec.get("monthNPq", 0) or 0),
                "monthVPq": float(rec.get("monthVPq", 0) or 0),
                "source_updated_at": rec.get("source_updated_at", now_iso),
            }

            existing = source_monthly.get(month)
            if not existing or incoming["source_updated_at"] >= existing.get("source_updated_at", ""):
                source_monthly[month] = incoming

    async def async_merge_yearly_records(
        self,
        consumer_number: str,
        records: list[dict],
    ) -> None:
        """合并抓取到的年汇总；抓取值视为比计算值更可信。"""
        account = self._ensure_account(consumer_number)
        source_yearly = account.setdefault("source_yearly", {})
        now_iso = datetime.now().astimezone().isoformat()

        for rec in records:
            year = self._normalize_year_key(rec.get("year", ""))
            if not year:
                continue
            incoming = {
                "year": year,
                "yearEleNum": float(rec.get("yearEleNum", 0) or 0),
                "yearEleCost": float(rec.get("yearEleCost", 0) or 0),
                "yearTPq": float(rec.get("yearTPq", 0) or 0),
                "yearPPq": float(rec.get("yearPPq", 0) or 0),
                "yearNPq": float(rec.get("yearNPq", 0) or 0),
                "yearVPq": float(rec.get("yearVPq", 0) or 0),
                "source_updated_at": rec.get("source_updated_at", now_iso),
            }

            existing = source_yearly.get(year)
            if not existing or incoming["source_updated_at"] >= existing.get("source_updated_at", ""):
                source_yearly[year] = incoming

    async def async_merge_recharge_records(
        self,
        consumer_number: str,
        records: list[dict],
    ) -> None:
        """合并充值记录（网上国网 App 数据源提供）。

        按 (pay_date, amount, remark) 去重，始终按日期倒序。旧记录只增不删：
        刷新失败（本次没拿到列表）时保留既有记录，避免清空历史。
        """
        if not isinstance(records, list) or not records:
            return

        account = self._ensure_account(consumer_number)
        existing = account.get("recharge")
        if not isinstance(existing, list):
            existing = []

        seen: set[tuple] = set()
        merged: list[dict[str, Any]] = []
        for item in list(records) + existing:
            if not isinstance(item, dict):
                continue
            rkey = (item.get("pay_date"), item.get("amount"), item.get("remark"))
            if rkey in seen:
                continue
            seen.add(rkey)
            merged.append(item)
        merged.sort(key=lambda x: str(x.get("pay_date") or ""), reverse=True)
        account["recharge"] = merged

    @staticmethod
    def _normalize_month_key(month_raw: Any) -> str:
        """标准化月份到 YYYY-MM。"""
        month = str(month_raw or "").strip()
        if len(month) == 6 and month.isdigit():
            return f"{month[:4]}-{month[4:6]}"
        if len(month) >= 7 and month[4] == "-":
            return month[:7]
        return ""

    @staticmethod
    def _normalize_year_key(year_raw: Any) -> str:
        """标准化年份到 YYYY。"""
        year = str(year_raw or "").strip()
        if len(year) == 4 and year.isdigit():
            return year
        return ""

    @staticmethod
    def _merge_day_record(existing: dict, incoming: dict) -> dict:
        """从两条同日记录中返回更可信的一条。"""
        # 规则 1：official=True 优先
        if incoming.get("official") and not existing.get("official"):
            return incoming
        if existing.get("official") and not incoming.get("official"):
            return existing

        # 规则 2：分时字段填充更完整的优先
        def _filled(r: dict) -> int:
            return sum(1 for f in ("dayTPq", "dayPPq", "dayNPq", "dayVPq") if r.get(f, 0) > 0)

        inc_fill = _filled(incoming)
        ext_fill = _filled(existing)
        if inc_fill > ext_fill:
            return incoming
        if ext_fill > inc_fill:
            return existing

        # 规则 3：更新时间更晚的优先
        if incoming.get("source_updated_at", "") > existing.get("source_updated_at", ""):
            return incoming

        # 规则 4：电量更大（兜底）
        if incoming.get("dayEleNum", 0) > existing.get("dayEleNum", 0):
            return incoming

        return existing

    # ------------------------------------------------------------------
    # 派生汇总重建
    # ------------------------------------------------------------------

    async def async_rebuild_monthly(self, consumer_number: str) -> None:
        """从日数据重建月汇总（全量重算）。"""
        self._rebuild_monthly_sync(self._ensure_account(consumer_number))

    def _rebuild_monthly_sync(self, account: dict[str, Any]) -> None:
        """从日数据重建月汇总（全量重算），同步版本供保存流程复用。"""
        daily = account["daily"]
        calculated_monthly: dict[str, dict] = {}

        for day, rec in daily.items():
            ym = day[:7]  # YYYY-MM
            if ym not in calculated_monthly:
                calculated_monthly[ym] = {
                    "month": ym,
                    "monthEleNum": 0.0,
                    "monthEleCost": 0.0,
                    "monthTPq": 0.0,
                    "monthPPq": 0.0,
                    "monthNPq": 0.0,
                    "monthVPq": 0.0,
                }
            m = calculated_monthly[ym]
            m["monthEleNum"] += rec.get("dayEleNum", 0)
            m["monthEleCost"] += rec.get("dayEleCost", 0)
            m["monthTPq"] += rec.get("dayTPq", 0)
            m["monthPPq"] += rec.get("dayPPq", 0)
            m["monthNPq"] += rec.get("dayNPq", 0)
            m["monthVPq"] += rec.get("dayVPq", 0)

        for m in calculated_monthly.values():
            for k in ("monthEleNum", "monthEleCost", "monthTPq", "monthPPq", "monthNPq", "monthVPq"):
                m[k] = round(m[k], 2)

        # 抓取值优先：同月存在 source_monthly 时，以 source 字段覆盖计算字段。
        # 但当 source 字段为 0 时（未结账的当月），不覆盖计算值，避免丢失日汇总估算。
        source_monthly = account.get("source_monthly", {})
        resolved_monthly: dict[str, dict] = {}
        all_months = set(calculated_monthly.keys()) | set(source_monthly.keys())

        for month in all_months:
            calc = calculated_monthly.get(month, {})
            src = source_monthly.get(month, {})
            merged = {"month": month}
            merged.update(calc)
            # 仅当 source 值非零时才覆盖计算值（0 表示账单未出，不可信）
            for k in ("monthEleNum", "monthEleCost", "monthTPq", "monthPPq", "monthNPq", "monthVPq"):
                src_val = float(src.get(k, 0))
                if src_val != 0:
                    merged[k] = src_val
            # 保留 source 的元数据字段
            if "source_updated_at" in src:
                merged["source_updated_at"] = src["source_updated_at"]
            for k in ("monthEleNum", "monthEleCost", "monthTPq", "monthPPq", "monthNPq", "monthVPq"):
                merged[k] = round(float(merged.get(k, 0)), 2)
            resolved_monthly[month] = merged

        account["monthly"] = resolved_monthly

    async def async_rebuild_yearly(self, consumer_number: str) -> None:
        """从月汇总重建年汇总（全量重算）。"""
        self._rebuild_yearly_sync(self._ensure_account(consumer_number))

    def _rebuild_yearly_sync(self, account: dict[str, Any]) -> None:
        """从月汇总重建年汇总（全量重算），同步版本供保存流程复用。"""
        monthly = account["monthly"]
        calculated_yearly: dict[str, dict] = {}

        for ym, rec in monthly.items():
            yr = ym[:4]
            if yr not in calculated_yearly:
                calculated_yearly[yr] = {
                    "year": yr,
                    "yearEleNum": 0.0,
                    "yearEleCost": 0.0,
                    "yearTPq": 0.0,
                    "yearPPq": 0.0,
                    "yearNPq": 0.0,
                    "yearVPq": 0.0,
                }
            y = calculated_yearly[yr]
            y["yearEleNum"] += rec.get("monthEleNum", 0)
            y["yearEleCost"] += rec.get("monthEleCost", 0)
            y["yearTPq"] += rec.get("monthTPq", 0)
            y["yearPPq"] += rec.get("monthPPq", 0)
            y["yearNPq"] += rec.get("monthNPq", 0)
            y["yearVPq"] += rec.get("monthVPq", 0)

        for y in calculated_yearly.values():
            for k in ("yearEleNum", "yearEleCost", "yearTPq", "yearPPq", "yearNPq", "yearVPq"):
                y[k] = round(y[k], 2)

        # 对年汇总：source_yearly 可能来自已结算的历史年份，对当前开放年不含未结账月。
        # 取计算值与 source 值中较大的，确保当前年包含估算月费用。
        source_yearly = account.get("source_yearly", {})
        resolved_yearly: dict[str, dict] = {}
        all_years = set(calculated_yearly.keys()) | set(source_yearly.keys())

        for year in all_years:
            calc = calculated_yearly.get(year, {})
            src = source_yearly.get(year, {})
            merged = {"year": year}
            merged.update(calc)
            # 对电量和费用：取 max(calc, source)，避免 source 遗漏当前月导致数值偏低
            for k in ("yearEleNum", "yearEleCost", "yearTPq", "yearPPq", "yearNPq", "yearVPq"):
                src_val = float(src.get(k, 0))
                calc_val = float(calc.get(k, 0))
                if src_val > calc_val:
                    merged[k] = src_val
            # 保留 source 的元数据字段
            if "source_updated_at" in src:
                merged["source_updated_at"] = src["source_updated_at"]
            for k in ("yearEleNum", "yearEleCost", "yearTPq", "yearPPq", "yearNPq", "yearVPq"):
                merged[k] = round(float(merged.get(k, 0)), 2)
            resolved_yearly[year] = merged

        account["yearly"] = resolved_yearly

    # ------------------------------------------------------------------
    # 查询接口
    # ------------------------------------------------------------------

    def get_all_daily_sorted(self, consumer_number: str) -> list[dict]:
        """返回所有日记录，按日期升序（最旧在前）。

        供 coordinator 用于全账期阶梯计算和统计导入。
        """
        account = self._ensure_account(consumer_number)
        return sorted(account["daily"].values(), key=lambda x: x["day"])

    async def async_get_month_accumulated_kwh(self, consumer_number: str, target_day: str) -> float:
        """返回目标日所在月截至目标日的累计电量。

        规则：
        - 优先使用日数据。
        - 若当月无日数据且目标日正好是月末，则允许使用整月汇总值。
        - 若当月无日数据且目标日不是月末，则返回 0，不做比例估算。
        """
        target_date = datetime.strptime(target_day, "%Y-%m-%d").date()
        month_key = target_day[:7]
        account = self._ensure_account(consumer_number)
        daily = account.get("daily", {})
        monthly = account.get("monthly", {})

        total = 0.0
        has_daily = False
        for rec in daily.values():
            day = rec.get("day")
            if not day or not day.startswith(month_key):
                continue
            if day <= target_day:
                total += float(rec.get("dayEleNum", 0))
                has_daily = True

        if has_daily:
            return round(total, 2)

        month_total = float(monthly.get(month_key, {}).get("monthEleNum", 0))
        if month_total <= 0:
            return 0.0

        last_day = monthrange(target_date.year, target_date.month)[1]
        if target_date.day == last_day:
            return round(month_total, 2)
        return 0.0

    async def async_get_year_accumulated_kwh(
        self,
        consumer_number: str,
        target_day: str,
        year_ladder_start: str = "0101",
    ) -> float:
        """返回目标日所在年阶梯账期截至目标日的累计电量。

        规则：
        - 对目标月之前的完整月份，优先使用月汇总（已融合抓取优先规则）。
        - 若该月无月汇总，则回退日数据合计。
        - 对目标月，仅使用截至目标日的日数据，避免把未来日电量算入当前日。
        - 若目标月无日数据，则目标月贡献按 0 处理，不做比例估算。
        """
        target_date = datetime.strptime(target_day, "%Y-%m-%d").date()
        start_month = int(year_ladder_start[:2])
        start_day = int(year_ladder_start[2:])

        start_year = target_date.year
        if (target_date.month, target_date.day) < (start_month, start_day):
            start_year -= 1
        period_start = date(start_year, start_month, start_day)

        account = self._ensure_account(consumer_number)
        daily = account.get("daily", {})
        monthly = account.get("monthly", {})

        total = 0.0
        cursor = date(period_start.year, period_start.month, 1)
        target_month_begin = date(target_date.year, target_date.month, 1)

        while cursor <= target_month_begin:
            month_key = cursor.strftime("%Y-%m")
            if cursor.year == target_date.year and cursor.month == target_date.month:
                # 目标月只按日累计到目标日
                for rec in daily.values():
                    day = rec.get("day")
                    if not day:
                        continue
                    if day < period_start.isoformat() or day > target_day:
                        continue
                    if day.startswith(month_key):
                        total += float(rec.get("dayEleNum", 0))
                break

            month_total = float(monthly.get(month_key, {}).get("monthEleNum", 0))
            if month_total > 0:
                total += month_total
            else:
                for rec in daily.values():
                    day = rec.get("day")
                    if not day or not day.startswith(month_key):
                        continue
                    if day >= period_start.isoformat():
                        total += float(rec.get("dayEleNum", 0))

            if cursor.month == 12:
                cursor = date(cursor.year + 1, 1, 1)
            else:
                cursor = date(cursor.year, cursor.month + 1, 1)

        return round(total, 2)

    async def async_get_visible_daily_list(self, consumer_number: str) -> list[dict]:
        """返回可对外暴露的日数据列表（按日期降序，已剔除占位条目）。

        供运行时快照与 coordinator 取数共用，保证「实体属性」与「coordinator.data」
        对占位日的口径完全一致，且与持久化文件里的 dayList 逐条相同。
        """
        account = self._ensure_account(consumer_number)
        return _visible_day_list(account["daily"].values())

    async def async_get_runtime_snapshot(self, consumer_number: str) -> dict:
        """构建 coordinator 向实体暴露的运行时快照（全量视图，不做窗口截断）。

        - daylist：全部日数据，降序
        - monthlist：全部月份，降序
        - yearlist：全部年份，降序
        - overview 字段供 Overview Sensor 使用
        - energy/cost 字段供能源类 sensor 使用
        - last_month_ele_cost：上月电费（当前月之前最近一个月的账单金额）
        - rechargelist：充值记录（数据源提供时）

        注意：此处曾把 daylist 截断为最近 70 天、monthlist 截断为最近 24 个月，
        以避免状态属性过大；但状态属性一旦超过 16384 字节，Recorder 会直接丢弃
        整份属性不写库（日志报 "exceed maximum size of 16384 bytes"），截断并不能
        绕开该限制，反而让卡片拿不到完整历史。故改为全量返回。
        """
        account = self._ensure_account(consumer_number)
        meta = account["meta"]
        daily = account["daily"]
        monthly = account["monthly"]
        yearly = account["yearly"]

        # 兜底：账本中若残留占位记录（旧版本曾写入未来日期 / 未结算日），此处不再
        # 对外暴露。口径与持久化文件的 dayList 完全一致（_visible_day_list）。
        daylist = _visible_day_list(daily.values())
        monthlist = sorted(monthly.values(), key=lambda x: x["month"], reverse=True)

        yearlist = sorted(yearly.values(), key=lambda x: x["year"], reverse=True)

        now = datetime.now()
        current_month_str = now.strftime("%Y-%m")
        current_year_str = now.strftime("%Y")
        current_month_entry = monthly.get(current_month_str, {})

        # Compute current-year totals directly from monthly entries so that the
        # current (not-yet-billed) month's daily-accumulated kWh is always
        # included, even when source_yearly only covers completed months.
        current_year_kwh = round(sum(
            float(m.get("monthEleNum", 0))
            for ym, m in monthly.items()
            if ym.startswith(current_year_str)
        ), 2)
        current_year_cost = round(sum(
            float(m.get("monthEleCost", 0))
            for ym, m in monthly.items()
            if ym.startswith(current_year_str)
        ), 2)

        # Lifetime totals from monthly so the current month is never silently
        # omitted (source_yearly may not include it yet).
        total_energy = round(sum(float(m.get("monthEleNum", 0)) for m in monthly.values()), 2)
        total_cost = round(sum(float(m.get("monthEleCost", 0)) for m in monthly.values()), 2)

        # 上月电费：当前月之前最近一个月的账单金额（monthlist 已按月份降序）。
        # 预付费户号余额为 0 时，概览实体值改取该值（见 sensor.OverviewSensor）。
        last_month_ele_cost = 0.0
        for entry in monthlist:
            if str(entry.get("month", "")) < current_month_str:
                last_month_ele_cost = round(float(entry.get("monthEleCost", 0.0) or 0.0), 2)
                break

        # Flag used by the coordinator to decide whether to estimate cost.
        # True only when the source explicitly provided a non-zero billed cost
        # for the current month (i.e., the month has already been settled).
        source_monthly = account.get("source_monthly", {})
        current_month_has_official_cost = (
            float(source_monthly.get(current_month_str, {}).get("monthEleCost", 0)) > 0
        )

        return {
            "consumer_number": consumer_number,
            "consumer_name": meta.get("consumer_name", ""),
            "balance": meta.get("last_balance", 0.0),
            "last_month_ele_cost": last_month_ele_cost,
            "date": meta.get("last_payload_at", ""),
            "overview": {
                "daylist": daylist,
                "monthlist": monthlist,
                "yearlist": yearlist,
            },
            "energy": {
                "current_month_kwh": current_month_entry.get("monthEleNum", 0.0),
                "current_year_kwh": current_year_kwh,
                "total_energy_kwh": total_energy,
                "last_official_day": meta.get("last_official_day", ""),
                "current_month_has_official_cost": current_month_has_official_cost,
            },
            "cost": {
                "current_month_cost": current_month_entry.get("monthEleCost", 0.0),
                "current_year_cost": current_year_cost,
                "total_cost": total_cost,
            },
            "rechargelist": account.get("recharge", []),
        }

    # ------------------------------------------------------------------
    # 统计导入游标
    # ------------------------------------------------------------------

    async def async_mark_statistics_imported(
        self,
        consumer_number: str,
        stat_key: str,
        last_day: str,
        last_total: float,
    ) -> None:
        """在成功导入后推进统计游标。仅在确认导入成功后调用。"""
        account = self._ensure_account(consumer_number)
        stats = account.setdefault("statistics", {})
        stats.setdefault(stat_key, {})
        stats[stat_key]["last_imported_day"] = last_day
        stats[stat_key]["last_imported_total"] = last_total

    async def async_get_statistics_cursor(
        self,
        consumer_number: str,
        stat_key: str,
    ) -> dict:
        """返回指定统计键的导入游标，不存在时返回零值。"""
        account = self._ensure_account(consumer_number)
        stats = account.get("statistics", {})
        return stats.get(stat_key, {"last_imported_day": None, "last_imported_total": 0.0})
