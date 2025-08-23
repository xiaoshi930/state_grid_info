"""Config flow for State Grid Info integration."""
import json
import logging
import os
import voluptuous as vol
import paho.mqtt.client as mqtt

from homeassistant import config_entries
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv

from .const import (
    DOMAIN, NAME,
    DATA_SOURCE_HASSBOX, DATA_SOURCE_QINGLONG, DATA_SOURCE_OPTIONS, DATA_SOURCE_NAMES,
    BILLING_TYPE_SINGLE, BILLING_TYPE_SEGMENTED, BILLING_TYPE_OPTIONS, BILLING_TYPE_NAMES,
    BILLING_STANDARD_OPTIONS, BILLING_STANDARD_NAMES,
    BILLING_STANDARD_YEAR_阶梯, BILLING_STANDARD_YEAR_阶梯_峰平谷,
    BILLING_STANDARD_MONTH_阶梯, BILLING_STANDARD_MONTH_阶梯_峰平谷,
    BILLING_STANDARD_MONTH_阶梯_峰平谷_变动价格, BILLING_STANDARD_OTHER_平均单价,
    CONF_DATA_SOURCE, CONF_BILLING_TYPE, CONF_BILLING_STANDARD,
    CONF_SEGMENT_DATE, CONF_SEGMENT_BEFORE_STANDARD, CONF_SEGMENT_AFTER_STANDARD,
    CONF_CONSUMER_NUMBER, CONF_CONSUMER_NUMBER_INDEX,
    CONF_MQTT_HOST, CONF_MQTT_PORT, CONF_MQTT_USERNAME, CONF_MQTT_PASSWORD, CONF_STATE_GRID_ID,
    CONF_LADDER_LEVEL_1, CONF_LADDER_LEVEL_2,
    CONF_LADDER_PRICE_1, CONF_LADDER_PRICE_2, CONF_LADDER_PRICE_3,
    CONF_YEAR_LADDER_START,
    CONF_PRICE_PEAK, CONF_PRICE_FLAT, CONF_PRICE_VALLEY, CONF_PRICE_TIP,
    CONF_MONTH_PRICES, CONF_AVERAGE_PRICE,
)

_LOGGER = logging.getLogger(__name__)

class StateGridInfoConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for State Grid Info."""

    VERSION = 1

    def __init__(self):
        self._data = {}
        self._consumer_numbers = []
        self._hassbox_data = None

    #处理配置流程的初始步骤
    async def async_step_user(self, user_input=None):
        return await self.async_step_data_source(user_input)

    #选择的数据源
    async def async_step_data_source(self, user_input=None):
        errors = {}
        
        if user_input is not None:
            self._data[CONF_DATA_SOURCE] = user_input[CONF_DATA_SOURCE]
            
            if user_input[CONF_DATA_SOURCE] == DATA_SOURCE_HASSBOX:
                return await self.async_step_hassbox_consumer()
            else:
                return await self.async_step_qinglong_mqtt()
        
        data_source_options = {k: DATA_SOURCE_NAMES[k] for k in DATA_SOURCE_OPTIONS}
        
        return self.async_show_form(
            step_id="data_source",
            data_schema=vol.Schema({
                vol.Required(CONF_DATA_SOURCE, default=DATA_SOURCE_HASSBOX): vol.In(data_source_options),
            }),
            errors=errors,
        )

    #处理HassBox集成
    async def async_step_hassbox_consumer(self, user_input=None):
        errors = {}
        
        if self._consumer_numbers == []:
            try:
                # 读取HassBox配置文件
                config_path = self.hass.config.path(".storage", "state_grid.config")
                if os.path.exists(config_path):
                    with open(config_path, "r", encoding="utf-8") as file:
                        config_data = json.load(file)
                        self._hassbox_data = config_data
                        
                        if "data" in config_data and "powerUserList" in config_data["data"]:
                            power_user_list = config_data["data"]["powerUserList"]
                            for i, user in enumerate(power_user_list):
                                if "consNo_dst" in user:
                                    self._consumer_numbers.append({
                                        "index": i,
                                        "number": user["consNo_dst"]
                                    })
                else:
                    errors["base"] = "hassbox_config_not_found"
            except Exception as ex:
                _LOGGER.error("Error reading HassBox config: %s", ex)
                errors["base"] = "hassbox_config_error"
        
        if user_input is not None and not errors:
            self._data[CONF_CONSUMER_NUMBER] = user_input[CONF_CONSUMER_NUMBER]
            self._data[CONF_CONSUMER_NUMBER_INDEX] = next(
                (item["index"] for item in self._consumer_numbers if item["number"] == user_input[CONF_CONSUMER_NUMBER]),
                0
            )
            return await self.async_step_billing_type()
        
        consumer_options = {item["number"]: item["number"] for item in self._consumer_numbers}
        
        return self.async_show_form(
            step_id="hassbox_consumer",
            data_schema=vol.Schema({
                vol.Required(CONF_CONSUMER_NUMBER): vol.In(consumer_options),
            }),
            errors=errors,
        )

    # MQTT配置
    async def async_step_qinglong_mqtt(self, user_input=None):
        errors = {}
        
        if user_input is not None:
            # 保存MQTT配置
            self._data[CONF_MQTT_HOST] = user_input[CONF_MQTT_HOST]
            self._data[CONF_MQTT_PORT] = user_input[CONF_MQTT_PORT]
            self._data[CONF_MQTT_USERNAME] = user_input[CONF_MQTT_USERNAME]
            self._data[CONF_MQTT_PASSWORD] = user_input[CONF_MQTT_PASSWORD]
            self._data[CONF_STATE_GRID_ID] = user_input[CONF_STATE_GRID_ID]
            self._data[CONF_CONSUMER_NUMBER] = user_input[CONF_STATE_GRID_ID]
            
            # 可以在这里添加MQTT连接测试
            
            return await self.async_step_billing_type()
        
        return self.async_show_form(
            step_id="qinglong_mqtt",
            data_schema=vol.Schema({
                vol.Required(CONF_MQTT_HOST): cv.string,
                vol.Required(CONF_MQTT_PORT, default=1883): cv.port,
                vol.Required(CONF_MQTT_USERNAME): cv.string,
                vol.Required(CONF_MQTT_PASSWORD): cv.string,
                vol.Required(CONF_STATE_GRID_ID): cv.string,
            }),
            errors=errors,
        )

    #选择计费类型（单一计费、分段计费）
    async def async_step_billing_type(self, user_input=None):
        errors = {}
        
        if user_input is not None:
            self._data[CONF_BILLING_TYPE] = user_input[CONF_BILLING_TYPE]
            
            if user_input[CONF_BILLING_TYPE] == BILLING_TYPE_SINGLE:
                # 直接进入单一计费标准选择
                billing_standard_options = {k: BILLING_STANDARD_NAMES[k] for k in BILLING_STANDARD_OPTIONS}
                return self.async_show_form(
                    step_id="billing_standard",
                    data_schema=vol.Schema({
                        vol.Required(CONF_BILLING_STANDARD): vol.In(billing_standard_options),
                    }),
                    errors=errors,
                )
            else:
                return await self.async_step_segmented_billing()
        
        billing_type_options = {k: BILLING_TYPE_NAMES[k] for k in BILLING_TYPE_OPTIONS}
        
        return self.async_show_form(
            step_id="billing_type",
            data_schema=vol.Schema({
                vol.Required(CONF_BILLING_TYPE, default=BILLING_TYPE_SINGLE): vol.In(billing_type_options),
            }),
            errors=errors,
        )

    # 单一计费：计费标准
    async def async_step_billing_standard(self, user_input=None):
        errors = {}
        
        if user_input is not None:
            self._data[CONF_BILLING_STANDARD] = user_input[CONF_BILLING_STANDARD]
            
            # 获取当前计费标准的配置表单
            current_standard = self._data.get(CONF_BILLING_STANDARD)
            schema = self._get_billing_schema(current_standard)
            
            # 直接显示配置表单
            return self.async_show_form(
                step_id="billing_standard_config",
                data_schema=vol.Schema(schema),
                errors=errors,
                description_placeholders={
                    "standard": BILLING_STANDARD_NAMES.get(current_standard, ""),
                    "segment": "",
                },
            )

        billing_standard_options = {k: BILLING_STANDARD_NAMES[k] for k in BILLING_STANDARD_OPTIONS}
        
        return self.async_show_form(
            step_id="billing_standard",
            data_schema=vol.Schema({
                vol.Required(CONF_BILLING_STANDARD): vol.In(billing_standard_options),
            }),
            errors=errors,
        )
      
    # 单一计费：计费标准（表单配置）
    async def async_step_billing_standard_config(self, user_input=None):
        errors = {}
        current_standard = self._data.get(CONF_BILLING_STANDARD)
        
        if user_input is not None:
            # 保存配置
            for key, value in user_input.items():
                self._data[key] = value
            
            # 配置完成，创建条目
            title = f"{NAME} - {self._data.get(CONF_CONSUMER_NUMBER)}"
            return self.async_create_entry(title=title, data=self._data)
        
        # 获取表单配置
        schema = self._get_billing_schema(current_standard)
        
        return self.async_show_form(
            step_id="billing_standard_config",
            data_schema=vol.Schema(schema),
            errors=errors,
            description_placeholders={
                "standard": BILLING_STANDARD_NAMES.get(current_standard, ""),
                "segment": "",
            },
        )

    # 分段计费：计费标准（分段计费标准）
    async def async_step_segmented_billing(self, user_input=None):
        errors = {}
        
        if user_input is not None:
            self._data[CONF_SEGMENT_DATE] = user_input[CONF_SEGMENT_DATE]
            self._data[CONF_SEGMENT_BEFORE_STANDARD] = user_input[CONF_SEGMENT_BEFORE_STANDARD]
            self._data[CONF_SEGMENT_AFTER_STANDARD] = user_input[CONF_SEGMENT_AFTER_STANDARD]
            
            # 设置当前计费标准为分段前标准
            self._data[CONF_BILLING_STANDARD] = user_input[CONF_SEGMENT_BEFORE_STANDARD]
            # 明确标记这是前段配置，后续会自动跳转到后段
            self._data['_pending_after_standard'] = user_input[CONF_SEGMENT_AFTER_STANDARD]
            
            # 添加调试日志
            _LOGGER.debug("Starting segmented billing config: before_standard=%s, after_standard=%s", 
                         user_input[CONF_SEGMENT_BEFORE_STANDARD], user_input[CONF_SEGMENT_AFTER_STANDARD])
            
            # 获取分段前计费标准的配置表单
            current_standard = self._data.get(CONF_SEGMENT_BEFORE_STANDARD)
            schema = self._get_billing_schema(current_standard, is_before_segment=True)
            
            # 直接显示分段前配置表单
            return self.async_show_form(
                step_id="before_segment_config",
                data_schema=vol.Schema(schema),
                errors=errors,
                description_placeholders={
                    "standard": BILLING_STANDARD_NAMES.get(current_standard, ""),
                    "segment": "分段前",
                },
            )
        
        billing_standard_options = {k: BILLING_STANDARD_NAMES[k] for k in BILLING_STANDARD_OPTIONS}
        
        return self.async_show_form(
            step_id="segmented_billing",
            data_schema=vol.Schema({
                vol.Required(CONF_SEGMENT_DATE): cv.string,
                vol.Required(CONF_SEGMENT_BEFORE_STANDARD): vol.In(billing_standard_options),
                vol.Required(CONF_SEGMENT_AFTER_STANDARD): vol.In(billing_standard_options),
            }),
            errors=errors,
        )

    # 分段计费：分段前（表单配置）
    async def async_step_before_segment_config(self, user_input=None):
        """
        处理分段前计费标准配置步骤
        
        Args:
            user_input (dict, optional): 用户输入的配置数据，默认为None
            
        Returns:
            dict: 保存配置后跳转到分段后配置步骤
        """
        errors = {}
        current_standard = self._data.get(CONF_SEGMENT_BEFORE_STANDARD)
        _LOGGER.debug("Configuring BEFORE segment standard: %s", current_standard)
        
        if user_input is not None:
            # 保存配置，使用 before_ 前缀
            for key, value in user_input.items():
                self._data[f"before_{key}"] = value
            
            # 设置后段计费标准
            if self._data.get('_pending_after_standard'):
                self._data[CONF_BILLING_STANDARD] = self._data['_pending_after_standard']
                _LOGGER.debug("Switching to AFTER segment standard: %s", self._data[CONF_BILLING_STANDARD])
                del self._data['_pending_after_standard']
                
                # 获取分段后计费标准的配置表单
                after_standard = self._data.get(CONF_SEGMENT_AFTER_STANDARD)
                schema = self._get_billing_schema(after_standard, is_before_segment=False)
                
                # 直接显示分段后配置表单
                return self.async_show_form(
                    step_id="after_segment_config",
                    data_schema=vol.Schema(schema),
                    errors=errors,
                    description_placeholders={
                        "standard": BILLING_STANDARD_NAMES.get(after_standard, ""),
                        "segment": "分段后",
                    },
                )
            
            # 如果没有后段配置，直接创建条目
            title = f"{NAME} - {self._data.get(CONF_CONSUMER_NUMBER)}"
            return self.async_create_entry(title=title, data=self._data)
        
        # 获取表单配置
        schema = self._get_billing_schema(current_standard, is_before_segment=True)
        
        return self.async_show_form(
            step_id="before_segment_config",
            data_schema=vol.Schema(schema),
            errors=errors,
            description_placeholders={
                "standard": BILLING_STANDARD_NAMES.get(current_standard, ""),
                "segment": "分段前",
            },
        )

    # 分段计费：分段后（表单配置）
    async def async_step_after_segment_config(self, user_input=None):
        """Handle the after-segment billing standard configuration step."""
        errors = {}
        current_standard = self._data.get(CONF_SEGMENT_AFTER_STANDARD)
        _LOGGER.debug("Configuring AFTER segment standard: %s", current_standard)

        if user_input is not None:
            # 保存配置，使用 after_ 前缀
            for key, value in user_input.items():
                self._data[f"after_{key}"] = value
            
            # 配置完成，创建条目
            title = f"{NAME} - {self._data.get(CONF_CONSUMER_NUMBER)}"
            return self.async_create_entry(title=title, data=self._data)
        
        # 根据不同的计费标准，显示不同的配置表单
        schema = self._get_billing_schema(current_standard, is_before_segment=False)
        
        return self.async_show_form(
            step_id="after_segment_config",
            data_schema=vol.Schema(schema),
            errors=errors,
            description_placeholders={
                "standard": BILLING_STANDARD_NAMES.get(current_standard, ""),
                "segment": "分段后"
            },
        )

    #获取表单配置
    def _get_billing_schema(self, current_standard, is_before_segment=False):
        schema = {}
        
        # 年阶梯
        if current_standard == BILLING_STANDARD_YEAR_阶梯:
            schema = {
                vol.Required(CONF_LADDER_LEVEL_1, default=2160): cv.positive_float,
                vol.Required(CONF_LADDER_LEVEL_2, default=4200): cv.positive_float,
                vol.Required(CONF_LADDER_PRICE_1, default=0.4983): cv.positive_float,
                vol.Required(CONF_LADDER_PRICE_2, default=0.5483): cv.positive_float,
                vol.Required(CONF_LADDER_PRICE_3, default=0.7983): cv.positive_float,
                vol.Required(CONF_YEAR_LADDER_START, default="0101"): cv.string,  # 格式：月日 (MMDD)
            }
        # 年阶梯峰平谷
        elif current_standard == BILLING_STANDARD_YEAR_阶梯_峰平谷:
            schema = {
                vol.Required(CONF_LADDER_LEVEL_1, default=2160): cv.positive_float,
                vol.Required(CONF_LADDER_LEVEL_2, default=4200): cv.positive_float,
                # 第一阶梯价格
                vol.Required(f"{CONF_LADDER_PRICE_1}_{CONF_PRICE_TIP}", default=0.5483): cv.positive_float,
                vol.Required(f"{CONF_LADDER_PRICE_1}_{CONF_PRICE_PEAK}", default=0.5483): cv.positive_float,
                vol.Required(f"{CONF_LADDER_PRICE_1}_{CONF_PRICE_FLAT}", default=0.5483): cv.positive_float,
                vol.Required(f"{CONF_LADDER_PRICE_1}_{CONF_PRICE_VALLEY}", default=0.2983): cv.positive_float,
                # 第二阶梯价格
                vol.Required(f"{CONF_LADDER_PRICE_2}_{CONF_PRICE_TIP}", default=0.5983): cv.positive_float,
                vol.Required(f"{CONF_LADDER_PRICE_2}_{CONF_PRICE_PEAK}", default=0.5983): cv.positive_float,
                vol.Required(f"{CONF_LADDER_PRICE_2}_{CONF_PRICE_FLAT}", default=0.5983): cv.positive_float,
                vol.Required(f"{CONF_LADDER_PRICE_2}_{CONF_PRICE_VALLEY}", default=0.3483): cv.positive_float,
                # 第三阶梯价格
                vol.Required(f"{CONF_LADDER_PRICE_3}_{CONF_PRICE_TIP}", default=0.8483): cv.positive_float,
                vol.Required(f"{CONF_LADDER_PRICE_3}_{CONF_PRICE_PEAK}", default=0.8483): cv.positive_float,
                vol.Required(f"{CONF_LADDER_PRICE_3}_{CONF_PRICE_FLAT}", default=0.8483): cv.positive_float,
                vol.Required(f"{CONF_LADDER_PRICE_3}_{CONF_PRICE_VALLEY}", default=0.5983): cv.positive_float,
                vol.Required(CONF_YEAR_LADDER_START, default="0101"): cv.string,  # 格式：月日 (MMDD)
            }
        # 月阶梯
        elif current_standard == BILLING_STANDARD_MONTH_阶梯:
            schema = {
                vol.Required(CONF_LADDER_LEVEL_1, default=180): cv.positive_float,
                vol.Required(CONF_LADDER_LEVEL_2, default=280): cv.positive_float,
                vol.Required(CONF_LADDER_PRICE_1, default=0.5224): cv.positive_float,
                vol.Required(CONF_LADDER_PRICE_2, default=0.6224): cv.positive_float,
                vol.Required(CONF_LADDER_PRICE_3, default=0.8334): cv.positive_float,
            }
        # 月阶梯峰平谷
        elif current_standard == BILLING_STANDARD_MONTH_阶梯_峰平谷:
            schema = {
                vol.Required(CONF_LADDER_LEVEL_1, default=180): cv.positive_float,
                vol.Required(CONF_LADDER_LEVEL_2, default=280): cv.positive_float,
                # 第一阶梯价格
                vol.Required(f"{CONF_LADDER_PRICE_1}_{CONF_PRICE_TIP}", default=0): cv.positive_float,
                vol.Required(f"{CONF_LADDER_PRICE_1}_{CONF_PRICE_PEAK}", default=0.2): cv.positive_float,
                vol.Required(f"{CONF_LADDER_PRICE_1}_{CONF_PRICE_FLAT}", default=0.3): cv.positive_float,
                vol.Required(f"{CONF_LADDER_PRICE_1}_{CONF_PRICE_VALLEY}", default=0.5): cv.positive_float,
                # 第二阶梯价格
                vol.Required(f"{CONF_LADDER_PRICE_2}_{CONF_PRICE_TIP}", default=0): cv.positive_float,
                vol.Required(f"{CONF_LADDER_PRICE_2}_{CONF_PRICE_PEAK}", default=0.2): cv.positive_float,
                vol.Required(f"{CONF_LADDER_PRICE_2}_{CONF_PRICE_FLAT}", default=0.3): cv.positive_float,
                vol.Required(f"{CONF_LADDER_PRICE_2}_{CONF_PRICE_VALLEY}", default=0.5): cv.positive_float,
                # 第三阶梯价格
                vol.Required(f"{CONF_LADDER_PRICE_3}_{CONF_PRICE_TIP}", default=0): cv.positive_float,
                vol.Required(f"{CONF_LADDER_PRICE_3}_{CONF_PRICE_PEAK}", default=0.2): cv.positive_float,
                vol.Required(f"{CONF_LADDER_PRICE_3}_{CONF_PRICE_FLAT}", default=0.3): cv.positive_float,
                vol.Required(f"{CONF_LADDER_PRICE_3}_{CONF_PRICE_VALLEY}", default=0.5): cv.positive_float,
            }
        # 月阶梯峰平谷_变动价格
        elif current_standard == BILLING_STANDARD_MONTH_阶梯_峰平谷_变动价格:
            # 为12个月的3个阶梯的谷电价创建36个输入字段
            # 以及全年的尖、峰、平单价
            schema = {
                vol.Required(CONF_LADDER_LEVEL_1, default=180): cv.positive_float,
                vol.Required(CONF_LADDER_LEVEL_2, default=280): cv.positive_float,
                vol.Required(CONF_PRICE_TIP, default=0.5224): cv.positive_float,
                vol.Required(CONF_PRICE_PEAK, default=0.6224): cv.positive_float,
                vol.Required(CONF_PRICE_FLAT, default=0.8224): cv.positive_float,
                
                # 1月份的三个阶梯谷电价
                vol.Required(f"month_01_ladder_1_valley", default=0.2535): cv.positive_float,
                vol.Required(f"month_01_ladder_2_valley", default=0.3535): cv.positive_float,
                vol.Required(f"month_01_ladder_3_valley", default=0.5535): cv.positive_float,
                
                # 2月份的三个阶梯谷电价
                vol.Required(f"month_02_ladder_1_valley", default=0.2535): cv.positive_float,
                vol.Required(f"month_02_ladder_2_valley", default=0.3535): cv.positive_float,
                vol.Required(f"month_02_ladder_3_valley", default=0.5535): cv.positive_float,
                
                # 3月份的三个阶梯谷电价
                vol.Required(f"month_03_ladder_1_valley", default=0.2535): cv.positive_float,
                vol.Required(f"month_03_ladder_2_valley", default=0.3535): cv.positive_float,
                vol.Required(f"month_03_ladder_3_valley", default=0.5535): cv.positive_float,
                
                # 4月份的三个阶梯谷电价
                vol.Required(f"month_04_ladder_1_valley", default=0.2535): cv.positive_float,
                vol.Required(f"month_04_ladder_2_valley", default=0.3535): cv.positive_float,
                vol.Required(f"month_04_ladder_3_valley", default=0.5535): cv.positive_float,
                
                # 5月份的三个阶梯谷电价
                vol.Required(f"month_05_ladder_1_valley", default=0.2535): cv.positive_float,
                vol.Required(f"month_05_ladder_2_valley", default=0.3535): cv.positive_float,
                vol.Required(f"month_05_ladder_3_valley", default=0.5535): cv.positive_float,
                
                # 6月份的三个阶梯谷电价
                vol.Required(f"month_06_ladder_1_valley", default=0.1750): cv.positive_float,
                vol.Required(f"month_06_ladder_2_valley", default=0.2750): cv.positive_float,
                vol.Required(f"month_06_ladder_3_valley", default=0.4750): cv.positive_float,
                
                # 7月份的三个阶梯谷电价
                vol.Required(f"month_07_ladder_1_valley", default=0.1750): cv.positive_float,
                vol.Required(f"month_07_ladder_2_valley", default=0.2750): cv.positive_float,
                vol.Required(f"month_07_ladder_3_valley", default=0.4750): cv.positive_float,
                
                # 8月份的三个阶梯谷电价
                vol.Required(f"month_08_ladder_1_valley", default=0.1750): cv.positive_float,
                vol.Required(f"month_08_ladder_2_valley", default=0.2750): cv.positive_float,
                vol.Required(f"month_08_ladder_3_valley", default=0.4750): cv.positive_float,
                
                # 9月份的三个阶梯谷电价
                vol.Required(f"month_09_ladder_1_valley", default=0.1750): cv.positive_float,
                vol.Required(f"month_09_ladder_2_valley", default=0.2750): cv.positive_float,
                vol.Required(f"month_09_ladder_3_valley", default=0.4750): cv.positive_float,
                
                # 10月份的三个阶梯谷电价
                vol.Required(f"month_10_ladder_1_valley", default=0.1750): cv.positive_float,
                vol.Required(f"month_10_ladder_2_valley", default=0.2750): cv.positive_float,
                vol.Required(f"month_10_ladder_3_valley", default=0.4750): cv.positive_float,
                
                # 11月份的三个阶梯谷电价
                vol.Required(f"month_11_ladder_1_valley", default=0.2535): cv.positive_float,
                vol.Required(f"month_11_ladder_2_valley", default=0.3535): cv.positive_float,
                vol.Required(f"month_11_ladder_3_valley", default=0.5535): cv.positive_float,
                
                # 12月份的三个阶梯谷电价
                vol.Required(f"month_12_ladder_1_valley", default=0.2535): cv.positive_float,
                vol.Required(f"month_12_ladder_2_valley", default=0.3535): cv.positive_float,
                vol.Required(f"month_12_ladder_3_valley", default=0.5535): cv.positive_float,
            }
        elif current_standard == BILLING_STANDARD_OTHER_平均单价:
            schema = {
                vol.Required(CONF_AVERAGE_PRICE, default=0.6): cv.positive_float,
            }
            
        return schema

class CannotConnect(HomeAssistantError):
    """Error to indicate we cannot connect."""

class InvalidAuth(HomeAssistantError):
    """Error to indicate there is invalid auth."""