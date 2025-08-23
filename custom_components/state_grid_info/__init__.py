"""国家电网辅助信息集成."""
import logging
import os
import homeassistant.helpers.config_validation as cv
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.const import Platform
from homeassistant.components.http import StaticPathConfig
from homeassistant.components.frontend import add_extra_js_url

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.SENSOR]

# 前端卡片文件路径
CARD_FILENAME = "state-grid-card.js"

async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the State Grid Info component."""
    # 注册前端卡片
    await setup_state_grid_card(hass)
    return True

async def setup_state_grid_card(hass: HomeAssistant) -> bool:
    """设置国家电网卡片前端资源."""
    state_grid_card_path = '/state_grid_info-local'
    await hass.http.async_register_static_paths([
        StaticPathConfig(state_grid_card_path, hass.config.path('custom_components/state_grid_info/www'), False)
    ])
    _LOGGER.debug(f"register_static_path: {state_grid_card_path + ':custom_components/state_grid_info/www'}")
    add_extra_js_url(hass, state_grid_card_path + f"/state-grid-card.js")
    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up State Grid Info from a config entry."""
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = entry.data
    
    # 添加前端资源
    await setup_state_grid_card(hass)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)

    return unload_ok