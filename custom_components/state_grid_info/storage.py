"""Persistent storage for State Grid Info integration."""
import json
import logging
import os
from typing import Any

_LOGGER = logging.getLogger(__name__)


class StateGridStorage:
    """Manage persistent JSON storage for state grid data.

    Rules:
    - Data can only be added, never deleted.
    - Existing entries can be updated with new values.
    - dayList is merged by "day" key.
    - monthList is merged by "month" key.
    - yearList is merged by "year" key.
    """

    def __init__(self, hass, consumer_number: str):
        """Initialize storage."""
        self._hass = hass
        self._consumer_number = consumer_number
        self._file_path = hass.config.path(f"state_grid_info_{consumer_number}.json")
        self._data: dict[str, Any] = {}

    @property
    def file_path(self) -> str:
        """Return the JSON file path."""
        return self._file_path

    @property
    def data(self) -> dict[str, Any]:
        """Return current stored data."""
        return self._data

    def _load_sync(self) -> None:
        """Load data from JSON file (sync, must run in executor)."""
        try:
            if os.path.exists(self._file_path):
                with open(self._file_path, "r", encoding="utf-8") as f:
                    self._data = json.load(f)
                _LOGGER.info(
                    "已加载持久化数据: %s (dayList=%d条, monthList=%d条, yearList=%d条)",
                    self._file_path,
                    len(self._data.get("dayList", [])),
                    len(self._data.get("monthList", [])),
                    len(self._data.get("yearList", [])),
                )
            else:
                self._data = {
                    "date": "",
                    "balance": 0,
                    "dayList": [],
                    "monthList": [],
                    "yearList": [],
                    "consumer_name": "",
                }
                _LOGGER.info("持久化文件不存在，初始化空数据: %s", self._file_path)
        except (json.JSONDecodeError, IOError) as ex:
            _LOGGER.error("加载持久化数据失败: %s", ex)
            self._data = {
                "date": "",
                "balance": 0,
                "dayList": [],
                "monthList": [],
                "yearList": [],
                "consumer_name": "",
            }

    async def async_load(self) -> None:
        """Load data from JSON file asynchronously."""
        await self._hass.async_add_executor_job(self._load_sync)

    def _save_sync(self) -> None:
        """Save data to JSON file (sync, must run in executor)."""
        try:
            with open(self._file_path, "w", encoding="utf-8") as f:
                json.dump(self._data, f, ensure_ascii=False, indent=2)
            _LOGGER.debug("已保存持久化数据: %s", self._file_path)
        except IOError as ex:
            _LOGGER.error("保存持久化数据失败: %s", ex)

    def _merge_list_by_key(self, existing: list, new_items: list, key: str) -> list:
        """Merge two lists by a key field.

        - New items are added.
        - Existing items (matched by key) are updated with new values.
        - Items only in existing are kept (never deleted).
        """
        existing_map = {item[key]: item for item in existing}
        for item in new_items:
            k = item[key]
            if k in existing_map:
                existing_map[k].update(item)
            else:
                existing_map[k] = item
        return sorted(existing_map.values(), key=lambda x: x[key], reverse=True)

    def update(self, new_data: dict[str, Any]) -> dict[str, Any]:
        """Update storage with new data, then return merged result.

        - dayList: merge by "day"
        - monthList: merge by "month"
        - yearList: merge by "year"
        - Scalar fields (date, balance, consumer_name): always update

        Note: This method does synchronous file I/O via _save_sync.
        It must be called via hass.async_add_executor_job from async code.
        """
        if not new_data:
            return self._data

        # Merge scalar fields - always update
        self._data["date"] = new_data.get("date", self._data.get("date", ""))
        self._data["balance"] = new_data.get("balance", self._data.get("balance", 0))
        self._data["consumer_name"] = new_data.get(
            "consumer_name", self._data.get("consumer_name", "")
        )

        # Merge dayList by "day"
        if "dayList" in new_data:
            self._data["dayList"] = self._merge_list_by_key(
                self._data.get("dayList", []), new_data["dayList"], "day"
            )

        # Merge monthList by "month"
        if "monthList" in new_data:
            self._data["monthList"] = self._merge_list_by_key(
                self._data.get("monthList", []), new_data["monthList"], "month"
            )

        # Merge yearList by "year"
        if "yearList" in new_data:
            self._data["yearList"] = self._merge_list_by_key(
                self._data.get("yearList", []), new_data["yearList"], "year"
            )

        # Save to file
        self._save_sync()

        _LOGGER.info(
            "数据已合并并持久化: dayList=%d条, monthList=%d条, yearList=%d条",
            len(self._data.get("dayList", [])),
            len(self._data.get("monthList", [])),
            len(self._data.get("yearList", [])),
        )

        return dict(self._data)
