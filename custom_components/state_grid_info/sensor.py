"""Sensor platform for State Grid Info integration."""
import logging
import json
import asyncio
from datetime import datetime
import paho.mqtt.client as mqtt

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.util import Throttle
from homeassistant.const import CONF_NAME

from .const import (
    DOMAIN,
    DATA_SOURCE_HASSBOX, DATA_SOURCE_QINGLONG,
    BILLING_TYPE_SINGLE, BILLING_TYPE_SEGMENTED,
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

async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Set up the State Grid Info sensor."""
    config = entry.data
    
    # 创建数据协调器
    coordinator = StateGridInfoDataCoordinator(hass, config)
    await coordinator.async_config_entry_first_refresh()
    
    # 创建传感器实体，确保实体ID包含用户的电力户号
    sensor = StateGridInfoSensor(coordinator, config)
    async_add_entities([sensor], True)


class StateGridInfoDataCoordinator(DataUpdateCoordinator):
    """Class to manage fetching State Grid Info data."""

    def __init__(self, hass: HomeAssistant, config: dict):
        """Initialize the data coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(minutes=10),  # 每10分钟自动更新
        )
        self.config = config
        self.data = None
        self.mqtt_client = None
        self._setup_data_source()

    def _setup_data_source(self):
        """Set up the data source based on configuration."""
        if self.config.get(CONF_DATA_SOURCE) == DATA_SOURCE_HASSBOX:
            # HassBox集成数据源不需要特殊设置
            pass
        elif self.config.get(CONF_DATA_SOURCE) == DATA_SOURCE_QINGLONG:
            # 设置MQTT客户端
            self._setup_mqtt_client()

    def _setup_mqtt_client(self):
        """Set up MQTT client for Qinglong script data source."""
        try:
            client = mqtt.Client()
            client.username_pw_set(
                self.config.get(CONF_MQTT_USERNAME),
                self.config.get(CONF_MQTT_PASSWORD)
            )
            client.on_connect = self._on_mqtt_connect
            client.on_message = self._on_mqtt_message
            
            # 连接MQTT服务器
            client.connect(
                self.config.get(CONF_MQTT_HOST),
                self.config.get(CONF_MQTT_PORT, 1883),
                60
            )
            client.loop_start()
            self.mqtt_client = client
        except Exception as ex:
            _LOGGER.error("Failed to connect to MQTT server: %s", ex)

    def _on_mqtt_connect(self, client, userdata, flags, rc):
        """Handle MQTT connection."""
        _LOGGER.info("Connected to MQTT server with result code %s", rc)
        if rc == 0:
            # 订阅国网ID对应的主题
            topic = f"nodejs/state-grid/{self.config.get(CONF_STATE_GRID_ID)}"
            client.subscribe(topic)
            _LOGGER.info("Subscribed to topic: %s", topic)

    def _on_mqtt_message(self, client, userdata, msg):
        """Handle MQTT message."""
        try:
            _LOGGER.debug("Received message from topic %s", msg.topic)
            payload = json.loads(msg.payload.decode())
            processed_data = self._process_qinglong_data(payload)
            self.data = processed_data
            self.async_set_updated_data(self.data)
        except Exception as ex:
            _LOGGER.error("Error processing MQTT message: %s", ex)

    async def _async_update_data(self):
        """Fetch data from the appropriate source."""
        try:
            if self.config.get(CONF_DATA_SOURCE) == DATA_SOURCE_HASSBOX:
                return await self.hass.async_add_executor_job(self._fetch_hassbox_data)
            elif self.config.get(CONF_DATA_SOURCE) == DATA_SOURCE_QINGLONG:
                # MQTT数据通过回调更新，这里不需要主动获取
                return self.data or {}
            return {}
        except Exception as ex:
            _LOGGER.error("Error updating State Grid Info data: %s", ex)
            raise UpdateFailed(f"Error updating data: {ex}")

    def _fetch_hassbox_data(self):
        """Fetch data from HassBox integration."""
        try:
            import os
            config_path = self.hass.config.path(".storage", "state_grid.config")
            _LOGGER.debug("尝试读取HassBox配置文件: %s", config_path)
            
            # 检查文件是否存在
            if os.path.exists(config_path):
                _LOGGER.info("HassBox配置文件存在，开始读取")
                try:
                    with open(config_path, "r", encoding="utf-8") as file:
                        _LOGGER.debug("成功打开配置文件")
                        config_data = json.load(file)
                        _LOGGER.debug("成功解析JSON数据")
                        
                        if "data" in config_data:
                            _LOGGER.debug("配置包含data字段")
                            if "powerUserList" in config_data["data"]:
                                _LOGGER.debug("配置包含powerUserList字段")
                                index = self.config.get(CONF_CONSUMER_NUMBER_INDEX, 0)
                                power_user_list = config_data["data"]["powerUserList"]
                                _LOGGER.info("找到用户列表，共%d个用户", len(power_user_list))
                                
                                if 0 <= index < len(power_user_list):
                                    _LOGGER.info("成功获取索引为%d的用户数据", index)
                                    return self._process_hassbox_data(power_user_list[index])
                                else:
                                    _LOGGER.error("用户索引%d超出范围(0-%d)", index, len(power_user_list)-1)
                            else:
                                _LOGGER.error("配置中缺少powerUserList字段")
                        else:
                            _LOGGER.error("配置中缺少data字段")
                except json.JSONDecodeError as json_err:
                    _LOGGER.error("JSON解析错误: %s", json_err)
                except Exception as read_err:
                    _LOGGER.error("读取文件错误: %s", read_err)
            else:
                _LOGGER.error("HassBox配置文件不存在: %s", config_path)
                # 尝试列出目录内容
                try:
                    storage_dir = self.hass.config.path(".storage")
                    if os.path.exists(storage_dir):
                        files = os.listdir(storage_dir)
                        _LOGGER.info("存储目录内容: %s", files)
                    else:
                        _LOGGER.error("存储目录不存在: %s", storage_dir)
                except Exception as dir_err:
                    _LOGGER.error("无法列出目录内容: %s", dir_err)
            
            return {}
        except Exception as ex:
            _LOGGER.error("获取HassBox数据时发生错误: %s", ex)
            return {}

    def _process_hassbox_data(self, power_user_data):
        """Process HassBox integration data."""
        try:
            # 提取文件json日用电数据（大概是最近40天左右）
            daily_bill_list = power_user_data.get("daily_bill_list", [])
            # 重写结构
            daylist1 = []
            for item in daily_bill_list:
                day = item.get("day", "")
                if day:
                    day = f"{day[0:4]}-{day[4:6]}-{day[6:]}"
                    daylist1.append({
                        "day": day,
                        "dayEleNum": float(item.get("dayElePq", 0)),
                        "dayTPq": float(item.get("thisTPq", 0)),
                        "dayPPq": float(item.get("thisPPq", 0)),
                        "dayNPq": float(item.get("thisNPq", 0)),
                        "dayVPq": float(item.get("thisVPq", 0)),
                    })
            
            # 提取所有的日用电，在每个月用电下面，需要for循环提取出来
            daylist2 = []
            month_bill_list = power_user_data.get("month_bill_list", [])
            for month_data in month_bill_list:
                if "daily_ele" in month_data:
                    daylist2.append(month_data["daily_ele"])
            
            daylist3 = [item for sublist in daylist2 for item in sublist]  # 将数据展平
            
            # 重写结构
            daylist4 = []
            for item in daylist3:
                day = item.get("day", "")
                if day:
                    day = f"{day[0:4]}-{day[4:6]}-{day[6:]}"
                    daylist4.append({
                        "day": day,
                        "dayEleNum": float(item.get("dayElePq", 0)),
                        "dayTPq": float(item.get("thisTPq", 0)),
                        "dayPPq": float(item.get("thisPPq", 0)),
                        "dayNPq": float(item.get("thisNPq", 0)),
                        "dayVPq": float(item.get("thisVPq", 0)),
                    })
            
            # 合并daylist4和daylist1
            daylist1.extend(daylist4)
            
            # 筛选重复，只保留数值大的数
            daylist5 = {}
            for item in daylist1:
                day = item["day"]
                day_ele_num = item["dayEleNum"]
                if day not in daylist5 or day_ele_num > daylist5[day]["dayEleNum"]:
                    daylist5[day] = item
            
            # 按日期重新排序
            daylist6 = sorted(daylist5.values(), key=lambda x: x["day"])
            
            # 取最新的370个数据（总数大概370-390波动）
            daylist7 = list(reversed(daylist6))[:370]
            
            # 计算每日电费
            dayList = self._calculate_daily_cost(daylist7)
            
            # 重写月用电结构
            monthList = []
            for item in month_bill_list:
                month = item.get("month", "")
                if month:
                    month = f"{month[0:4]}-{month[4:]}"
                    monthList.append({
                        "month": month,
                        "monthEleNum": float(item.get("monthEleNum", 0)),
                        "monthEleCost": float(item.get("monthEleCost", 0)),
                        "monthTPq": float(item.get("month_t_ele_num", 0)),
                        "monthPPq": float(item.get("month_p_ele_num", 0)),
                        "monthNPq": float(item.get("month_n_ele_num", 0)),
                        "monthVPq": float(item.get("month_v_ele_num", 0)),
                    })
            
            # 处理月数据
            monthList = self._process_month_data(dayList, monthList)
            
            # 处理年数据
            yearList = self._process_year_data(monthList)
            
            return {
                "date": power_user_data.get("refresh_time", ""),
                "balance": float(power_user_data.get("balance", 0)),
                "dayList": dayList,
                "monthList": monthList,
                "yearList": yearList,
            }
        except Exception as ex:
            _LOGGER.error("Error processing HassBox data: %s", ex)
            return {}

    def _process_qinglong_data(self, payload):
        """Process Qinglong script data."""
        try:
            dayList_ori = payload.get("dayList", [])
            
            # 重写日结构
            dayList7 = []
            for item in dayList_ori:
                dayList7.append({
                    "day": item.get("day", ""),
                    "dayEleNum": float(item.get("dayElePq", 0)),
                    "dayTPq": float(item.get("thisTPq", 0)),
                    "dayPPq": float(item.get("thisPPq", 0)),
                    "dayNPq": float(item.get("thisNPq", 0)),
                    "dayVPq": float(item.get("thisVPq", 0)),
                })
            
            # 计算每日电费
            dayList = self._calculate_daily_cost(dayList7)
            
            # 处理月数据
            monthList_ori = payload.get("monthList", [])
            monthList = self._process_month_data(dayList, monthList_ori)
            
            # 处理年数据
            yearList = self._process_year_data(monthList)
            
            return {
                "date": payload.get("date", ""),
                "balance": float(payload.get("sumMoney", 0)),
                "dayList": dayList,
                "monthList": monthList,
                "yearList": yearList,
            }
        except Exception as ex:
            _LOGGER.error("Error processing Qinglong data: %s", ex)
            return {}

    def _calculate_daily_cost(self, day_list):
        """Calculate daily electricity cost based on billing standard."""
        try:
            billing_type = self.config.get(CONF_BILLING_TYPE)
            billing_standard = self.config.get(CONF_BILLING_STANDARD)
            
            result = []
            for item in day_list:
                day_cost = 0
                
                # 根据计费类型和标准计算每日电费
                if billing_type == BILLING_TYPE_SINGLE:
                    day_cost = self._calculate_cost_by_standard(item, billing_standard)
                elif billing_type == BILLING_TYPE_SEGMENTED:
                    # 分段计费
                    segment_date = self.config.get(CONF_SEGMENT_DATE)
                    day_date = item["day"].replace("-", "")[:6]  # 取年月部分
                    
                    if day_date < segment_date:
                        # 分段前
                        before_standard = self.config.get(CONF_SEGMENT_BEFORE_STANDARD)
                        day_cost = self._calculate_cost_by_standard(item, before_standard, prefix="before_")
                    else:
                        # 分段后
                        after_standard = self.config.get(CONF_SEGMENT_AFTER_STANDARD)
                        day_cost = self._calculate_cost_by_standard(item, after_standard, prefix="after_")
                
                # 添加电费到结果中，调整字段顺序
                result.append({
                    "day": item["day"],
                    "dayEleNum": item["dayEleNum"],
                    "dayEleCost": round(day_cost, 2),
                    "dayTPq": item["dayTPq"],
                    "dayPPq": item["dayPPq"],
                    "dayNPq": item["dayNPq"],
                    "dayVPq": item["dayVPq"]
                })
            
            return result
        except Exception as ex:
            _LOGGER.error("Error calculating daily cost: %s", ex)
            return day_list

    def _calculate_cost_by_standard(self, day_data, standard, prefix=""):
        """Calculate cost based on specific billing standard."""
        try:
            day_ele_num = day_data["dayEleNum"]
            day_tpq = day_data["dayTPq"]
            day_ppq = day_data["dayPPq"] 
            day_npq = day_data["dayNPq"]
            day_vpq = day_data["dayVPq"]
            
            if standard == BILLING_STANDARD_YEAR_阶梯:
                # 年阶梯计费
                ladder_level_1 = self.config.get(f"{prefix}{CONF_LADDER_LEVEL_1}", 2160)
                ladder_level_2 = self.config.get(f"{prefix}{CONF_LADDER_LEVEL_2}", 4200)
                price_1 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_1}", 0.5283)
                price_2 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_2}", 0.5783)
                price_3 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_3}", 0.8283)
                
                # 获取当前年份
                current_year = day_data["day"].split("-")[0]
                
                # 计算当年累计用电量（包括当天）
                year_accumulated = 0
                if self.data is not None:
                    for data in self.data.get("dayList", []):
                        if data["day"].startswith(current_year):
                            year_accumulated += data["dayEleNum"]
                
                # 根据累计用电量计算阶梯电价
                if year_accumulated <= ladder_level_1:
                    # 第一阶梯
                    return day_ele_num * price_1
                elif year_accumulated <= ladder_level_2:
                    # 第二阶梯
                    # 检查是否跨阶梯
                    if year_accumulated - day_ele_num <= ladder_level_1:
                        # 跨阶梯，部分第一阶梯，部分第二阶梯
                        first_part = ladder_level_1 - (year_accumulated - day_ele_num)
                        second_part = day_ele_num - first_part
                        return first_part * price_1 + second_part * price_2
                    else:
                        # 完全在第二阶梯
                        return day_ele_num * price_2
                else:
                    # 第三阶梯
                    # 检查是否跨阶梯
                    if year_accumulated - day_ele_num <= ladder_level_1:
                        # 跨越第一、第二、第三阶梯
                        first_part = ladder_level_1 - (year_accumulated - day_ele_num)
                        remaining = day_ele_num - first_part
                        if year_accumulated - day_ele_num + first_part + remaining <= ladder_level_2:
                            # 部分在第二阶梯
                            second_part = ladder_level_2 - (year_accumulated - day_ele_num + first_part)
                            third_part = remaining - second_part
                            return first_part * price_1 + second_part * price_2 + third_part * price_3
                        else:
                            # 完全在第三阶梯
                            return day_ele_num * price_3
                    elif year_accumulated - day_ele_num <= ladder_level_2:
                        # 跨越第二、第三阶梯
                        second_part = ladder_level_2 - (year_accumulated - day_ele_num)
                        third_part = day_ele_num - second_part
                        return second_part * price_2 + third_part * price_3
                    else:
                        # 完全在第三阶梯
                        return day_ele_num * price_3
                
            elif standard == BILLING_STANDARD_YEAR_阶梯_峰平谷:
                # 年阶梯+峰平谷计费
                ladder_level_1 = self.config.get(f"{prefix}{CONF_LADDER_LEVEL_1}", 2760)
                ladder_level_2 = self.config.get(f"{prefix}{CONF_LADDER_LEVEL_2}", 4800)
                
                # 各阶梯的峰平谷电价
                price_tip_1 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_1}_{CONF_PRICE_TIP}", 0.5283)
                price_peak_1 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_1}_{CONF_PRICE_PEAK}", 0.5283)
                price_flat_1 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_1}_{CONF_PRICE_FLAT}", 0.5283)
                price_valley_1 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_1}_{CONF_PRICE_VALLEY}", 0.5283)
                
                price_tip_2 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_2}_{CONF_PRICE_TIP}", 0.5783)
                price_peak_2 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_2}_{CONF_PRICE_PEAK}", 0.5783)
                price_flat_2 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_2}_{CONF_PRICE_FLAT}", 0.5783)
                price_valley_2 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_2}_{CONF_PRICE_VALLEY}", 0.5783)
                
                price_tip_3 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_3}_{CONF_PRICE_TIP}", 0.8283)
                price_peak_3 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_3}_{CONF_PRICE_PEAK}", 0.8283)
                price_flat_3 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_3}_{CONF_PRICE_FLAT}", 0.8283)
                price_valley_3 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_3}_{CONF_PRICE_VALLEY}", 0.8283)
                
                # 获取当前年份
                current_year = day_data["day"].split("-")[0]
                
                # 计算当年累计用电量（包括当天）
                year_accumulated = 0
                if self.data is not None:
                    for data in self.data.get("dayList", []):
                        if data["day"].startswith(current_year):
                            year_accumulated += data["dayEleNum"]
                
                # 根据累计用电量确定当前阶梯
                if year_accumulated <= ladder_level_1:
                    # 第一阶梯
                    return (day_tpq * price_tip_1 + 
                            day_ppq * price_peak_1 + 
                            day_npq * price_flat_1 + 
                            day_vpq * price_valley_1)
                elif year_accumulated <= ladder_level_2:
                    # 第二阶梯
                    # 检查是否跨阶梯
                    if year_accumulated - day_ele_num <= ladder_level_1:
                        # 跨阶梯，需要按比例计算
                        ratio_1 = (ladder_level_1 - (year_accumulated - day_ele_num)) / day_ele_num
                        ratio_2 = 1 - ratio_1
                        
                        # 第一阶梯部分
                        cost_1 = (day_tpq * price_tip_1 * ratio_1 + 
                                  day_ppq * price_peak_1 * ratio_1 + 
                                  day_npq * price_flat_1 * ratio_1 + 
                                  day_vpq * price_valley_1 * ratio_1)
                        
                        # 第二阶梯部分
                        cost_2 = (day_tpq * price_tip_2 * ratio_2 + 
                                  day_ppq * price_peak_2 * ratio_2 + 
                                  day_npq * price_flat_2 * ratio_2 + 
                                  day_vpq * price_valley_2 * ratio_2)
                        
                        return cost_1 + cost_2
                    else:
                        # 完全在第二阶梯
                        return (day_tpq * price_tip_2 + 
                                day_ppq * price_peak_2 + 
                                day_npq * price_flat_2 + 
                                day_vpq * price_valley_2)
                else:
                    # 第三阶梯或跨阶梯
                    if year_accumulated - day_ele_num <= ladder_level_1:
                        # 跨越三个阶梯，需要按比例计算
                        remaining = year_accumulated - day_ele_num
                        ratio_1 = (ladder_level_1 - remaining) / day_ele_num
                        ratio_2 = (ladder_level_2 - ladder_level_1) / day_ele_num if (ladder_level_2 - remaining) > 0 else 0
                        ratio_3 = 1 - ratio_1 - ratio_2
                        
                        # 各阶梯部分费用
                        cost_1 = (day_tpq * price_tip_1 * ratio_1 + 
                                  day_ppq * price_peak_1 * ratio_1 + 
                                  day_npq * price_flat_1 * ratio_1 + 
                                  day_vpq * price_valley_1 * ratio_1)
                        
                        cost_2 = (day_tpq * price_tip_2 * ratio_2 + 
                                  day_ppq * price_peak_2 * ratio_2 + 
                                  day_npq * price_flat_2 * ratio_2 + 
                                  day_vpq * price_valley_2 * ratio_2)
                        
                        cost_3 = (day_tpq * price_tip_3 * ratio_3 + 
                                  day_ppq * price_peak_3 * ratio_3 + 
                                  day_npq * price_flat_3 * ratio_3 + 
                                  day_vpq * price_valley_3 * ratio_3)
                        
                        return cost_1 + cost_2 + cost_3
                    elif year_accumulated - day_ele_num <= ladder_level_2:
                        # 跨越第二、第三阶梯
                        ratio_2 = (ladder_level_2 - (year_accumulated - day_ele_num)) / day_ele_num
                        ratio_3 = 1 - ratio_2
                        
                        # 第二阶梯部分
                        cost_2 = (day_tpq * price_tip_2 * ratio_2 + 
                                  day_ppq * price_peak_2 * ratio_2 + 
                                  day_npq * price_flat_2 * ratio_2 + 
                                  day_vpq * price_valley_2 * ratio_2)
                        
                        # 第三阶梯部分
                        cost_3 = (day_tpq * price_tip_3 * ratio_3 + 
                                  day_ppq * price_peak_3 * ratio_3 + 
                                  day_npq * price_flat_3 * ratio_3 + 
                                  day_vpq * price_valley_3 * ratio_3)
                        
                        return cost_2 + cost_3
                    else:
                        # 完全在第三阶梯
                        return (day_tpq * price_tip_3 + 
                                day_ppq * price_peak_3 + 
                                day_npq * price_flat_3 + 
                                day_vpq * price_valley_3)
                
            elif standard == BILLING_STANDARD_MONTH_阶梯:
                # 月阶梯计费
                ladder_level_1 = self.config.get(f"{prefix}{CONF_LADDER_LEVEL_1}", 230)
                ladder_level_2 = self.config.get(f"{prefix}{CONF_LADDER_LEVEL_2}", 400)
                price_1 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_1}", 0.5283)
                price_2 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_2}", 0.5783)
                price_3 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_3}", 0.8283)
                
                # 获取当前年月
                current_year_month = day_data["day"][:7]  # 格式：YYYY-MM
                
                # 计算当月累计用电量（包括当天）
                month_accumulated = 0
                if self.data is not None:
                    for data in self.data.get("dayList", []):
                        if data["day"].startswith(current_year_month):
                            month_accumulated += data["dayEleNum"]
                
                # 根据累计用电量计算阶梯电价
                if month_accumulated <= ladder_level_1:
                    # 第一阶梯
                    return day_ele_num * price_1
                elif month_accumulated <= ladder_level_2:
                    # 第二阶梯
                    # 检查是否跨阶梯
                    if month_accumulated - day_ele_num <= ladder_level_1:
                        # 跨阶梯，部分第一阶梯，部分第二阶梯
                        first_part = ladder_level_1 - (month_accumulated - day_ele_num)
                        second_part = day_ele_num - first_part
                        return first_part * price_1 + second_part * price_2
                    else:
                        # 完全在第二阶梯
                        return day_ele_num * price_2
                else:
                    # 第三阶梯
                    # 检查是否跨阶梯
                    if month_accumulated - day_ele_num <= ladder_level_1:
                        # 跨越第一、第二、第三阶梯
                        first_part = ladder_level_1 - (month_accumulated - day_ele_num)
                        remaining = day_ele_num - first_part
                        if month_accumulated - day_ele_num + first_part + remaining <= ladder_level_2:
                            # 部分在第二阶梯
                            second_part = ladder_level_2 - (month_accumulated - day_ele_num + first_part)
                            third_part = remaining - second_part
                            return first_part * price_1 + second_part * price_2 + third_part * price_3
                        else:
                            # 完全在第三阶梯
                            return day_ele_num * price_3
                    elif month_accumulated - day_ele_num <= ladder_level_2:
                        # 跨越第二、第三阶梯
                        second_part = ladder_level_2 - (month_accumulated - day_ele_num)
                        third_part = day_ele_num - second_part
                        return second_part * price_2 + third_part * price_3
                    else:
                        # 完全在第三阶梯
                        return day_ele_num * price_3
                
            elif standard == BILLING_STANDARD_MONTH_阶梯_峰平谷:
                # 月阶梯+峰平谷计费
                ladder_level_1 = self.config.get(f"{prefix}{CONF_LADDER_LEVEL_1}", 230)
                ladder_level_2 = self.config.get(f"{prefix}{CONF_LADDER_LEVEL_2}", 400)
                
                # 各阶梯的峰平谷电价
                price_tip_1 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_1}_{CONF_PRICE_TIP}", 0.5283)
                price_peak_1 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_1}_{CONF_PRICE_PEAK}", 0.5283)
                price_flat_1 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_1}_{CONF_PRICE_FLAT}", 0.5283)
                price_valley_1 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_1}_{CONF_PRICE_VALLEY}", 0.5283)
                
                price_tip_2 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_2}_{CONF_PRICE_TIP}", 0.5783)
                price_peak_2 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_2}_{CONF_PRICE_PEAK}", 0.5783)
                price_flat_2 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_2}_{CONF_PRICE_FLAT}", 0.5783)
                price_valley_2 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_2}_{CONF_PRICE_VALLEY}", 0.5783)
                
                price_tip_3 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_3}_{CONF_PRICE_TIP}", 0.8283)
                price_peak_3 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_3}_{CONF_PRICE_PEAK}", 0.8283)
                price_flat_3 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_3}_{CONF_PRICE_FLAT}", 0.8283)
                price_valley_3 = self.config.get(f"{prefix}{CONF_LADDER_PRICE_3}_{CONF_PRICE_VALLEY}", 0.8283)
                
                # 获取当前年月
                current_year_month = day_data["day"][:7]  # 格式：YYYY-MM
                
                # 计算当月累计用电量（包括当天）
                month_accumulated = 0
                if self.data is not None:
                    for data in self.data.get("dayList", []):
                        if data["day"].startswith(current_year_month):
                            month_accumulated += data["dayEleNum"]
                
                # 根据累计用电量确定当前阶梯
                if month_accumulated <= ladder_level_1:
                    # 第一阶梯
                    return (day_tpq * price_tip_1 + 
                            day_ppq * price_peak_1 + 
                            day_npq * price_flat_1 + 
                            day_vpq * price_valley_1)
                elif month_accumulated <= ladder_level_2:
                    # 第二阶梯
                    # 检查是否跨阶梯
                    if month_accumulated - day_ele_num <= ladder_level_1:
                        # 跨阶梯，需要按比例计算
                        ratio_1 = (ladder_level_1 - (month_accumulated - day_ele_num)) / day_ele_num
                        ratio_2 = 1 - ratio_1
                        
                        # 第一阶梯部分
                        cost_1 = (day_tpq * price_tip_1 * ratio_1 + 
                                  day_ppq * price_peak_1 * ratio_1 + 
                                  day_npq * price_flat_1 * ratio_1 + 
                                  day_vpq * price_valley_1 * ratio_1)
                        
                        # 第二阶梯部分
                        cost_2 = (day_tpq * price_tip_2 * ratio_2 + 
                                  day_ppq * price_peak_2 * ratio_2 + 
                                  day_npq * price_flat_2 * ratio_2 + 
                                  day_vpq * price_valley_2 * ratio_2)
                        
                        return cost_1 + cost_2
                    else:
                        # 完全在第二阶梯
                        return (day_tpq * price_tip_2 + 
                                day_ppq * price_peak_2 + 
                                day_npq * price_flat_2 + 
                                day_vpq * price_valley_2)
                else:
                    # 第三阶梯或跨阶梯
                    if month_accumulated - day_ele_num <= ladder_level_1:
                        # 跨越三个阶梯，需要按比例计算
                        remaining = month_accumulated - day_ele_num
                        ratio_1 = (ladder_level_1 - remaining) / day_ele_num
                        ratio_2 = (ladder_level_2 - ladder_level_1) / day_ele_num if (ladder_level_2 - remaining) > 0 else 0
                        ratio_3 = 1 - ratio_1 - ratio_2
                        
                        # 各阶梯部分费用
                        cost_1 = (day_tpq * price_tip_1 * ratio_1 + 
                                  day_ppq * price_peak_1 * ratio_1 + 
                                  day_npq * price_flat_1 * ratio_1 + 
                                  day_vpq * price_valley_1 * ratio_1)
                        
                        cost_2 = (day_tpq * price_tip_2 * ratio_2 + 
                                  day_ppq * price_peak_2 * ratio_2 + 
                                  day_npq * price_flat_2 * ratio_2 + 
                                  day_vpq * price_valley_2 * ratio_2)
                        
                        cost_3 = (day_tpq * price_tip_3 * ratio_3 + 
                                  day_ppq * price_peak_3 * ratio_3 + 
                                  day_npq * price_flat_3 * ratio_3 + 
                                  day_vpq * price_valley_3 * ratio_3)
                        
                        return cost_1 + cost_2 + cost_3
                    elif month_accumulated - day_ele_num <= ladder_level_2:
                        # 跨越第二、第三阶梯
                        ratio_2 = (ladder_level_2 - (month_accumulated - day_ele_num)) / day_ele_num
                        ratio_3 = 1 - ratio_2
                        
                        # 第二阶梯部分
                        cost_2 = (day_tpq * price_tip_2 * ratio_2 + 
                                  day_ppq * price_peak_2 * ratio_2 + 
                                  day_npq * price_flat_2 * ratio_2 + 
                                  day_vpq * price_valley_2 * ratio_2)
                        
                        # 第三阶梯部分
                        cost_3 = (day_tpq * price_tip_3 * ratio_3 + 
                                  day_ppq * price_peak_3 * ratio_3 + 
                                  day_npq * price_flat_3 * ratio_3 + 
                                  day_vpq * price_valley_3 * ratio_3)
                        
                        return cost_2 + cost_3
                    else:
                        # 完全在第三阶梯
                        return (day_tpq * price_tip_3 + 
                                day_ppq * price_peak_3 + 
                                day_npq * price_flat_3 + 
                                day_vpq * price_valley_3)
                
            elif standard == BILLING_STANDARD_MONTH_阶梯_峰平谷_变动价格:
                # 月阶梯+峰平谷+变动价格
                ladder_level_1 = self.config.get(f"{prefix}{CONF_LADDER_LEVEL_1}", 230)
                ladder_level_2 = self.config.get(f"{prefix}{CONF_LADDER_LEVEL_2}", 400)
                
                # 尖峰平电价（全年固定）
                price_tip = self.config.get(f"{prefix}{CONF_PRICE_TIP}", 0.6283)
                price_peak = self.config.get(f"{prefix}{CONF_PRICE_PEAK}", 0.5783)
                price_flat = self.config.get(f"{prefix}{CONF_PRICE_FLAT}", 0.5283)
                
                # 获取当前日期信息
                current_date = day_data["day"]
                current_year_month = current_date[:7]  # 格式：YYYY-MM
                month = int(current_date[5:7])  # 当前月份，1-12
                
                # 获取当月各阶梯的谷电价
                valley_price_1 = self.config.get(f"{prefix}month_{month:02d}_ladder_1_valley", 0.3)
                valley_price_2 = self.config.get(f"{prefix}month_{month:02d}_ladder_2_valley", 0.3)
                valley_price_3 = self.config.get(f"{prefix}month_{month:02d}_ladder_3_valley", 0.3)
                
                # 计算当月累计用电量（包括当天）
                month_accumulated = 0
                if self.data is not None:
                    for data in self.data.get("dayList", []):
                        if data["day"].startswith(current_year_month):
                            month_accumulated += data["dayEleNum"]
                
                # 根据累计用电量确定当前阶梯
                if month_accumulated <= ladder_level_1:
                    # 第一阶梯
                    return (day_tpq * price_tip + 
                            day_ppq * price_peak + 
                            day_npq * price_flat + 
                            day_vpq * valley_price_1)
                elif month_accumulated <= ladder_level_2:
                    # 第二阶梯
                    # 检查是否跨阶梯
                    if month_accumulated - day_ele_num <= ladder_level_1:
                        # 跨阶梯，需要按比例计算
                        ratio_1 = (ladder_level_1 - (month_accumulated - day_ele_num)) / day_ele_num
                        ratio_2 = 1 - ratio_1
                        
                        # 尖峰平电价部分（固定）
                        cost_tpf = (day_tpq * price_tip + 
                                   day_ppq * price_peak + 
                                   day_npq * price_flat)
                        
                        # 谷电价部分（按阶梯变化）
                        cost_valley = day_vpq * (valley_price_1 * ratio_1 + valley_price_2 * ratio_2)
                        
                        return cost_tpf + cost_valley
                    else:
                        # 完全在第二阶梯
                        return (day_tpq * price_tip + 
                                day_ppq * price_peak + 
                                day_npq * price_flat + 
                                day_vpq * valley_price_2)
                else:
                    # 第三阶梯或跨阶梯
                    if month_accumulated - day_ele_num <= ladder_level_1:
                        # 跨越三个阶梯，需要按比例计算
                        remaining = month_accumulated - day_ele_num
                        ratio_1 = (ladder_level_1 - remaining) / day_ele_num
                        ratio_2 = (ladder_level_2 - ladder_level_1) / day_ele_num if (ladder_level_2 - remaining) > 0 else 0
                        ratio_3 = 1 - ratio_1 - ratio_2
                        
                        # 尖峰平电价部分（固定）
                        cost_tpf = (day_tpq * price_tip + 
                                   day_ppq * price_peak + 
                                   day_npq * price_flat)
                        
                        # 谷电价部分（按阶梯变化）
                        cost_valley = day_vpq * (valley_price_1 * ratio_1 + 
                                               valley_price_2 * ratio_2 + 
                                               valley_price_3 * ratio_3)
                        
                        return cost_tpf + cost_valley
                    elif month_accumulated - day_ele_num <= ladder_level_2:
                        # 跨越第二、第三阶梯
                        ratio_2 = (ladder_level_2 - (month_accumulated - day_ele_num)) / day_ele_num
                        ratio_3 = 1 - ratio_2
                        
                        # 尖峰平电价部分（固定）
                        cost_tpf = (day_tpq * price_tip + 
                                   day_ppq * price_peak + 
                                   day_npq * price_flat)
                        
                        # 谷电价部分（按阶梯变化）
                        cost_valley = day_vpq * (valley_price_2 * ratio_2 + valley_price_3 * ratio_3)
                        
                        return cost_tpf + cost_valley
                    else:
                        # 完全在第三阶梯
                        return (day_tpq * price_tip + 
                                day_ppq * price_peak + 
                                day_npq * price_flat + 
                                day_vpq * valley_price_3)
                
            elif standard == BILLING_STANDARD_OTHER_平均单价:
                # 其他-平均单价
                avg_price = self.config.get(f"{prefix}{CONF_AVERAGE_PRICE}", 0.5583)
                return day_ele_num * avg_price
                
            return 0
        except Exception as ex:
            _LOGGER.error("Error calculating cost by standard: %s", ex)
            return 0

    def _process_month_data(self, day_list, month_list):
        """Process and update monthly data."""
        try:
            # 确保月列表按时间降序排序（最新的月份在前）
            month_list = sorted(month_list, key=lambda x: x["month"], reverse=True)
            
            # 增加当月数据（如果不存在）
            now = datetime.now()
            current_month_str = now.strftime("%Y-%m")
            if not any(item["month"] == current_month_str for item in month_list):
                # 计算当月数据
                current_month_data = self._calculate_month_data(day_list, current_month_str)
                if current_month_data:
                    month_list.insert(0, current_month_data)
            
            # 增加上月数据（如果不存在）
            prev_month = datetime(now.year, now.month - 1 if now.month > 1 else 12, 1)
            prev_month_str = prev_month.strftime("%Y-%m")
            
            if not any(item["month"] == prev_month_str for item in month_list):
                # 计算上月数据
                prev_month_data = self._calculate_month_data(day_list, prev_month_str)
                if prev_month_data:
                    # 由于已经是降序排列，上月应该插入到当月之后
                    if month_list and month_list[0]["month"] == current_month_str:
                        month_list.insert(1, prev_month_data)
                    else:
                        month_list.insert(0, prev_month_data)
            
            # 处理每个月的数据，只保留需要的字段并转换为数字格式
            processed_month_list = []
            for month_item in month_list:
                month_str = month_item["month"]
                year_month = month_str.replace('-', '')
                
                # 从日数据中计算月度分时电量
                days_in_month = [day for day in day_list if day["day"].replace('-', '')[:6] == year_month]
                month_tpq = sum(float(day.get("dayTPq", 0)) for day in days_in_month)
                month_ppq = sum(float(day.get("dayPPq", 0)) for day in days_in_month)
                month_npq = sum(float(day.get("dayNPq", 0)) for day in days_in_month)
                month_vpq = sum(float(day.get("dayVPq", 0)) for day in days_in_month)
                
                # 创建新的月数据对象，只包含需要的字段
                new_month_item = {
                    "month": month_str,
                    "monthEleNum": float(month_item.get("monthEleNum", 0)),
                    "monthEleCost": float(month_item.get("monthEleCost", 0)),
                    "monthTPq": round(month_tpq, 2),
                    "monthPPq": round(month_ppq, 2),
                    "monthNPq": round(month_npq, 2),
                    "monthVPq": round(month_vpq, 2)
                }
                processed_month_list.append(new_month_item)
            
            return processed_month_list
        except Exception as ex:
            _LOGGER.error("Error processing month data: %s", ex)
            return month_list

    def _calculate_month_data(self, day_list, month_str):
        """Calculate month data from daily data."""
        try:
            year_month = month_str.replace('-', '')
            days_in_month = [day for day in day_list if day["day"].replace('-', '')[:6] == year_month]
            
            if not days_in_month:
                return None
            
            month_ele_num = sum(float(day.get("dayEleNum", 0)) for day in days_in_month)
            month_tpq = sum(float(day.get("dayTPq", 0)) for day in days_in_month)
            month_ppq = sum(float(day.get("dayPPq", 0)) for day in days_in_month)
            month_npq = sum(float(day.get("dayNPq", 0)) for day in days_in_month)
            month_vpq = sum(float(day.get("dayVPq", 0)) for day in days_in_month)
            month_ele_cost = sum(float(day.get("dayEleCost", 0)) for day in days_in_month)
            
            return {
                "month": month_str,
                "monthEleNum": float(round(month_ele_num, 2)),
                "monthEleCost": float(round(month_ele_cost, 2)),
                "monthTPq": round(month_tpq, 2),
                "monthPPq": round(month_ppq, 2),
                "monthNPq": round(month_npq, 2),
                "monthVPq": round(month_vpq, 2)
            }
        except Exception as ex:
            _LOGGER.error("Error calculating month data: %s", ex)
            return None

    def _process_year_data(self, month_list):
        """Process and calculate yearly data from monthly data."""
        try:
            year_map = {}  # 用于按年份暂存数据
            
            for month_data in month_list:
                year = month_data["month"].split('-')[0]
                if year not in year_map:
                    year_map[year] = {
                        "year": year,
                        "yearEleNum": 0,
                        "yearEleCost": 0,
                        "yearTPq": 0,
                        "yearPPq": 0,
                        "yearNPq": 0,
                        "yearVPq": 0
                    }
                
                # 由于月数据已经是数字格式，不需要再转换
                year_map[year]["yearEleNum"] += month_data.get("monthEleNum", 0)
                year_map[year]["yearEleCost"] += month_data.get("monthEleCost", 0)
                year_map[year]["yearTPq"] += month_data.get("monthTPq", 0)
                year_map[year]["yearPPq"] += month_data.get("monthPPq", 0)
                year_map[year]["yearNPq"] += month_data.get("monthNPq", 0)
                year_map[year]["yearVPq"] += month_data.get("monthVPq", 0)
            
            # 四舍五入到两位小数
            year_list = []
            for year_data in year_map.values():
                year_list.append({
                    "year": year_data["year"],
                    "yearEleNum": round(year_data["yearEleNum"], 2),
                    "yearEleCost": round(year_data["yearEleCost"], 2),
                    "yearTPq": round(year_data["yearTPq"], 2),
                    "yearPPq": round(year_data["yearPPq"], 2),
                    "yearNPq": round(year_data["yearNPq"], 2),
                    "yearVPq": round(year_data["yearVPq"], 2)
                })
            
            # 按年份倒序排列
            return sorted(year_list, key=lambda x: x["year"], reverse=True)
        except Exception as ex:
            _LOGGER.error("Error processing year data: %s", ex)
            return []


class StateGridInfoSensor(SensorEntity):
    """Representation of a State Grid Info sensor."""

    def __init__(self, coordinator, config):
        """Initialize the sensor."""
        self.coordinator = coordinator
        self.config = config
        consumer_number = config.get(CONF_CONSUMER_NUMBER, "")
        self.entity_id = f"sensor.state_grid_{consumer_number}"
        self._attr_unique_id = f"state_grid_{consumer_number}"
        self._attr_icon = "mdi:flash"        
        self._attr_name = f"国家电网 {consumer_number}"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, f"state_grid_{consumer_number}")},
            "name": f"国家电网 {consumer_number}",
            "manufacturer": "国家电网",
        }
        
    @property
    def native_value(self):
        """Return the state of the sensor."""
        if self.coordinator.data:
            return self.coordinator.data.get("balance", 0)
        return 0
        
    @property
    def extra_state_attributes(self):
        """Return the state attributes."""
        if self.coordinator.data:
            return {
                "date": self.coordinator.data.get("date", ""),
                "daylist": self.coordinator.data.get("dayList", []),
                "monthlist": self.coordinator.data.get("monthList", []),
                "yearlist": self.coordinator.data.get("yearList", []),
            }
        return {}