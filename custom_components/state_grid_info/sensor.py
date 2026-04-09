"""Sensor platform for State Grid Info integration."""

import logging
import math
from datetime import datetime
from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_CONSUMER_NAME, CONF_CONSUMER_NUMBER, CONF_DATA_SOURCE, DOMAIN
from .coordinator import StateGridInfoCoordinator

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Set up State Grid Info sensors from a config entry."""
    entry_data = hass.data.setdefault(DOMAIN, {}).setdefault(
        entry.entry_id,
        {"config": entry.data, "entities": []},
    )

    coordinator: StateGridInfoCoordinator | None = entry_data.get("coordinator")
    if coordinator is None:
        coordinator = StateGridInfoCoordinator(hass, entry.data)
        entry_data["coordinator"] = coordinator

    await coordinator.async_prepare()
    await coordinator.async_config_entry_first_refresh()

    entities: list[SensorEntity] = [
        StateGridInfoOverviewSensor(coordinator, entry.data),
        StateGridInfoTotalEnergySensor(coordinator, entry.data),
        StateGridInfoCurrentMonthEnergySensor(coordinator, entry.data),
        StateGridInfoCurrentMonthCostSensor(coordinator, entry.data),
        StateGridInfoTotalCostSensor(coordinator, entry.data),
    ]
    entry_data["entities"] = entities
    async_add_entities(entities)


class StateGridInfoBaseSensor(CoordinatorEntity, SensorEntity):
    """Common base entity backed by the shared coordinator."""

    _attr_has_entity_name = False
    _attr_should_poll = False
    _attr_suggested_display_precision = 2

    def __init__(
        self,
        coordinator: StateGridInfoCoordinator,
        config: dict[str, Any],
        *,
        unique_suffix: str,
        entity_suffix: str,
        name_suffix: str,
        icon: str,
    ) -> None:
        super().__init__(coordinator)
        self.config = config
        self._consumer_number = str(config.get(CONF_CONSUMER_NUMBER, ""))
        self._attr_unique_id = f"state_grid_{self._consumer_number}{unique_suffix}"
        self.entity_id = f"sensor.state_grid_{self._consumer_number}{entity_suffix}"
        base_name = f"国家电网 {self._consumer_number}"
        self._attr_name = base_name if not name_suffix else f"{base_name} {name_suffix}"
        self._attr_icon = icon

    @property
    def available(self) -> bool:
        """Return whether the entity is available.

        State Grid data is delayed by design, so previously cached data should
        remain available even when no fresh payload arrives for a long period.
        """
        return bool(self.coordinator.runtime_snapshot or self.coordinator.data)

    @property
    def device_info(self) -> dict[str, Any]:
        """Return the shared device info."""
        snapshot = self.coordinator.runtime_snapshot or {}
        consumer_name = snapshot.get("consumer_name") or self.config.get(CONF_CONSUMER_NAME, "")
        return {
            "identifiers": {(DOMAIN, f"state_grid_{self._consumer_number}")},
            "name": f"国家电网 {self._consumer_number}",
            "manufacturer": "国家电网",
            "model": f"户名:{consumer_name}",
        }

    def _snapshot(self) -> dict[str, Any]:
        return self.coordinator.runtime_snapshot or {}


class StateGridInfoOverviewSensor(StateGridInfoBaseSensor):
    """Primary overview sensor kept for UI card compatibility."""

    _attr_native_unit_of_measurement = "元"

    def __init__(self, coordinator: StateGridInfoCoordinator, config: dict[str, Any]) -> None:
        super().__init__(
            coordinator,
            config,
            unique_suffix="",
            entity_suffix="",
            name_suffix="",
            icon="mdi:flash",
        )

    @property
    def native_value(self) -> float:
        """Return the account balance."""
        snapshot = self._snapshot()
        return float(snapshot.get("balance", 0.0))

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return card-compatible overview attributes."""
        snapshot = self._snapshot()
        overview = snapshot.get("overview", {})
        billing = snapshot.get("billing", {})
        daylist = overview.get("daylist", [])

        attrs: dict[str, Any] = {
            "date": snapshot.get("date", ""),
            "daylist": daylist,
            "monthlist": overview.get("monthlist", []),
            "yearlist": overview.get("yearlist", []),
            "数据源": self.config.get(CONF_DATA_SOURCE, "unknown"),
        }

        if daylist:
            recent_days = daylist[:7]
            daily_costs = [float(day.get("dayEleCost", 0)) for day in recent_days]
            if daily_costs:
                avg_daily_cost = sum(daily_costs) / len(daily_costs)
                attrs["日均消费"] = round(avg_daily_cost, 2)
                if avg_daily_cost > 0:
                    try:
                        latest_date = datetime.strptime(daylist[0]["day"], "%Y-%m-%d")
                        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
                        days_since_latest = (today - latest_date).days
                        remaining_days = max(0.0, self.native_value / avg_daily_cost - days_since_latest)
                        attrs["剩余天数"] = math.ceil(remaining_days)
                    except (KeyError, ValueError) as exc:
                        _LOGGER.debug("Failed to calculate remaining prepaid days: %s", exc)

        attrs["预付费"] = billing.get("is_prepaid", "否")

        billing_attrs = dict(billing.get("config", {}))
        billing_attrs.update(billing.get("ladder_info", {}))
        attrs["计费标准"] = billing_attrs

        last_sync_at = snapshot.get("last_sync_at", "")
        if last_sync_at:
            try:
                attrs["最后同步日期"] = datetime.fromisoformat(last_sync_at).strftime("%Y-%m-%d %H:%M:%S")
            except ValueError:
                attrs["最后同步日期"] = last_sync_at
        else:
            attrs["最后同步日期"] = self.coordinator.last_update_time.strftime("%Y-%m-%d %H:%M:%S")

        return attrs


