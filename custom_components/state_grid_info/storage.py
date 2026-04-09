"""Persistent history storage for State Grid Info integration.

设计原则：
- StateGridStorage 是所有账户历史数据的唯一真相源。
- 不直接暴露实体，不直接操作 MQTT。
- 提供原子读写、历史合并、派生汇总、统计游标接口。
- 由 coordinator 调用；sensor 只读取 coordinator 的运行时快照。
"""
import logging
from calendar import monthrange
from datetime import date, datetime, timedelta
from typing import Any, Optional

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

_LOGGER = logging.getLogger(__name__)

STORAGE_KEY = "state_grid_info_history"
STORAGE_VERSION = 1

# 保留最近 N 年的日数据；月年数据全量保留
DAILY_RETENTION_YEARS = 5


class StateGridStorage:
    """统一管理所有配置户号的历史日/月/年数据及统计游标。"""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._data: dict[str, Any] = {}

    # ------------------------------------------------------------------
    # 基础 I/O
    # ------------------------------------------------------------------

    async def async_load(self) -> None:
        """从 .storage 加载数据，如有版本变更则迁移。"""
        stored = await self._store.async_load()
        if stored is None:
            self._data = {"version": STORAGE_VERSION, "accounts": {}}
        else:
            self._data = stored
            await self._async_migrate()

    async def async_save(self) -> None:
        """将当前内存数据持久化到 .storage。"""
        await self._store.async_save(self._data)

    async def _async_migrate(self) -> None:
        """处理存储格式迁移，当前保留空实现。"""
        version = self._data.get("version", 1)
        if version == STORAGE_VERSION:
            return
        # 后续版本升级在此添加迁移函数
        self._data["version"] = STORAGE_VERSION
        await self.async_save()

    # ------------------------------------------------------------------
    # 账户结构管理
    # ------------------------------------------------------------------

    def _ensure_account(self, consumer_number: str) -> dict:
        """确保账户结构存在，不存在则初始化。"""
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
                    "schema_version": 1,
                },
                "daily": {},    # {"2026-03-18": {...}}
                "monthly": {},  # {"2026-03": {...}}
                "yearly": {},   # {"2026": {...}}
                "source_monthly": {},
                "source_yearly": {},
                "statistics": {},
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

        for rec in records:
            day = rec.get("day")
            if not day:
                continue

            incoming: dict[str, Any] = {
                "day": day,
                "dayEleNum": float(rec.get("dayEleNum", 0)),
                "dayTPq": float(rec.get("dayTPq", 0)),
                "dayPPq": float(rec.get("dayPPq", 0)),
                "dayNPq": float(rec.get("dayNPq", 0)),
                "dayVPq": float(rec.get("dayVPq", 0)),
                "official": bool(rec.get("official", False)),
                "source_updated_at": rec.get("source_updated_at", now_iso),
            }
            # 保留上游已算好的 dayEleCost（如 HassBox）
            if "dayEleCost" in rec:
                incoming["dayEleCost"] = float(rec["dayEleCost"])

            existing = daily.get(day)
            if existing is None:
                daily[day] = incoming
            else:
                daily[day] = self._merge_day_record(existing, incoming)

        # 更新 meta 字段（仅覆盖非 None 值）
        if meta:
            acct_meta = account["meta"]
            for k, v in meta.items():
                if v is not None:
                    acct_meta[k] = v

        # 清理超过保留窗口的日数据
        cutoff = (date.today() - timedelta(days=DAILY_RETENTION_YEARS * 365)).isoformat()
        account["daily"] = {k: v for k, v in daily.items() if k >= cutoff}

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
                "monthEleNum": float(rec.get("monthEleNum", 0)),
                "monthEleCost": float(rec.get("monthEleCost", 0)),
                "monthTPq": float(rec.get("monthTPq", 0)),
                "monthPPq": float(rec.get("monthPPq", 0)),
                "monthNPq": float(rec.get("monthNPq", 0)),
                "monthVPq": float(rec.get("monthVPq", 0)),
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
                "yearEleNum": float(rec.get("yearEleNum", 0)),
                "yearEleCost": float(rec.get("yearEleCost", 0)),
                "yearTPq": float(rec.get("yearTPq", 0)),
                "yearPPq": float(rec.get("yearPPq", 0)),
                "yearNPq": float(rec.get("yearNPq", 0)),
                "yearVPq": float(rec.get("yearVPq", 0)),
                "source_updated_at": rec.get("source_updated_at", now_iso),
            }

            existing = source_yearly.get(year)
            if not existing or incoming["source_updated_at"] >= existing.get("source_updated_at", ""):
                source_yearly[year] = incoming

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
        account = self._ensure_account(consumer_number)
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
        account = self._ensure_account(consumer_number)
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

    async def async_get_runtime_snapshot(self, consumer_number: str) -> dict:
        """构建 coordinator 向实体暴露的运行时快照（UI 裁剪视图）。

        - daylist：最近 70 天，降序
        - monthlist：最近 24 个月，降序
        - yearlist：全部年份，降序
        - overview 字段供 Overview Sensor 使用
        - energy/cost 字段供能源类 sensor 使用
        """
        account = self._ensure_account(consumer_number)
        meta = account["meta"]
        daily = account["daily"]
        monthly = account["monthly"]
        yearly = account["yearly"]

        sorted_days = sorted(daily.values(), key=lambda x: x["day"], reverse=True)
        daylist = sorted_days[:70]

        sorted_months = sorted(monthly.values(), key=lambda x: x["month"], reverse=True)
        monthlist = sorted_months[:24]

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
