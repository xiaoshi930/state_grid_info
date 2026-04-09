"""Statistics backfill for State Grid Info integration.

把历史日电量按实际用电日期导入 HA 长期统计，解决数据晚到问题：
- 如果官方账单在 3 月 20 日才推送 3 月 18 日的数据，
  HA Recorder 默认会将这段增量记录在 3 月 20 日附近。
- 通过 async_import_statistics 把 3 月 18 日的累计值补写到正确时间点，
  能源面板就能在 3 月 18 日位置显示该天的用电。

设计要点：
- 仅回填"距今至少 2 天"的官方数据，避免因次日修正而重复导入错误值。
- 使用游标（last_imported_day / last_imported_total）保证幂等性。
- 导入失败时不推进游标，下次 payload 到达时自动重试。
- statistic_id 采用外部格式：state_grid_info:total_energy_<consumer_number>
"""

import logging
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

# 官方数据稳定窗口：距今至少 N 天才认为该日数据不会被修正
_STABILITY_DAYS = 2


def _statistic_id(consumer_number: str) -> str:
    """返回该用户的外部统计 ID（HA Energy 面板可直接选择）。"""
    return f"{DOMAIN}:total_energy_{consumer_number}"


async def async_import_energy_statistics(
    hass: HomeAssistant,
    storage: "StateGridStorage",
    consumer_number: str,
) -> None:
    """将历史日电量回填至 HA 长期统计。

    1. 读取游标，确定上次导入到哪一天（last_imported_day）和累计值（last_imported_total）。
    2. 从 storage.daily 选出：
       - 已标记 official=True
       - 晚于 last_imported_day（首次为 None，全量导入）
       - 距今至少 _STABILITY_DAYS 天（避免次日修正导致重复导入错误值）
    3. 生成 StatisticData 序列（每天一条，sum = 累计到当天末的总电量）。
    4. 调用 async_import_statistics（非阻塞，调度到 recorder 线程）。
    5. 导入成功后推进游标；失败时保留游标等待下次重试。
    """
    cursor = await storage.async_get_statistics_cursor(consumer_number, _STAT_KEY_TOTAL_ENERGY)
    last_imported_day: str | None = cursor.get("last_imported_day")
    running_total = float(cursor.get("last_imported_total", 0.0))

    account = storage._ensure_account(consumer_number)
    daily: dict[str, dict[str, Any]] = account.get("daily", {})

    # 截止日：今天往前移 _STABILITY_DAYS 天
    cutoff = (date.today() - timedelta(days=_STABILITY_DAYS)).isoformat()

    pending = sorted(
        [
            r
            for r in daily.values()
            if r.get("official")
            and (last_imported_day is None or r["day"] > last_imported_day)
            and r["day"] <= cutoff
        ],
        key=lambda x: x["day"],
    )

    if not pending:
        return

    stat_id = _statistic_id(consumer_number)
    metadata = StatisticMetaData(
        mean_type=StatisticMeanType.NONE,
        has_mean=False,
        has_sum=True,
        name=f"国家电网 {consumer_number} 累计用电",
        source=DOMAIN,
        statistic_id=stat_id,
        unit_class="energy",
        unit_of_measurement="kWh",
    )

    stats: list[StatisticData] = []
    new_last_day = last_imported_day
    new_last_total = running_total

    for record in pending:
        day_str = record["day"]
        kwh = float(record.get("dayEleNum", 0.0))
        if kwh <= 0:
            # 跳过零值，但不中断序列（不影响游标推进逻辑）
            continue

        try:
            day_date = date.fromisoformat(day_str)
        except ValueError:
            _LOGGER.debug("storage 中的日期格式无效，跳过: %s", day_str)
            continue

        running_total = round(running_total + kwh, 4)

        # HA recorder 要求 start 为时区感知的整点时刻
        # 使用每天 00:00:00 本地时间作为统计起始点
        start = dt_util.as_local(datetime(day_date.year, day_date.month, day_date.day, 0, 0, 0))

        stats.append(
            StatisticData(
                start=start,
                sum=running_total,
                state=round(kwh, 4),
            )
        )

        new_last_day = day_str
        new_last_total = running_total

    if not stats:
        return

    try:
        # 外部统计必须使用 async_add_external_statistics；
        # 否则带 ':' 的 statistic_id 会在内部统计校验中触发 Invalid statistic_id。
        async_add_external_statistics(hass, metadata, stats)
    except Exception as exc:
        # 导入失败时不推进游标，等待下次 payload 重试
        _LOGGER.error(
            "能源统计导入失败，游标保持不变，下次 payload 将重试: %s (statistic_id=%s)",
            exc,
            stat_id,
        )
        return

    await storage.async_mark_statistics_imported(
        consumer_number, _STAT_KEY_TOTAL_ENERGY, new_last_day, new_last_total
    )
    _LOGGER.info(
        "已导入 %d 条历史日电量到 HA 统计 (最新日=%s, 累计总量=%.2f kWh)",
        len(stats),
        new_last_day,
        new_last_total,
    )