class StateGridInfoTotalEnergySensor(StateGridInfoBaseSensor):
    """Lifetime cumulative energy for Home Assistant Energy dashboard."""

    _attr_native_unit_of_measurement = "kWh"
    _attr_device_class = SensorDeviceClass.ENERGY
    _attr_state_class = SensorStateClass.TOTAL_INCREASING

    def __init__(self, coordinator: StateGridInfoCoordinator, config: dict[str, Any]) -> None:
        super().__init__(
            coordinator,
            config,
            unique_suffix="_total_energy",
            entity_suffix="_total_energy",
            name_suffix="累计用电",
            icon="mdi:lightning-bolt",
        )

    @property
    def native_value(self) -> float:
        snapshot = self._snapshot()
        return float(snapshot.get("energy", {}).get("total_energy_kwh", 0.0))

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        snapshot = self._snapshot()
        energy = snapshot.get("energy", {})
        cost = snapshot.get("cost", {})
        return {
            "最后结算日期": energy.get("last_official_day", ""),
            "当月用电": energy.get("current_month_kwh", 0.0),
            "当年用电": energy.get("current_year_kwh", 0.0),
            "累计电费": cost.get("total_cost", 0.0),
        }


class StateGridInfoCurrentMonthEnergySensor(StateGridInfoBaseSensor):
    """Current month electricity usage."""

    _attr_native_unit_of_measurement = "kWh"
    _attr_device_class = SensorDeviceClass.ENERGY

    def __init__(self, coordinator: StateGridInfoCoordinator, config: dict[str, Any]) -> None:
        super().__init__(
            coordinator,
            config,
            unique_suffix="_current_month_energy",
            entity_suffix="_current_month_energy",
            name_suffix="当月用电",
            icon="mdi:calendar-month",
        )

    @property
    def native_value(self) -> float:
        snapshot = self._snapshot()
        return float(snapshot.get("energy", {}).get("current_month_kwh", 0.0))

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        snapshot = self._snapshot()
        energy = snapshot.get("energy", {})
        return {
            "最后结算日期": energy.get("last_official_day", ""),
        }


class StateGridInfoCurrentMonthCostSensor(StateGridInfoBaseSensor):
    """Current month electricity cost."""

    _attr_native_unit_of_measurement = "元"

    def __init__(self, coordinator: StateGridInfoCoordinator, config: dict[str, Any]) -> None:
        super().__init__(
            coordinator,
            config,
            unique_suffix="_current_month_cost",
            entity_suffix="_current_month_cost",
            name_suffix="当月电费",
            icon="mdi:cash",
        )

    @property
    def native_value(self) -> float:
        snapshot = self._snapshot()
        return float(snapshot.get("cost", {}).get("current_month_cost", 0.0))

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        snapshot = self._snapshot()
        cost = snapshot.get("cost", {})
        return {
            "当年电费": cost.get("current_year_cost", 0.0),
            "累计电费": cost.get("total_cost", 0.0),
            "电费是否预估": cost.get("current_month_cost_is_estimated", False),
        }


class StateGridInfoTotalCostSensor(StateGridInfoBaseSensor):
    """Lifetime cumulative electricity cost."""

    _attr_native_unit_of_measurement = "元"

    def __init__(self, coordinator: StateGridInfoCoordinator, config: dict[str, Any]) -> None:
        super().__init__(
            coordinator,
            config,
            unique_suffix="_total_cost",
            entity_suffix="_total_cost",
            name_suffix="累计电费",
            icon="mdi:cash-multiple",
        )

    @property
    def native_value(self) -> float:
        snapshot = self._snapshot()
        return float(snapshot.get("cost", {}).get("total_cost", 0.0))

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        snapshot = self._snapshot()
        cost = snapshot.get("cost", {})
        energy = snapshot.get("energy", {})
        return {
            "当月电费": cost.get("current_month_cost", 0.0),
            "当年电费": cost.get("current_year_cost", 0.0),
            "累计用电": energy.get("total_energy_kwh", 0.0),
        }
