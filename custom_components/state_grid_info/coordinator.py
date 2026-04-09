"""Data coordinator for State Grid Info integration.

该文件是重构第一阶段的基础框架：
- 接入数据源（青龙 MQTT / HassBox）
- 规范化日数据
- 同步到 storage 历史账本
- 维护运行时快照，供后续多实体复用

说明：当前阶段以“框架落地”为主，不强制替换现有 sensor 计费逻辑。
"""

import json
import logging
import os
from datetime import datetime, timedelta
from typing import Any, Optional

import paho.mqtt.client as mqtt

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import (
    BILLING_STANDARD_MONTH_阶梯,
    BILLING_STANDARD_MONTH_阶梯_峰平谷,
    BILLING_STANDARD_MONTH_阶梯_峰平谷_变动价格,
    BILLING_STANDARD_OTHER_平均单价,
    BILLING_STANDARD_YEAR_阶梯,
    BILLING_STANDARD_YEAR_阶梯_峰平谷,
    CONF_AVERAGE_PRICE,
    CONF_BILLING_STANDARD,
    CONF_CONSUMER_NAME,
    CONF_CONSUMER_NUMBER,
    CONF_CONSUMER_NUMBER_INDEX,
    CONF_DATA_SOURCE,
    CONF_IS_PREPAID,
    CONF_LADDER_LEVEL_1,
    CONF_LADDER_LEVEL_2,
    CONF_LADDER_PRICE_1,
    CONF_LADDER_PRICE_2,
    CONF_LADDER_PRICE_3,
    CONF_MQTT_HOST,
    CONF_MQTT_PASSWORD,
    CONF_MQTT_PORT,
    CONF_MQTT_USERNAME,
    CONF_PRICE_FLAT,
    CONF_PRICE_PEAK,
    CONF_PRICE_TIP,
    CONF_PRICE_VALLEY,
    CONF_STATE_GRID_ID,
    CONF_YEAR_LADDER_START,
    DATA_SOURCE_HASSBOX,
    DATA_SOURCE_QINGLONG,
    DOMAIN,
)
from .storage import StateGridStorage

_LOGGER = logging.getLogger(__name__)


