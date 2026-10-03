"""Statistics backfill for 国家电网 (state_grid_info) integration.

把历史「日电量」与「日电费」按**实际发生日期**回填到 HA 长期统计，使能源面板
能显示完整的历史曲线（既有电量，也有成本），而不只是集成安装之后的数据。

设计要点：
- 两份统计各自一份游标（total_energy / total_cost），互不影响、可独立失败重试。
- 每天一条：sum = 累计到当天末的值，state = 当天的值。
  能源面板按 sum 的差分算每日消耗/每日成本，所以首日不会出现「从 0 跳到总额」的假尖峰。
- 幂等靠**两重**保证：
  1) 游标（last_imported_day / last_imported_total）只导入新数据；
  2) **基线自校验**：用当前 storage 重算「截至 last_imported_day 的累计值」，
     与游标里的 last_imported_total 不一致 → 说明历史被重算过（改电价、
     或上游修订了旧数据、或升级后补算了 dayEleCost），直接全量重导。
- 只导入 official=True 且距今至少 _STABILITY_DAYS 天的记录，避免次日修正被固化。
- 导入失败时不推进游标，下次刷新重试同一段完整数据。
- statistic_id 采用外部统计格式：
    state_grid_info:total_energy_<consumer_number>   电量（kWh）
    state_grid_info:total_cost_<consumer_number>     电费（元）
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from datetime import date, datetime, timedelta
from typing import TYPE_CHECKING, Any

from homeassistant.components.recorder.models import (
    StatisticData,
    StatisticMeanType,
    StatisticMetaData,
)
from homeassistant.components.recorder.statistics import async_add_external_statistics
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from .const import DOMAIN

if TYPE_CHECKING:
    from .storage import StateGridStorage

_LOGGER = logging.getLogger(__name__)

# Storage 内统计游标使用的键名
_STAT_KEY_TOTAL_ENERGY = "total_energy"
_STAT_KEY_TOTAL_COST = "total_cost"

# 官方数据稳定窗口：距今至少 N 天才认为该日数据不会被修正
_STABILITY_DAYS = 2

# 基线比对容差（浮点累加误差远小于此值）
_BASELINE_TOLERANCE = 0.01


def _statistic_id(consumer_number: str) -> str:
    """返回该用户的「累计用电」外部统计 ID（HA Energy 面板可直接选择）。"""
    return f"{DOMAIN}:total_energy_{consumer_number}"


def cost_statistic_id(consumer_number: str) -> str:
    """返回该用户的「累计电费」外部统计 ID（能源面板成本跟踪可直接选择）。"""
    return f"{DOMAIN}:total_cost_{consumer_number}"


def clean_series(records: Iterable[Any], value_field: str) -> list[tuple[str, float]]:
    """把日记录规范成 [(day, value)]。

    跳过：非 dict、缺 day、日期非法、值非法、值 <= 0。按日期升序返回。
    导入与基线自校验共用这一份清洗逻辑，保证两者口径完全一致。
    """
    series: list[tuple[str, float]] = []
    for record in records:
        if not isinstance(record, dict):
            continue
        day = record.get("day")
        if not day:
            continue
        day_str = str(day)

        try:
            date.fromisoformat(day_str)
        except ValueError:
            _LOGGER.debug("storage 中的日期格式无效，跳过: %s", day_str)
            continue

        try:
            value = float(record.get(value_field, 0.0) or 0.0)
        except (TypeError, ValueError):
            _LOGGER.debug("storage 中的 %s 值非法，跳过: %s", value_field, day_str)
            continue

        if value <= 0:
            # 跳过零值，但不中断序列（不影响游标推进逻辑）
            continue

        series.append((day_str, value))

    series.sort(key=lambda item: item[0])
    return series


def build_daily_stats(
    series: list[tuple[str, float]],
    *,
    last_imported_day: str | None,
    running_total: float,
    stability_days: int = _STABILITY_DAYS,
) -> tuple[list[StatisticData], str | None, float]:
    """把清洗后的序列转成 StatisticData（纯函数，方便离线验证）。"""
    cutoff = (date.today() - timedelta(days=stability_days)).isoformat()

    stats: list[StatisticData] = []
    new_last_day = last_imported_day
    new_last_total = running_total

    for day_str, value in series:
        if last_imported_day is not None and day_str <= last_imported_day:
            continue
        if day_str > cutoff:
            continue

        day_date = date.fromisoformat(day_str)
        running_total = round(running_total + value, 4)

        # HA recorder 要求 start 为时区感知的整点时刻
        # 使用每天 00:00:00 本地时间作为统计起始点
        start = dt_util.as_local(
            datetime(day_date.year, day_date.month, day_date.day, 0, 0, 0)
        )
        stats.append(
            StatisticData(start=start, sum=running_total, state=round(value, 4))
        )

        new_last_day = day_str
        new_last_total = running_total

    return stats, new_last_day, new_last_total


def baseline_matches(
    series: list[tuple[str, float]],
    *,
    last_imported_day: str | None,
    expected_total: float,
) -> bool:
    """用当前 storage 重算截到 last_imported_day 的累计值，与游标记录比对。"""
    if last_imported_day is None:
        return True

    total = 0.0
    for day_str, value in series:
        if day_str > last_imported_day:
            break
        total = round(total + value, 4)

    return abs(total - expected_total) <= _BASELINE_TOLERANCE


def _official_records(storage: "StateGridStorage", consumer_number: str) -> list[Any]:
    """取出该账户下已标记 official 的日记录（导入与基线校验都只用这些）。"""
    account = storage._ensure_account(consumer_number)
    daily: dict[str, dict[str, Any]] = account.get("daily", {})
    return [r for r in daily.values() if isinstance(r, dict) and r.get("official")]


async def _async_import_series(
    hass: HomeAssistant,
    storage: "StateGridStorage",
    consumer_number: str,
    *,
    stat_key: str,
    stat_id: str,
    name: str,
    value_field: str,
    unit_of_measurement: str,
    unit_class: str | None,
    value_unit: str,
    label: str,
) -> None:
    """把一类「按日数值」序列导入 HA 外部长期统计。"""
    cursor = await storage.async_get_statistics_cursor(consumer_number, stat_key)
    last_imported_day: str | None = cursor.get("last_imported_day") or None
    running_total = float(cursor.get("last_imported_total", 0.0) or 0.0)

    series = clean_series(_official_records(storage, consumer_number), value_field)

    baseline_changed = last_imported_day is not None and not baseline_matches(
        series, last_imported_day=last_imported_day, expected_total=running_total
    )
    if baseline_changed:
        _LOGGER.info("%s 历史被重算（基线不一致），将全量重导", label)
        last_imported_day = None
        running_total = 0.0

    stats, new_last_day, new_last_total = build_daily_stats(
        series, last_imported_day=last_imported_day, running_total=running_total
    )
    if not stats:
        return

    metadata = StatisticMetaData(
        mean_type=StatisticMeanType.NONE,
        has_mean=False,
        has_sum=True,
        name=name,
        source=DOMAIN,
        statistic_id=stat_id,
        unit_class=unit_class,
        unit_of_measurement=unit_of_measurement,
    )

    try:
        # 外部统计必须使用 async_add_external_statistics；
        # 否则带 ':' 的 statistic_id 会在内部统计校验中触发 Invalid statistic_id。
        async_add_external_statistics(hass, metadata, stats)
    except Exception as exc:  # pylint: disable=broad-except
        # 导入失败时不推进游标，等待下次 payload 重试
        _LOGGER.error(
            "%s 统计导入失败，游标保持不变，下次 payload 将重试: %s (statistic_id=%s)",
            label,
            exc,
            stat_id,
        )
        return

    await storage.async_mark_statistics_imported(
        consumer_number, stat_key, new_last_day, new_last_total
    )
    _LOGGER.info(
        "已导入 %d 条%s到 HA 统计 (最新日=%s, 累计=%.2f %s)",
        len(stats),
        label,
        new_last_day,
        new_last_total,
        value_unit,
    )


async def async_import_energy_statistics(
    hass: HomeAssistant,
    storage: "StateGridStorage",
    consumer_number: str,
) -> None:
    """将历史日电量回填至 HA 长期统计（能源面板「电网 → 用电量」）。"""
    await _async_import_series(
        hass,
        storage,
        consumer_number,
        stat_key=_STAT_KEY_TOTAL_ENERGY,
        stat_id=_statistic_id(consumer_number),
        name=f"国家电网 {consumer_number} 累计用电",
        value_field="dayEleNum",
        unit_of_measurement="kWh",
        unit_class="energy",
        value_unit="kWh",
        label="历史日电量",
    )


async def async_import_cost_statistics(
    hass: HomeAssistant,
    storage: "StateGridStorage",
    consumer_number: str,
) -> None:
    """将历史日电费回填至 HA 长期统计（能源面板「成本跟踪 → 统计」）。

    statistic_id 为 state_grid_info:total_cost_<consumer_number>，单位「元」。
    注意它与实体统计 sensor.state_grid_<consumer_number>_total_cost 是两个不同的
    statistic_id，面板里只能选一条（推荐选这条，它有完整历史）。
    """
    await _async_import_series(
        hass,
        storage,
        consumer_number,
        stat_key=_STAT_KEY_TOTAL_COST,
        stat_id=cost_statistic_id(consumer_number),
        name=f"国家电网 {consumer_number} 累计电费（含历史）",
        value_field="dayEleCost",
        unit_of_measurement="元",
        unit_class=None,
        value_unit="元",
        label="历史日电费",
    )