class StateGridInfoCoordinator(DataUpdateCoordinator):
    """Unified data coordinator with storage integration."""

    def __init__(self, hass: HomeAssistant, config: dict[str, Any]) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(minutes=10),
        )
        self.config = config
        self.data: dict[str, Any] = {}
        self.runtime_snapshot: dict[str, Any] = {}

        self.storage = StateGridStorage(hass)
        self.mqtt_client: Optional[mqtt.Client] = None
        self.last_update_time = datetime.now()
        self._initialized = False

    async def async_prepare(self) -> None:
        """Load persistent storage and initialize selected data source."""
        if self._initialized:
            return

        await self.storage.async_load()
        await self._async_refresh_from_storage()
        self._setup_data_source()
        self._initialized = True

    async def _async_refresh_from_storage(self) -> None:
        """Rebuild derived data and runtime snapshot from persisted storage.

        This path is used on integration reload and periodic coordinator refresh
        so derived month/year values stay consistent even without a new MQTT
        payload.
        """
        consumer_number = str(self.config.get(CONF_CONSUMER_NUMBER, ""))
        if not consumer_number:
            return

        await self._async_restore_from_storage()
        await self._async_ensure_daily_costs_calculated(consumer_number)

        account = await self.storage.async_get_account(consumer_number)
        if not account.get("daily") and not account.get("monthly") and not account.get("yearly"):
            return

        await self.storage.async_rebuild_monthly(consumer_number)
        await self.storage.async_rebuild_yearly(consumer_number)
        await self.storage.async_save()

        day_list, month_list, year_list = await self._async_get_resolved_lists(consumer_number)
        meta = account.get("meta", {})
        self.data = {
            "date": meta.get("last_payload_at", self.data.get("date", "")),
            "balance": float(meta.get("last_balance", self.data.get("balance", 0))),
            "dayList": day_list,
            "monthList": month_list,
            "yearList": year_list,
            "consumer_name": meta.get(
                "consumer_name",
                self.config.get(CONF_CONSUMER_NAME, ""),
            ),
        }
        await self._async_rebuild_runtime_snapshot()

        # Reload/periodic refresh should also retry delayed statistics import,
        # not only on new payload arrival.
        await self._async_maybe_import_statistics(consumer_number)

    async def _async_ensure_daily_costs_calculated(self, consumer_number: str) -> None:
        """确保历史日数据中的 dayEleCost 已计算，处理升级情况。"""
        account = await self.storage.async_get_account(consumer_number)
        daily = account.get("daily", {})
        
        updated = False
        for day_key, record in daily.items():
            if "dayEleCost" not in record or not record.get("dayEleCost"):
                cost = await self._async_calculate_daily_cost(record)
                record["dayEleCost"] = round(cost, 2)
                updated = True
        
        if updated:
            _LOGGER.info("Updated daily cost calculations for historic records")
            await self.storage.async_save()

    async def async_unload(self) -> None:
        """Clean up connections and persist pending storage changes."""
        if self.mqtt_client:
            try:
                self.mqtt_client.loop_stop()
                self.mqtt_client.disconnect()
            except Exception as exc:  # pragma: no cover - defensive cleanup
                _LOGGER.debug("Failed to disconnect MQTT cleanly: %s", exc)

        await self.storage.async_save()

    async def _async_restore_from_storage(self) -> None:
        """Restore the latest known runtime state from persistent storage."""
        consumer_number = str(self.config.get(CONF_CONSUMER_NUMBER, ""))
        if not consumer_number:
            return

        account = await self.storage.async_get_account(consumer_number)
        if not account.get("daily") and not account.get("monthly") and not account.get("yearly"):
            return

        day_list, month_list, year_list = await self._async_get_resolved_lists(consumer_number)
        meta = account.get("meta", {})
        self.data = {
            "date": meta.get("last_payload_at", ""),
            "balance": float(meta.get("last_balance", 0)),
            "dayList": day_list,
            "monthList": month_list,
            "yearList": year_list,
            "consumer_name": meta.get("consumer_name", self.config.get(CONF_CONSUMER_NAME, "")),
        }

        payload_time = meta.get("last_payload_at", "")
        if payload_time:
            try:
                self.last_update_time = datetime.fromisoformat(payload_time)
            except ValueError:
                pass

        await self._async_rebuild_runtime_snapshot()

    # ------------------------------------------------------------------
    # Data source lifecycle
    # ------------------------------------------------------------------

    def _setup_data_source(self) -> None:
        source = self.config.get(CONF_DATA_SOURCE)
        if source == DATA_SOURCE_QINGLONG:
            self._setup_mqtt_client()

    def _setup_mqtt_client(self) -> None:
        """Configure MQTT client for Qinglong data source."""
        try:
            if self.mqtt_client:
                try:
                    self.mqtt_client.loop_stop()
                    self.mqtt_client.disconnect()
                except Exception:
                    pass

            client_id = (
                f"state_grid_{self.config.get(CONF_STATE_GRID_ID)}_"
                f"{int(datetime.now().timestamp())}"
            )
            client = mqtt.Client(client_id=client_id, clean_session=True)

            username = self.config.get(CONF_MQTT_USERNAME)
            password = self.config.get(CONF_MQTT_PASSWORD)
            if username and password:
                client.username_pw_set(username, password)

            client.on_connect = self._on_mqtt_connect
            client.on_message = self._on_mqtt_message
            client.on_disconnect = self._on_mqtt_disconnect
            client.reconnect_delay_set(min_delay=1, max_delay=120)

            client.connect(
                self.config.get(CONF_MQTT_HOST),
                self.config.get(CONF_MQTT_PORT, 1883),
                keepalive=60,
            )
            client.loop_start()
            self.mqtt_client = client
            _LOGGER.info("MQTT coordinator connected with client_id=%s", client_id)
        except Exception as exc:
            _LOGGER.error("Failed to setup MQTT client: %s", exc)

    def _on_mqtt_connect(self, client: mqtt.Client, userdata: Any, flags: Any, rc: int) -> None:
        """Subscribe on successful MQTT connection."""
        if rc != 0:
            _LOGGER.error("MQTT connection rejected, rc=%s", rc)
            return

        topic = f"nodejs/state-grid/{self.config.get(CONF_STATE_GRID_ID)}"
        result, _ = client.subscribe(topic)
        if result == 0:
            _LOGGER.info("Subscribed topic: %s", topic)
        else:
            _LOGGER.error("Subscribe failed for topic %s, result=%s", topic, result)

    def _on_mqtt_disconnect(self, client: mqtt.Client, userdata: Any, rc: int) -> None:
        if rc != 0:
            _LOGGER.warning("MQTT disconnected unexpectedly, rc=%s", rc)

    def _on_mqtt_message(self, client: mqtt.Client, userdata: Any, msg: Any) -> None:
        """Handle MQTT payload in HA event loop."""
        try:
            payload = json.loads(msg.payload.decode())
        except Exception as exc:
            _LOGGER.error("Invalid MQTT payload: %s", exc)
            return

        self.hass.loop.call_soon_threadsafe(
            lambda: self.hass.async_create_task(self.async_handle_qinglong_payload(payload))
        )

    # ------------------------------------------------------------------
    # Coordinator update entry
    # ------------------------------------------------------------------

    async def _async_update_data(self) -> dict[str, Any]:
        """Periodic update entry point.

        - Qinglong: maintain connection and return latest in-memory snapshot.
        - HassBox: actively read and normalize local storage file.
        """
        try:
            await self.async_prepare()

            source = self.config.get(CONF_DATA_SOURCE)
            if source == DATA_SOURCE_HASSBOX:
                user_data = await self.hass.async_add_executor_job(self._fetch_hassbox_user_data)
                if user_data:
                    await self.async_handle_hassbox_payload(user_data)
                return self.data

            if source == DATA_SOURCE_QINGLONG:
                if not self.mqtt_client or not self.mqtt_client.is_connected():
                    self._setup_mqtt_client()
                await self._async_refresh_from_storage()
                return self.data

            return self.data
        except Exception as exc:
            raise UpdateFailed(f"State Grid update failed: {exc}") from exc

    # ------------------------------------------------------------------
    # Payload handlers
    # ------------------------------------------------------------------

    async def async_handle_qinglong_payload(self, payload: dict[str, Any]) -> None:
        """Normalize Qinglong payload and sync storage."""
        records = self._normalize_qinglong_daily(payload)
        
        # 为每个日记录计算并添加 dayEleCost，确保存储层有完整数据
        for record in records:
            if "dayEleCost" not in record or not record.get("dayEleCost"):
                record["dayEleCost"] = round(await self._async_calculate_daily_cost(record), 2)
        
        month_list = self._normalize_qinglong_monthly(payload)
        year_list = self._normalize_qinglong_yearly(payload, month_list)

        consumer_number = str(self.config.get(CONF_CONSUMER_NUMBER, ""))
        payload_time = payload.get("date") or datetime.now().astimezone().isoformat()
        balance = float(payload.get("sumMoney", 0))

        await self._async_sync_storage(
            consumer_number=consumer_number,
            records=records,
            monthly_records=month_list,
            yearly_records=year_list,
            source=DATA_SOURCE_QINGLONG,
            payload_time=payload_time,
            balance=balance,
            consumer_name=self.config.get(CONF_CONSUMER_NAME, ""),
        )

        day_list, merged_month_list, merged_year_list = await self._async_get_resolved_lists(
            consumer_number
        )

        self.data = {
            "date": payload_time,
            "balance": balance,
            "dayList": day_list,
            "monthList": merged_month_list,
            "yearList": merged_year_list,
            "consumer_name": self.config.get(CONF_CONSUMER_NAME, ""),
        }
        self.last_update_time = datetime.now()
        await self._async_rebuild_runtime_snapshot()
        self.async_set_updated_data(self.data)
        await self._async_maybe_import_statistics(consumer_number)

    async def async_handle_hassbox_payload(self, user_data: dict[str, Any]) -> None:
        """Normalize HassBox user data and sync storage."""
        records = self._normalize_hassbox_daily(user_data)
        
        # 为没有 dayEleCost 的记录计算费用，确保存储层有完整数据
        for record in records:
            if "dayEleCost" not in record or not record.get("dayEleCost"):
                record["dayEleCost"] = round(await self._async_calculate_daily_cost(record), 2)
        
        month_list = self._normalize_hassbox_monthly(user_data)
        year_list = self._build_yearly_from_monthly(month_list)

        consumer_number = str(self.config.get(CONF_CONSUMER_NUMBER, ""))
        payload_time = user_data.get("refresh_time") or datetime.now().astimezone().isoformat()
        balance = float(user_data.get("balance", 0))
        consumer_name = user_data.get("consName_dst", self.config.get(CONF_CONSUMER_NAME, ""))

        await self._async_sync_storage(
            consumer_number=consumer_number,
            records=records,
            monthly_records=month_list,
            yearly_records=year_list,
            source=DATA_SOURCE_HASSBOX,
            payload_time=payload_time,
            balance=balance,
            consumer_name=consumer_name,
        )

        day_list, merged_month_list, merged_year_list = await self._async_get_resolved_lists(
            consumer_number
        )

        self.data = {
            "date": payload_time,
            "balance": balance,
            "dayList": day_list,
            "monthList": merged_month_list,
            "yearList": merged_year_list,
            "consumer_name": consumer_name,
        }
        self.last_update_time = datetime.now()
        await self._async_rebuild_runtime_snapshot()
        self.async_set_updated_data(self.data)
        await self._async_maybe_import_statistics(consumer_number)

    async def _async_maybe_import_statistics(self, consumer_number: str) -> None:
        """Backfill stable daily records into HA long-term statistics.

        Wrapped in try/except so any recorder unavailability never
        blocks entity updates.
        """
        if not consumer_number:
            return
        try:
            from .statistics import async_import_energy_statistics  # local import avoids circular dep
            await async_import_energy_statistics(self.hass, self.storage, consumer_number)
        except Exception as exc:
            _LOGGER.debug("Statistics import skipped: %s", exc)

    async def _async_sync_storage(
        self,
        consumer_number: str,
        records: list[dict[str, Any]],
        monthly_records: Optional[list[dict[str, Any]]],
        yearly_records: Optional[list[dict[str, Any]]],
        source: str,
        payload_time: str,
        balance: float,
        consumer_name: str,
    ) -> None:
        """Merge new daily records into storage and refresh runtime snapshot."""
        account = await self.storage.async_get_account(consumer_number)
        existing_last_official_day = (account.get("meta") or {}).get("last_official_day", "")
        last_official_day = max((r["day"] for r in records), default=existing_last_official_day)

        await self.storage.async_merge_daily_records(
            consumer_number,
            records,
            meta={
                "consumer_name": consumer_name,
                "source": source,
                "last_payload_at": payload_time,
                "last_official_day": last_official_day,
                "last_balance": balance,
            },
        )
        if monthly_records:
            await self.storage.async_merge_monthly_records(consumer_number, monthly_records)
        if yearly_records:
            await self.storage.async_merge_yearly_records(consumer_number, yearly_records)
        await self.storage.async_rebuild_monthly(consumer_number)
        await self.storage.async_rebuild_yearly(consumer_number)
        await self.storage.async_save()

        self.runtime_snapshot = await self.storage.async_get_runtime_snapshot(consumer_number)

    async def _async_rebuild_runtime_snapshot(self) -> None:
        """Build the entity-facing runtime snapshot from storage and config."""
        consumer_number = str(self.config.get(CONF_CONSUMER_NUMBER, ""))
        if not consumer_number:
            self.runtime_snapshot = {}
            return

        snapshot = await self.storage.async_get_runtime_snapshot(consumer_number)
        overview = snapshot.get("overview", {})
        overview_daylist = await self._async_build_overview_daylist(overview.get("daylist", []))
        latest_day = overview_daylist[0]["day"] if overview_daylist else snapshot.get("energy", {}).get("last_official_day", "")

        overview["daylist"] = overview_daylist
        snapshot["overview"] = overview
        snapshot["billing"] = await self._async_build_billing_snapshot(latest_day)
        snapshot["date"] = self.data.get("date", snapshot.get("date", ""))
        snapshot["balance"] = self.data.get("balance", snapshot.get("balance", 0.0))
        snapshot["consumer_name"] = self.data.get("consumer_name", snapshot.get("consumer_name", ""))
        snapshot["last_sync_at"] = self.last_update_time.astimezone().isoformat()

        # ---------------------------------------------------------------
        # 现在存储层已经有完整的 dayEleCost 数据，月度费用从存储层获取即可
        # ---------------------------------------------------------------
        energy = snapshot.get("energy", {})
        cost = snapshot.get("cost", {})
        now = datetime.now()
        current_month_str = now.strftime("%Y-%m")
        current_year_str = now.strftime("%Y")
        monthlist = list(overview.get("monthlist", []))
        
        # 标记当前月电费是否为估算值（基于是否有官方账单）
        is_estimated = not energy.get("current_month_has_official_cost", False)
        cost["current_month_cost_is_estimated"] = is_estimated

        # Keep year/total values aligned with monthlist so current month
        # provisional values are reflected everywhere consistently.
        monthlist = sorted(monthlist, key=lambda x: x.get("month", ""), reverse=True)
        overview["monthlist"] = monthlist

        current_year_cost = sum(
            float(m.get("monthEleCost", 0.0))
            for m in monthlist
            if str(m.get("month", "")).startswith(current_year_str)
        )
        total_cost = sum(float(m.get("monthEleCost", 0.0)) for m in monthlist)
        current_year_kwh = sum(
            float(m.get("monthEleNum", 0.0))
            for m in monthlist
            if str(m.get("month", "")).startswith(current_year_str)
        )
        total_kwh = sum(float(m.get("monthEleNum", 0.0)) for m in monthlist)

        cost["current_year_cost"] = round(current_year_cost, 2)
        cost["total_cost"] = round(total_cost, 2)
        energy["current_year_kwh"] = round(current_year_kwh, 2)
        energy["total_energy_kwh"] = round(total_kwh, 2)

        yearlist = list(overview.get("yearlist", []))
        year_map: dict[str, dict[str, Any]] = {
            str(y.get("year", "")): dict(y)
            for y in yearlist
            if str(y.get("year", ""))
        }
        year_entry = year_map.get(
            current_year_str,
            {
                "year": current_year_str,
                "yearEleNum": 0.0,
                "yearEleCost": 0.0,
                "yearTPq": 0.0,
                "yearPPq": 0.0,
                "yearNPq": 0.0,
                "yearVPq": 0.0,
            },
        )
        year_entry["yearEleNum"] = round(current_year_kwh, 2)
        year_entry["yearEleCost"] = round(current_year_cost, 2)
        year_entry["yearTPq"] = round(
            sum(
                float(m.get("monthTPq", 0.0))
                for m in monthlist
                if str(m.get("month", "")).startswith(current_year_str)
            ),
            2,
        )
        year_entry["yearPPq"] = round(
            sum(
                float(m.get("monthPPq", 0.0))
                for m in monthlist
                if str(m.get("month", "")).startswith(current_year_str)
            ),
            2,
        )
        year_entry["yearNPq"] = round(
            sum(
                float(m.get("monthNPq", 0.0))
                for m in monthlist
                if str(m.get("month", "")).startswith(current_year_str)
            ),
            2,
        )
        year_entry["yearVPq"] = round(
            sum(
                float(m.get("monthVPq", 0.0))
                for m in monthlist
                if str(m.get("month", "")).startswith(current_year_str)
            ),
            2,
        )
        year_map[current_year_str] = year_entry
        overview["yearlist"] = sorted(year_map.values(), key=lambda x: x.get("year", ""), reverse=True)

        snapshot["overview"] = overview
        snapshot["cost"] = cost
        snapshot["energy"] = energy

        self.runtime_snapshot = snapshot

    async def _async_get_resolved_lists(
        self,
        consumer_number: str,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
        """Return merged lists from storage.

        dayList 保持一个有限窗口，避免状态属性过大；月/年列表直接使用融合后的账本数据。
        """
        account = await self.storage.async_get_account(consumer_number)
        day_list = sorted(account.get("daily", {}).values(), key=lambda x: x["day"], reverse=True)[:400]
        month_list = sorted(account.get("monthly", {}).values(), key=lambda x: x["month"], reverse=True)
        year_list = sorted(account.get("yearly", {}).values(), key=lambda x: x["year"], reverse=True)
        return day_list, month_list, year_list

    async def async_get_month_accumulated_kwh(self, target_day: str) -> float:
        """Return month-to-date kWh using storage's no-estimation rule."""
        consumer_number = str(self.config.get(CONF_CONSUMER_NUMBER, ""))
        return await self.storage.async_get_month_accumulated_kwh(consumer_number, target_day)

    async def async_get_year_accumulated_kwh(self, target_day: str) -> float:
        """Return billing-year accumulated kWh using storage's source-first rules."""
        consumer_number = str(self.config.get(CONF_CONSUMER_NUMBER, ""))
        year_ladder_start = self.config.get(CONF_YEAR_LADDER_START, "0101")
        return await self.storage.async_get_year_accumulated_kwh(
            consumer_number,
            target_day,
            year_ladder_start,
        )

    async def _async_build_overview_daylist(self, day_records: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Attach calculated daily cost to the overview day list."""
        processed: list[dict[str, Any]] = []
        for record in day_records:
            item = dict(record)
            item["dayEleCost"] = round(await self._async_calculate_daily_cost(item), 2)
            processed.append(item)
        return processed

    async def _async_build_billing_snapshot(self, latest_day: str) -> dict[str, Any]:
        """Build billing metadata and current ladder context for the overview sensor."""
        billing_standard = self.config.get(CONF_BILLING_STANDARD, "")
        return {
            "standard": billing_standard,
            "standard_name": self._get_billing_standard_name(billing_standard),
            "ladder_info": await self._async_get_ladder_info(billing_standard, latest_day),
            "config": self._build_billing_config_attributes(billing_standard),
            "is_prepaid": "是" if self.config.get(CONF_IS_PREPAID, False) else "否",
        }

    @staticmethod
    def _get_billing_standard_name(billing_standard: str) -> str:
        billing_standard_map = {
            BILLING_STANDARD_YEAR_阶梯: "年阶梯",
            BILLING_STANDARD_YEAR_阶梯_峰平谷: "年阶梯峰平谷",
            BILLING_STANDARD_MONTH_阶梯: "月阶梯",
            BILLING_STANDARD_MONTH_阶梯_峰平谷: "月阶梯峰平谷",
            BILLING_STANDARD_MONTH_阶梯_峰平谷_变动价格: "月阶梯峰平谷变动价格",
            BILLING_STANDARD_OTHER_平均单价: "平均单价",
        }
        return billing_standard_map.get(billing_standard, billing_standard)

    async def _async_get_ladder_info(self, billing_standard: str, latest_day: str) -> dict[str, Any]:
        """Return current ladder tier information for the latest official day."""
        if not latest_day:
            return {}

        if billing_standard in (BILLING_STANDARD_YEAR_阶梯, BILLING_STANDARD_YEAR_阶梯_峰平谷):
            accumulated = await self.async_get_year_accumulated_kwh(latest_day)
            ladder_level_1 = self.config.get(CONF_LADDER_LEVEL_1, 2160)
            ladder_level_2 = self.config.get(CONF_LADDER_LEVEL_2, 4200)
            if accumulated <= ladder_level_1:
                current_ladder = "第1档"
            elif accumulated <= ladder_level_2:
                current_ladder = "第2档"
            else:
                current_ladder = "第3档"
            return {
                "当前年阶梯档": current_ladder,
                "年阶梯累计用电量": round(accumulated, 2),
            }

        if billing_standard in (
            BILLING_STANDARD_MONTH_阶梯,
            BILLING_STANDARD_MONTH_阶梯_峰平谷,
            BILLING_STANDARD_MONTH_阶梯_峰平谷_变动价格,
        ):
            accumulated = await self.async_get_month_accumulated_kwh(latest_day)
            ladder_level_1 = self.config.get(CONF_LADDER_LEVEL_1, 180)
            ladder_level_2 = self.config.get(CONF_LADDER_LEVEL_2, 280)
            if accumulated <= ladder_level_1:
                current_ladder = "第1档"
            elif accumulated <= ladder_level_2:
                current_ladder = "第2档"
            else:
                current_ladder = "第3档"
            return {
                "当前月阶梯档": current_ladder,
                "月阶梯累计用电量": round(accumulated, 2),
            }

        return {}

    def _build_billing_config_attributes(self, billing_standard: str) -> dict[str, Any]:
        """Return billing configuration attributes for the overview sensor."""
        attrs: dict[str, Any] = {"计费标准": self._get_billing_standard_name(billing_standard)}

        if billing_standard in (BILLING_STANDARD_YEAR_阶梯, BILLING_STANDARD_YEAR_阶梯_峰平谷):
            attrs["年阶梯第2档起始电量"] = self.config.get(CONF_LADDER_LEVEL_1, 2160)
            attrs["年阶梯第3档起始电量"] = self.config.get(CONF_LADDER_LEVEL_2, 4200)

            year_ladder_start = self.config.get(CONF_YEAR_LADDER_START, "0101")
            current_date = datetime.now()
            start_month = int(year_ladder_start[:2])
            start_day = int(year_ladder_start[2:])
            ladder_year = current_date.year
            if (current_date.month, current_date.day) < (start_month, start_day):
                ladder_year -= 1

            attrs["当前年阶梯起始日期"] = f"{ladder_year}.{year_ladder_start[:2]}.{year_ladder_start[2:]}"
            next_start = datetime(ladder_year + 1, start_month, start_day)
            end_date = next_start - timedelta(days=1)
            attrs["当前年阶梯结束日期"] = f"{end_date.year}.{end_date.month:02d}.{end_date.day:02d}"

            if billing_standard == BILLING_STANDARD_YEAR_阶梯:
                attrs["年阶梯第1档电价"] = self.config.get(CONF_LADDER_PRICE_1, 0.4983)
                attrs["年阶梯第2档电价"] = self.config.get(CONF_LADDER_PRICE_2, 0.5483)
                attrs["年阶梯第3档电价"] = self.config.get(CONF_LADDER_PRICE_3, 0.7983)
            else:
                self._append_tou_price_attributes(attrs, "年阶梯", CONF_LADDER_PRICE_1, "第1档")
                self._append_tou_price_attributes(attrs, "年阶梯", CONF_LADDER_PRICE_2, "第2档")
                self._append_tou_price_attributes(attrs, "年阶梯", CONF_LADDER_PRICE_3, "第3档")

            return attrs

        if billing_standard in (
            BILLING_STANDARD_MONTH_阶梯,
            BILLING_STANDARD_MONTH_阶梯_峰平谷,
            BILLING_STANDARD_MONTH_阶梯_峰平谷_变动价格,
        ):
            attrs["月阶梯第2档起始电量"] = self.config.get(CONF_LADDER_LEVEL_1, 180)
            attrs["月阶梯第3档起始电量"] = self.config.get(CONF_LADDER_LEVEL_2, 280)

            if billing_standard == BILLING_STANDARD_MONTH_阶梯:
                attrs["月阶梯第1档电价"] = self.config.get(CONF_LADDER_PRICE_1, 0.5224)
                attrs["月阶梯第2档电价"] = self.config.get(CONF_LADDER_PRICE_2, 0.6224)
                attrs["月阶梯第3档电价"] = self.config.get(CONF_LADDER_PRICE_3, 0.8334)
                return attrs

            self._append_tou_price_attributes(attrs, "月阶梯", CONF_LADDER_PRICE_1, "第1档")
            self._append_tou_price_attributes(attrs, "月阶梯", CONF_LADDER_PRICE_2, "第2档")
            self._append_tou_price_attributes(attrs, "月阶梯", CONF_LADDER_PRICE_3, "第3档")

            if billing_standard == BILLING_STANDARD_MONTH_阶梯_峰平谷_变动价格:
                for month in range(1, 13):
                    valley_price_1 = self.config.get(f"month_{month:02d}_ladder_1_valley")
                    valley_price_2 = self.config.get(f"month_{month:02d}_ladder_2_valley")
                    valley_price_3 = self.config.get(f"month_{month:02d}_ladder_3_valley")
                    if valley_price_1 is not None:
                        attrs[f"{month}月阶梯第1档谷电价"] = valley_price_1
                    if valley_price_2 is not None:
                        attrs[f"{month}月阶梯第2档谷电价"] = valley_price_2
                    if valley_price_3 is not None:
                        attrs[f"{month}月阶梯第3档谷电价"] = valley_price_3

            return attrs

        if billing_standard == BILLING_STANDARD_OTHER_平均单价:
            attrs["平均单价"] = self.config.get(CONF_AVERAGE_PRICE, 0.6)

        return attrs

    def _append_tou_price_attributes(self, attrs: dict[str, Any], prefix: str, ladder_key: str, ladder_label: str) -> None:
        attrs[f"{prefix}{ladder_label}尖电价"] = self.config.get(f"{ladder_key}_{CONF_PRICE_TIP}", 0)
        attrs[f"{prefix}{ladder_label}峰电价"] = self.config.get(f"{ladder_key}_{CONF_PRICE_PEAK}", 0)
        attrs[f"{prefix}{ladder_label}平电价"] = self.config.get(f"{ladder_key}_{CONF_PRICE_FLAT}", 0)
        attrs[f"{prefix}{ladder_label}谷电价"] = self.config.get(f"{ladder_key}_{CONF_PRICE_VALLEY}", 0)

    async def _async_calculate_daily_cost(self, day_data: dict[str, Any]) -> float:
        """Calculate cost for a day using the configured billing standard."""
        upstream_cost = day_data.get("dayEleCost")
        if upstream_cost is not None:
            try:
                if float(upstream_cost) > 0:
                    return float(upstream_cost)
            except (TypeError, ValueError):
                pass

        standard = self.config.get(CONF_BILLING_STANDARD)
        day_ele_num = float(day_data.get("dayEleNum", 0))
        if day_ele_num <= 0:
            return 0.0

        if standard == BILLING_STANDARD_YEAR_阶梯:
            return await self._async_calculate_tiered_cost(day_data, yearly=True, tou=False, variable_valley=False)
        if standard == BILLING_STANDARD_YEAR_阶梯_峰平谷:
            return await self._async_calculate_tiered_cost(day_data, yearly=True, tou=True, variable_valley=False)
        if standard == BILLING_STANDARD_MONTH_阶梯:
            return await self._async_calculate_tiered_cost(day_data, yearly=False, tou=False, variable_valley=False)
        if standard == BILLING_STANDARD_MONTH_阶梯_峰平谷:
            return await self._async_calculate_tiered_cost(day_data, yearly=False, tou=True, variable_valley=False)
        if standard == BILLING_STANDARD_MONTH_阶梯_峰平谷_变动价格:
            return await self._async_calculate_tiered_cost(day_data, yearly=False, tou=True, variable_valley=True)
        if standard == BILLING_STANDARD_OTHER_平均单价:
            return day_ele_num * float(self.config.get(CONF_AVERAGE_PRICE, 0.6))
        return 0.0

    async def _async_calculate_tiered_cost(
        self,
        day_data: dict[str, Any],
        *,
        yearly: bool,
        tou: bool,
        variable_valley: bool,
    ) -> float:
        """Calculate ladder cost for a single day using storage-backed accumulated kWh."""
        day_ele_num = float(day_data.get("dayEleNum", 0))
        if day_ele_num <= 0:
            return 0.0

        day = str(day_data.get("day", ""))
        accumulated = (
            await self.async_get_year_accumulated_kwh(day)
            if yearly
            else await self.async_get_month_accumulated_kwh(day)
        )

        ladder_level_1 = float(self.config.get(CONF_LADDER_LEVEL_1, 2160 if yearly else 180))
        ladder_level_2 = float(self.config.get(CONF_LADDER_LEVEL_2, 4200 if yearly else 280))
        first_part, second_part, third_part = self._split_ladder_usage(
            day_ele_num,
            accumulated,
            ladder_level_1,
            ladder_level_2,
        )

        if not tou:
            price_1 = float(self.config.get(CONF_LADDER_PRICE_1, 0.4983 if yearly else 0.5224))
            price_2 = float(self.config.get(CONF_LADDER_PRICE_2, 0.5483 if yearly else 0.6224))
            price_3 = float(self.config.get(CONF_LADDER_PRICE_3, 0.7983 if yearly else 0.8334))
            return first_part * price_1 + second_part * price_2 + third_part * price_3

        month = int(day[5:7]) if len(day) >= 7 else 1
        prices_1 = self._get_tou_prices(CONF_LADDER_PRICE_1, month, variable_valley)
        prices_2 = self._get_tou_prices(CONF_LADDER_PRICE_2, month, variable_valley)
        prices_3 = self._get_tou_prices(CONF_LADDER_PRICE_3, month, variable_valley)

        ratios = [first_part / day_ele_num, second_part / day_ele_num, third_part / day_ele_num]
        segments = [prices_1, prices_2, prices_3]
        usages = {
            CONF_PRICE_TIP: float(day_data.get("dayTPq", 0)),
            CONF_PRICE_PEAK: float(day_data.get("dayPPq", 0)),
            CONF_PRICE_FLAT: float(day_data.get("dayNPq", 0)),
            CONF_PRICE_VALLEY: float(day_data.get("dayVPq", 0)),
        }

        total_cost = 0.0
        for ratio, prices in zip(ratios, segments):
            if ratio <= 0:
                continue
            total_cost += (
                usages[CONF_PRICE_TIP] * prices[CONF_PRICE_TIP] * ratio
                + usages[CONF_PRICE_PEAK] * prices[CONF_PRICE_PEAK] * ratio
                + usages[CONF_PRICE_FLAT] * prices[CONF_PRICE_FLAT] * ratio
                + usages[CONF_PRICE_VALLEY] * prices[CONF_PRICE_VALLEY] * ratio
            )
        return total_cost

    @staticmethod
    def _split_ladder_usage(day_ele_num: float, accumulated: float, level_1: float, level_2: float) -> tuple[float, float, float]:
        """Split a day's usage into three ladder segments based on accumulated kWh."""
        prior_usage = max(accumulated - day_ele_num, 0.0)
        remaining = day_ele_num

        first_part = max(min(level_1 - prior_usage, remaining), 0.0)
        remaining -= first_part

        second_start = max(prior_usage, level_1)
        second_part = max(min(level_2 - second_start, remaining), 0.0)
        remaining -= second_part

        third_part = max(remaining, 0.0)
        return first_part, second_part, third_part

    def _get_tou_prices(self, ladder_key: str, month: int, variable_valley: bool) -> dict[str, float]:
        """Return TOU prices for one ladder."""
        prices = {
            CONF_PRICE_TIP: float(self.config.get(f"{ladder_key}_{CONF_PRICE_TIP}", 0.0)),
            CONF_PRICE_PEAK: float(self.config.get(f"{ladder_key}_{CONF_PRICE_PEAK}", 0.0)),
            CONF_PRICE_FLAT: float(self.config.get(f"{ladder_key}_{CONF_PRICE_FLAT}", 0.0)),
            CONF_PRICE_VALLEY: float(self.config.get(f"{ladder_key}_{CONF_PRICE_VALLEY}", 0.0)),
        }
        if variable_valley:
            suffix = ladder_key.rsplit("_", 1)[-1]
            prices[CONF_PRICE_VALLEY] = float(
                self.config.get(f"month_{month:02d}_ladder_{suffix}_valley", prices[CONF_PRICE_VALLEY])
            )
        return prices

    # ------------------------------------------------------------------
    # Parsing helpers
    # ------------------------------------------------------------------

    def _normalize_qinglong_daily(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        now_iso = datetime.now().astimezone().isoformat()
        records: list[dict[str, Any]] = []

        for item in payload.get("dayList", []) or []:
            day = item.get("day")
            if not day:
                continue
            records.append(
                {
                    "day": day,
                    "dayEleNum": float(item.get("dayElePq", 0)),
                    "dayTPq": float(item.get("thisTPq", 0)),
                    "dayPPq": float(item.get("thisPPq", 0)),
                    "dayNPq": float(item.get("thisNPq", 0)),
                    "dayVPq": float(item.get("thisVPq", 0)),
                    "official": True,
                    "source_updated_at": now_iso,
                }
            )

        return sorted(records, key=lambda x: x["day"], reverse=True)

    def _normalize_qinglong_monthly(self, payload: dict[str, Any]) -> list[dict[str, Any]]:
        monthly: list[dict[str, Any]] = []
        for item in payload.get("monthList", []) or []:
            month = str(item.get("month", ""))
            if len(month) == 6 and month.isdigit():
                month = f"{month[0:4]}-{month[4:6]}"
            if not month:
                continue
            monthly.append(
                {
                    "month": month,
                    "monthEleNum": float(item.get("monthEleNum", 0)),
                    "monthEleCost": float(item.get("monthEleCost", 0)),
                    "monthTPq": float(item.get("monthTPq", 0)),
                    "monthPPq": float(item.get("monthPPq", 0)),
                    "monthNPq": float(item.get("monthNPq", 0)),
                    "monthVPq": float(item.get("monthVPq", 0)),
                }
            )
        return sorted(monthly, key=lambda x: x["month"], reverse=True)

    def _normalize_qinglong_yearly(
        self,
        payload: dict[str, Any],
        normalized_monthly: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Use payload yearList when available, otherwise derive from monthly."""
        yearly: list[dict[str, Any]] = []
        for item in payload.get("yearList", []) or []:
            year = str(item.get("year", ""))
            if not year:
                continue
            yearly.append(
                {
                    "year": year,
                    "yearEleNum": float(item.get("yearEleNum", 0)),
                    "yearEleCost": float(item.get("yearEleCost", 0)),
                    "yearTPq": float(item.get("yearTPq", 0)),
                    "yearPPq": float(item.get("yearPPq", 0)),
                    "yearNPq": float(item.get("yearNPq", 0)),
                    "yearVPq": float(item.get("yearVPq", 0)),
                }
            )

        if yearly:
            return sorted(yearly, key=lambda x: x["year"], reverse=True)

        return self._build_yearly_from_monthly(normalized_monthly)

    def _normalize_hassbox_daily(self, user_data: dict[str, Any]) -> list[dict[str, Any]]:
        now_iso = datetime.now().astimezone().isoformat()
        merged: dict[str, dict[str, Any]] = {}

        def _convert_day(raw_day: str) -> str:
            # raw format: YYYYMMDD -> YYYY-MM-DD
            if len(raw_day) == 8 and raw_day.isdigit():
                return f"{raw_day[0:4]}-{raw_day[4:6]}-{raw_day[6:8]}"
            return raw_day

        def _to_float(raw: Any) -> float:
            if raw in (None, "-"):
                return 0.0
            try:
                return float(raw)
            except (TypeError, ValueError):
                return 0.0

        # daily_bill_list
        for item in user_data.get("daily_bill_list", []) or []:
            day = _convert_day(str(item.get("day", "")))
            if not day:
                continue
            merged[day] = {
                "day": day,
                "dayEleNum": _to_float(item.get("dayElePq")),
                "dayTPq": _to_float(item.get("thisTPq")),
                "dayPPq": _to_float(item.get("thisPPq")),
                "dayNPq": _to_float(item.get("thisNPq")),
                "dayVPq": _to_float(item.get("thisVPq")),
                "official": True,
                "source_updated_at": now_iso,
            }

        # month_bill_list[*].daily_ele
        for month_item in user_data.get("month_bill_list", []) or []:
            for day_item in month_item.get("daily_ele", []) or []:
                day = _convert_day(str(day_item.get("day", "")))
                if not day:
                    continue
                candidate = {
                    "day": day,
                    "dayEleNum": _to_float(day_item.get("dayElePq")),
                    "dayTPq": _to_float(day_item.get("thisTPq")),
                    "dayPPq": _to_float(day_item.get("thisPPq")),
                    "dayNPq": _to_float(day_item.get("thisNPq")),
                    "dayVPq": _to_float(day_item.get("thisVPq")),
                    "official": True,
                    "source_updated_at": now_iso,
                }
                current = merged.get(day)
                if current is None or candidate["dayEleNum"] > current.get("dayEleNum", 0):
                    merged[day] = candidate

        return sorted(merged.values(), key=lambda x: x["day"], reverse=True)

    def _normalize_hassbox_monthly(self, user_data: dict[str, Any]) -> list[dict[str, Any]]:
        monthly: list[dict[str, Any]] = []

        for item in user_data.get("month_bill_list", []) or []:
            raw_month = str(item.get("month", ""))
            if len(raw_month) == 6 and raw_month.isdigit():
                month = f"{raw_month[0:4]}-{raw_month[4:6]}"
            else:
                month = raw_month
            if not month:
                continue

            monthly.append(
                {
                    "month": month,
                    "monthEleNum": float(item.get("monthEleNum", 0)),
                    "monthEleCost": float(item.get("monthEleCost", 0)),
                    "monthTPq": float(item.get("month_t_ele_num", 0)),
                    "monthPPq": float(item.get("month_p_ele_num", 0)),
                    "monthNPq": float(item.get("month_n_ele_num", 0)),
                    "monthVPq": float(item.get("month_v_ele_num", 0)),
                }
            )

        return sorted(monthly, key=lambda x: x["month"], reverse=True)

    @staticmethod
    def _build_yearly_from_monthly(month_list: list[dict[str, Any]]) -> list[dict[str, Any]]:
        yearly_map: dict[str, dict[str, float | str]] = {}
        for month_item in month_list:
            year = str(month_item.get("month", ""))[:4]
            if not year:
                continue
            if year not in yearly_map:
                yearly_map[year] = {
                    "year": year,
                    "yearEleNum": 0.0,
                    "yearEleCost": 0.0,
                    "yearTPq": 0.0,
                    "yearPPq": 0.0,
                    "yearNPq": 0.0,
                    "yearVPq": 0.0,
                }
            agg = yearly_map[year]
            agg["yearEleNum"] += float(month_item.get("monthEleNum", 0))
            agg["yearEleCost"] += float(month_item.get("monthEleCost", 0))
            agg["yearTPq"] += float(month_item.get("monthTPq", 0))
            agg["yearPPq"] += float(month_item.get("monthPPq", 0))
            agg["yearNPq"] += float(month_item.get("monthNPq", 0))
            agg["yearVPq"] += float(month_item.get("monthVPq", 0))

        result = []
        for row in yearly_map.values():
            result.append(
                {
                    "year": row["year"],
                    "yearEleNum": round(float(row["yearEleNum"]), 2),
                    "yearEleCost": round(float(row["yearEleCost"]), 2),
                    "yearTPq": round(float(row["yearTPq"]), 2),
                    "yearPPq": round(float(row["yearPPq"]), 2),
                    "yearNPq": round(float(row["yearNPq"]), 2),
                    "yearVPq": round(float(row["yearVPq"]), 2),
                }
            )
        return sorted(result, key=lambda x: x["year"], reverse=True)

    def _fetch_hassbox_user_data(self) -> dict[str, Any]:
        """Read local HassBox cache file and return selected power user data."""
        try:
            config_path = self.hass.config.path(".storage", "state_grid.config")
            if not os.path.exists(config_path):
                return {}

            with open(config_path, "r", encoding="utf-8") as f:
                raw = json.load(f)

            users = (((raw or {}).get("data") or {}).get("powerUserList") or [])
            index = int(self.config.get(CONF_CONSUMER_NUMBER_INDEX, 0))
            if 0 <= index < len(users):
                return users[index]
            return {}
        except Exception as exc:
            _LOGGER.error("Failed to fetch HassBox data: %s", exc)
            return {}
