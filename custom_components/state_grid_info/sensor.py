"""农历集成的传感器平台"""
import logging
import time
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from .lunar_python import *
from .lunar_python.util import *
from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_state_change_event, async_call_later
from homeassistant.helpers.typing import StateType
from homeassistant.util import dt as dt_util

from .const import DOMAIN, CONF_BIRTHDAYS, CONF_NAME, CONF_SOLAR_BIRTHDAY, CONF_LUNAR_BIRTHDAY
from .lunar_optimizer import lunar_cache_manager

_LOGGER = logging.getLogger(__name__)

SCAN_INTERVAL = timedelta(hours=1)

async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """设置农历传感器平台。"""
    name = entry.data["name"]
    birthdays = entry.data.get(CONF_BIRTHDAYS, [])
    async_add_entities([LunarSensor(name, entry.entry_id, birthdays, entry)], True)
 

class LunarSensor(SensorEntity):
    """农历传感器的表示。"""

    def __init__(self, name: str, entry_id: str, birthdays: list, config_entry: ConfigEntry) -> None:
        """初始化农历传感器。"""
        self.entity_id = "sensor.lunar_calendar"
        self._attr_name = "万年历"
        self._attr_unique_id = f"{entry_id}_lunar_calendar"
        self._state: Optional[StateType] = None
        self._attributes: Dict[str, Any] = {}
        self._birthdays = birthdays
        self._config_entry = config_entry
        self._unsubscribe_listener = None
        # 缓存变量
        self._cached_festivals = None
        self._cached_birthdays = None
        self._cache_date = None  # 缓存的日期
        self._last_cache_date = None  # 上次缓存的日期
        # 日历数组缓存
        self._cached_calendar_data = None  # 缓存的日历数据
        self._cached_calendar_month = None  # 缓存的月份标识
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry_id)},
            "name": name,
            "manufacturer": "Lunar Calendar"
        }

    async def async_added_to_hass(self) -> None:
        """当实体被添加到 Home Assistant 时调用。"""
        await super().async_added_to_hass()
        
        # 设置对 date.lunar_tap_date 实体状态变化的监听
        @callback
        def _async_state_change_listener(event):
            """当被监听的实体状态改变时处理。"""
            _LOGGER.debug(f"[SENSOR] 检测到日期变化事件，触发更新: {event.event_type}")
            # 确保在事件循环中调度更新
            self.hass.async_create_task(self._async_update_callback())
            
        self._unsubscribe_listener = async_track_state_change_event(
            self.hass, ["date.lunar_tap_date"], _async_state_change_listener
        )
        
        # 监听0点更新事件
        @callback
        def _async_midnight_listener(event):
            """处理0点更新事件，清除缓存。"""
            _LOGGER.debug(f"[SENSOR] 检测到0点更新事件，清除缓存: {event.data}")
            # 清除所有缓存，强制重新计算
            self._cached_festivals = None
            self._cached_birthdays = None
            self._cache_date = None
            self._last_cache_date = None
            self._cached_calendar_data = None
            self._cached_calendar_month = None
            # 清除农历计算缓存
            lunar_cache_manager.clear_cache()
            # 延迟1秒后更新，确保日期已更新
            # 使用正确的异步回调方式
            async def _delayed_update(_):
                await self.async_schedule_update_ha_state(True)
            async_call_later(self.hass, 1, _delayed_update)
            
        self.hass.bus.async_listen("lunar_calendar_midnight_update", _async_midnight_listener)

    @property
    def native_value(self) -> Optional[StateType]:
        """返回传感器的状态。"""
        return self._state

    @property
    def extra_state_attributes(self) -> Dict[str, Any]:
        """返回状态属性。"""
        return self._attributes
        
    async def async_will_remove_from_hass(self) -> None:
        """当实体将被从 Home Assistant 移除时调用。"""
        if self._unsubscribe_listener is not None:
            self._unsubscribe_listener()
            self._unsubscribe_listener = None

    async def _async_update_callback(self):
        """异步更新回调函数，确保线程安全。"""
        await self.async_schedule_update_ha_state(True)

    def update(self) -> None:
        """获取传感器的新状态数据。"""
        start_time = time.time()
        _LOGGER.debug(f"[SENSOR] 开始更新传感器数据，开始时间: {start_time}")
        
        # 获取点击日期-datetime
        tap_start = time.time()
        tap_date_entity = self.hass.states.get("date.lunar_tap_date")
        tap_datetime = datetime.now()
        if tap_date_entity and tap_date_entity.state:
            try:
                parsed_date = dt_util.parse_date(tap_date_entity.state)
                if parsed_date:
                    tap_datetime = datetime.combine(parsed_date, datetime.min.time())
                    _LOGGER.debug(f"[SENSOR] 获取到点击日期: {tap_datetime}")
            except Exception:
                _LOGGER.debug(f"无法解析点击日期: {tap_date_entity.state}，使用当前日期")
        tap_time = (time.time() - tap_start) * 1000
        _LOGGER.debug(f"[SENSOR] 获取点击日期完成，耗时: {tap_time:.2f}毫秒")

        # 获取当前日期-阳历信息
        solar_start = time.time()
        now_solar_datetime = Solar.fromDate(datetime.now())
        now_solar_year = str(now_solar_datetime.getYear())
        now_solar_month = str(now_solar_datetime.getMonth()).zfill(2)
        now_solar_day = str(now_solar_datetime.getDay()).zfill(2)
        now_solar_weekday = now_solar_datetime.getWeekInChinese()
        now_solar_date = f"{now_solar_year}-{now_solar_month}-{now_solar_day}"
        now_solar = {
            "年": now_solar_year,
            "月": now_solar_month,
            "日": now_solar_day,
            "星座": f"{now_solar_datetime.getXingZuo()}座",
            "星期1": f"星期{now_solar_weekday}",
            "星期2": f"周{now_solar_weekday}",
            "日期1": f"{now_solar_month}月{now_solar_day}日",
            "日期2": now_solar_date,
            "日期3": f"{now_solar_year}年{now_solar_month}月{now_solar_day}日",
        }

        # 获取点击日期-阳历信息
        tap_solar_datetime = Solar.fromDate(tap_datetime)
        tap_solar_year = str(tap_solar_datetime.getYear())
        tap_solar_month = str(tap_solar_datetime.getMonth()).zfill(2)
        tap_solar_day = str(tap_solar_datetime.getDay()).zfill(2)
        tap_solar_weekday = tap_solar_datetime.getWeekInChinese()
        tap_solar = {
            "年": tap_solar_year,
            "月": tap_solar_month,
            "日": tap_solar_day,
            "星座": f"{tap_solar_datetime.getXingZuo()}座",
            "星期1": f"星期{tap_solar_weekday}",
            "星期2": f"周{tap_solar_weekday}",
            "日期1": f"{tap_solar_month}月{tap_solar_day}日",
            "日期2": f"{tap_solar_year}-{tap_solar_month}-{tap_solar_day}",
            "日期3": f"{tap_solar_year}年{tap_solar_month}月{tap_solar_day}日",
        }
        solar_time = (time.time() - solar_start) * 1000
        _LOGGER.debug(f"[SENSOR] 阳历信息获取完成，耗时: {solar_time:.2f}毫秒")

        # 获取当前日期-农历历信息
        lunar_start = time.time()
        now_lunar_datetime = Lunar.fromDate(datetime.now())
        now_lunar_year = now_lunar_datetime.getYearInGanZhi() + now_lunar_datetime.getYearShengXiao() + "年"
        now_lunar_month = now_lunar_datetime.getMonthInChinese()
        now_lunar_day = now_lunar_datetime.getDayInChinese()
        now_lunar_shuju = ""
        if now_lunar_datetime.getShuJiu():
            now_lunar_shuju = now_lunar_datetime.getShuJiu().getName() + " 第" + str(now_lunar_datetime.getShuJiu().getIndex()) + "天"
        now_lunar_fu = ""
        if now_lunar_datetime.getFu():
            now_lunar_fu = now_lunar_datetime.getFu().getName() + " 第" + str(now_lunar_datetime.getFu().getIndex()) + "天"
        now_lunar = {
            "年": now_lunar_year,
            "日期": now_lunar_month + "月" + now_lunar_day,
            "数九": now_lunar_shuju,
            "三伏": now_lunar_fu,
        }

        # 获取点击日期-农历信息
        tap_lunar_datetime = Lunar.fromDate(tap_datetime)
        tap_lunar_year = tap_lunar_datetime.getYearInGanZhi() + tap_lunar_datetime.getYearShengXiao() + "年"
        tap_lunar_month = tap_lunar_datetime.getMonthInChinese()
        tap_lunar_day = tap_lunar_datetime.getDayInChinese()
        tap_lunar_shuju = ""
        if tap_lunar_datetime.getShuJiu():
            tap_lunar_shuju = tap_lunar_datetime.getShuJiu().getName() + " 第" + str(tap_lunar_datetime.getShuJiu().getIndex()) + "天"
        tap_lunar_fu = ""
        if tap_lunar_datetime.getFu():
            tap_lunar_fu = tap_lunar_datetime.getFu().getName() + " 第" + str(tap_lunar_datetime.getFu().getIndex()) + "天"
        tap_lunar = {
            "年": tap_lunar_year,
            "日期": tap_lunar_month + "月" + tap_lunar_day,
            "数九": tap_lunar_shuju,
            "三伏": tap_lunar_fu,
        }
        lunar_time = (time.time() - lunar_start) * 1000
        _LOGGER.debug(f"[SENSOR] 农历信息获取完成，耗时: {lunar_time:.2f}毫秒")

        # 计算点击日期的，日历数组（包括农历数组、农历文本数组、节日数日、节气数组、假期数组）
        calendar_start = time.time()
        _LOGGER.debug(f"[SENSOR] 开始生成日历数组: {tap_solar_year}-{tap_solar_month}")
        
        # 检查日历缓存
        current_month_key = f"{tap_solar_year}-{tap_solar_month}"
        if (self._cached_calendar_data is not None and 
            self._cached_calendar_month == current_month_key):
            _LOGGER.debug(f"[SENSOR] 使用日历缓存，跳过计算")
            lunarday_num = self._cached_calendar_data["lunarday_num"]
            lunar_label = self._cached_calendar_data["lunar_label"]
            jieqi_label = self._cached_calendar_data["jieqi_label"]
            jiaqi_label = self._cached_calendar_data["jiaqi_label"]
            jieri_label_lunar = self._cached_calendar_data["jieri_label_lunar"]
            jieri_label_solar = self._cached_calendar_data["jieri_label_solar"]
        else:
            _LOGGER.debug(f"[SENSOR] 缓存失效，重新计算日历数组")
            
            tap_year = tap_solar_year
            tap_month = tap_solar_month
            isrunnian = SolarUtil.isLeapYear(int(tap_year))  # 是否闰年 
            tap_month_sum_last = 1                           # 上月天数
            tap_month_sum = 1                                # 本月天数
            
            # 优化月份天数计算 - 使用字典替代多重if
            month_days = {
                "01": (31, 31), "02": (31, 29 if isrunnian else 28), "03": (29 if isrunnian else 28, 31),
                "04": (31, 30), "05": (30, 31), "06": (31, 30),
                "07": (30, 31), "08": (31, 31), "09": (31, 30),
                "10": (30, 31), "11": (31, 30), "12": (30, 31)
            }
            
            if tap_month in month_days:
                tap_month_sum_last, tap_month_sum = month_days[tap_month]
                
            tap_month_01 = f"{tap_year}-{tap_month}-01T00:00:00"                      # 点击年-点击月-1号的id
            tap_month_01_time = Lunar.fromDate(datetime.fromisoformat(tap_month_01))  # 点击年-点击月-1号的日期
            tapweek1id = tap_month_01_time.getWeek()  # 点击年-点击月-1号是周几
            if tapweek1id == 0:
                tapweek1id = 7  # 点击年-点击月-1号是周几
            tapweek1id = tapweek1id - 1

            tap_new_dateTime = ""  # 初始化变量
            day_label = ""
            month_label = ""
            day = 0
            month = 0
            year = 0
            lunarday_num = [None] * 42       # 农历数组
            lunar_label = [None] * 42        # 农历文本
            jieqi_label = [None] * 42        # 节气文本
            jiaqi_label = [None] * 42        # 假期文本
            jieri_label_lunar = [None] * 42  # 农历节日文本
            jieri_label_solar = [None] * 42  # 阳历节日文本

            # 优化：使用全局缓存管理器
            loop_start = time.time()
            
            for id in range(42):
                # 计算日期逻辑（保持原有逻辑）
                if id - tapweek1id >= 0 and id - tapweek1id < tap_month_sum:
                    year = tap_year
                    month = tap_month
                    day = id - tapweek1id + 1
                    day_label = f"{day:02d}"
                    month_label = f"{int(month):02d}"
                
                if id - tapweek1id < 0 and int(tap_month) > 1:
                    year = tap_year
                    month = int(tap_month) - 1
                    day = id - tapweek1id + 1 + tap_month_sum_last
                    day_label = f"{day:02d}"
                    month_label = f"{month:02d}"
                
                if id - tapweek1id < 0 and tap_month == "01":
                    year = str(int(tap_year) - 1)
                    day = id - tapweek1id + 1 + tap_month_sum_last
                    day_label = f"{day:02d}"
                    month_label = "12"
                
                if id - tapweek1id >= tap_month_sum and int(tap_month) < 12:
                    year = tap_year
                    month = int(tap_month) + 1
                    day = id - tapweek1id - tap_month_sum + 1
                    day_label = f"{day:02d}"
                    month_label = f"{month:02d}"
                
                if id - tapweek1id >= tap_month_sum and tap_month == "12":
                    year = str(int(tap_year) + 1)
                    day = id - tapweek1id - tap_month_sum + 1
                    day_label = f"{day:02d}"
                    month_label = "01"
                
                tap_new_dateTime = f"{year}-{month_label}-{day_label}T00:00:00"
                
                # 优化：使用全局缓存管理器获取日期对象
                lunarid, solarid = lunar_cache_manager.get_date_objects(tap_new_dateTime)
                
                lunar_label[id] = f"{lunarid.getMonthInChinese()}月{lunarid.getDayInChinese()}"
                jieqi_label[id] = lunarid.getJieQi()
                
                festivals_lunar = lunarid.getFestivals()
                jieri_label_lunar[id] = festivals_lunar[0] if festivals_lunar else None
                
                festivals_solar = solarid.getFestivals()
                jieri_label_solar[id] = festivals_solar[0] if festivals_solar else None

                yy = lunarid.getYear()
                mm = str(abs(lunarid.getMonth())).zfill(2)
                dd = str(abs(lunarid.getDay())).zfill(2)
                # 优化：使用缓存管理器获取农历月天数
                lunarsum = lunar_cache_manager.get_month_days(int(yy), int(mm))
                lunarday_num[id] = f"{mm}{dd}{lunarsum}"
                
                d1 = f"{year}-{month_label}-{day_label}"
                d2 = HolidayUtil.getHoliday(d1)
                if d2 is not None:
                    jiaqi_label[id] = d2.isWork()

            loop_time = (time.time() - loop_start) * 1000
            _LOGGER.debug(f"[SENSOR] 日历数组循环生成完成，耗时: {loop_time:.2f}毫秒")
            
            # 更新缓存
            self._cached_calendar_data = {
                "lunarday_num": lunarday_num,
                "lunar_label": lunar_label,
                "jieqi_label": jieqi_label,
                "jiaqi_label": jiaqi_label,
                "jieri_label_lunar": jieri_label_lunar,
                "jieri_label_solar": jieri_label_solar
            }
            self._cached_calendar_month = current_month_key
            _LOGGER.debug(f"[SENSOR] 日历缓存已更新，月份: {current_month_key}")
            
        calendar_time = (time.time() - calendar_start) * 1000
        _LOGGER.debug(f"[SENSOR] 日历数组生成总耗时: {calendar_time:.2f}毫秒")

        # 获取点击日期-节气
        jieqi_start = time.time()
        dateLastjieqi = tap_lunar_datetime.getPrevJieQi().getSolar().toYmd()
        dateLastjieqi_obj = datetime.strptime(dateLastjieqi, "%Y-%m-%d")
        lunarLastjieqi = Lunar.fromDate(dateLastjieqi_obj)
        dateNextjieqi = tap_lunar_datetime.getNextJieQi().getSolar().toYmd()
        dateNextjieqi_obj = datetime.strptime(dateNextjieqi, "%Y-%m-%d")
        lunarNextjieqi = Lunar.fromDate(dateNextjieqi_obj)
        lastjieqi = f"{tap_lunar_datetime.getPrevJieQi()}: {tap_lunar_datetime.getPrevJieQi().getSolar().toYmd()} 周{lunarLastjieqi.getWeekInChinese()}"
        nextjieqi = f"{tap_lunar_datetime.getNextJieQi()}: {tap_lunar_datetime.getNextJieQi().getSolar().toYmd()} 周{lunarNextjieqi.getWeekInChinese()}"
        last_jieqi = now_lunar_datetime.getPrevJieQi()
        last_jieqi_date = last_jieqi.getSolar().toYmd()
        last = Solar.fromYmd(int(last_jieqi_date[0:4]), int(last_jieqi_date[5:7]), int(last_jieqi_date[8:10]))
        now = Solar.fromYmd(int(now_solar_year), int(now_solar_month), int(now_solar_day))
        num = now.subtract(last)
        jieqi = {
            "节气": f"{last_jieqi} 第{num}天",
            "上一节气": lastjieqi,
            "下一节气": nextjieqi,
        }
        jieqi_time = (time.time() - jieqi_start) * 1000
        _LOGGER.debug(f"[SENSOR] 节气信息获取完成，耗时: {jieqi_time:.2f}毫秒")

        # 获取点击日期-时辰干支吉凶
        shichen_start = time.time()
        time_points = ["00:30:00", "02:00:00", "04:00:00", "06:00:00", "08:00:00", "10:00:00", "12:00:00", 
                       "14:00:00", "16:00:00", "18:00:00", "20:00:00", "22:00:00", "23:30:00"]
        ganzi_array = []
        luck_array = []
        for time_point in time_points:
            shichen_datetime = datetime.fromisoformat(f"{tap_solar_datetime}T{time_point}")
            shichen_obj = Lunar.fromDate(shichen_datetime)
            ganzi_array.append(shichen_obj.getTimeInGanZhi())
            luck_array.append(shichen_obj.getTimeTianShenLuck())
        shichen_time = (time.time() - shichen_start) * 1000
        _LOGGER.debug(f"[SENSOR] 时辰干支计算完成，耗时: {shichen_time:.2f}毫秒")

        # 获取点击日期-老黄历信息
        huangli_start = time.time()
        huangli_info = {
            "宜": " ".join(tap_lunar_datetime.getDayYi()) if hasattr(tap_lunar_datetime.getDayYi(), "__iter__") else tap_lunar_datetime.getDayYi(),
            "忌": " ".join(tap_lunar_datetime.getDayJi()) if hasattr(tap_lunar_datetime.getDayJi(), "__iter__") else tap_lunar_datetime.getDayJi(),
            "吉神": " ".join(tap_lunar_datetime.getDayJiShen()) if hasattr(tap_lunar_datetime.getDayJiShen(), "__iter__") else tap_lunar_datetime.getDayJiShen(),
            "凶煞": " ".join(tap_lunar_datetime.getDayXiongSha()) if hasattr(tap_lunar_datetime.getDayXiongSha(), "__iter__") else tap_lunar_datetime.getDayXiongSha(),
            "彭祖干": tap_lunar_datetime.getPengZuGan(),
            "彭祖支": tap_lunar_datetime.getPengZuZhi(),
            "季节": tap_lunar_datetime.getSeason(),
            "月相": f"{tap_lunar_datetime.getYueXiang()}月",
            "物候": tap_lunar_datetime.getHou() + " " + tap_lunar_datetime.getWuHou(),
            "喜神": tap_lunar_datetime.getDayPositionXiDesc(),
            "福神": tap_lunar_datetime.getDayPositionFuDesc(),
            "财神": tap_lunar_datetime.getDayPositionCaiDesc(),
            "阳贵": tap_lunar_datetime.getDayPositionYangGuiDesc(),
            "阴贵": tap_lunar_datetime.getDayPositionYinGuiDesc(),
            "九星": str(tap_lunar_datetime.getDayNineStar()),
            "星宿": tap_lunar_datetime.getGong() + "方" + tap_lunar_datetime.getXiu() + tap_lunar_datetime.getZheng() + tap_lunar_datetime.getAnimal() + "(" + tap_lunar_datetime.getXiuLuck() + ")",
            "相冲": tap_lunar_datetime.getDayShengXiao() + '日冲' + tap_lunar_datetime.getDayChongDesc(),
            "值星": tap_lunar_datetime.getZhiXing(),
            "天神": tap_lunar_datetime.getDayTianShen() + "(" + tap_lunar_datetime.getDayTianShenType() + tap_lunar_datetime.getDayTianShenLuck() + "日)",
            "本月胎神": tap_lunar_datetime.getMonthPositionTai(),
            "今日胎神": tap_lunar_datetime.getDayPositionTai(),
            "岁煞": "岁煞" + tap_lunar_datetime.getDaySha(),
            "六耀": tap_lunar_datetime.getLiuYao(),
            "七曜": tap_lunar_datetime.getZheng(),
            "日禄": tap_lunar_datetime.getDayLu(),
            "时辰干支": ganzi_array,
            "时辰吉凶": luck_array,
            "干支": {
                "年": tap_lunar_datetime.getYearInGanZhi(),
                "月": tap_lunar_datetime.getMonthInGanZhi(),
                "日": tap_lunar_datetime.getDayInGanZhi()
            },
            "生肖": {
                "年": tap_lunar_datetime.getYearShengXiao(),
                "月": tap_lunar_datetime.getMonthShengXiao(),
                "日": tap_lunar_datetime.getDayShengXiao()
            },
            "纳音": {
                "年": tap_lunar_datetime.getYearNaYin(),
                "月": tap_lunar_datetime.getMonthNaYin(),
                "日": tap_lunar_datetime.getDayNaYin()
            },
            "旬空": {
                "年": tap_lunar_datetime.getYearXunKong(),
                "月": tap_lunar_datetime.getMonthXunKong(),
                "日": tap_lunar_datetime.getDayXunKong()
            },
        }
        huangli_time = (time.time() - huangli_start) * 1000
        _LOGGER.debug(f"[SENSOR] 老黄历信息获取完成，耗时: {huangli_time:.2f}毫秒")

        # 计算未来100天的阳历+农历节日（使用缓存）
        festival_start = time.time()
        current_date = f"{now_solar_year}-{now_solar_month}-{now_solar_day}"
        
        # 检查缓存是否有效（当天有效）
        if self._cached_festivals is None or self._cache_date != current_date:
            _LOGGER.debug(f"[SENSOR] 缓存失效，重新计算未来100天节日，缓存日期: {self._cache_date}, 当前日期: {current_date}")
            jieri_array = []
            now_date = Solar.fromYmd(int(now_solar_year), int(now_solar_month), int(now_solar_day))  # 当前日期
            _LOGGER.debug(f"[SENSOR] 开始计算未来100天节日")
            
            # 遍历未来100天
            for days_ahead in range(100):
                # 获取未来第n天的阳历日期
                future_solar = now_solar_datetime.next(days_ahead)
                
                # 获取阳历节日
                solar_festivals = future_solar.getFestivals()
                if solar_festivals:
                    for festival in solar_festivals:
                        if festival and festival != "None":
                            jieri_array.append(f"{festival} {days_ahead}天")
                
                # 获取对应的农历日期和节日
                future_lunar = now_lunar_datetime.next(days_ahead)
                lunar_festivals = future_lunar.getFestivals()
                if lunar_festivals:
                    for festival in lunar_festivals:
                        if festival and festival != "None":
                            jieri_array.append(f"{festival} {days_ahead}天")
            
            # 更新缓存
            self._cached_festivals = jieri_array
            self._cache_date = current_date
            _LOGGER.debug(f"[SENSOR] 节日缓存已更新，日期: {current_date}")
        else:
            jieri_array = self._cached_festivals
            _LOGGER.debug(f"[SENSOR] 使用节日缓存，跳过计算")
        
        festival_time = (time.time() - festival_start) * 1000
        _LOGGER.debug(f"[SENSOR] 未来100天节日处理完成，耗时: {festival_time:.2f}毫秒，找到{len(jieri_array)}个节日")

        # 处理生日/纪念日（使用缓存）
        birthday_start = time.time()
        today = dt_util.now().date()
        birthdays = self._config_entry.data.get(CONF_BIRTHDAYS, [])
        
        # 检查缓存是否有效（当天有效）
        if self._cached_birthdays is None or self._last_cache_date != str(today):
            _LOGGER.debug(f"[SENSOR] 生日缓存失效，重新处理{len(birthdays)}个生日/纪念日，缓存日期: {self._last_cache_date}, 当前日期: {today}")
            birthday_info = []
            
            for birthday in birthdays:
                name = birthday.get(CONF_NAME, "")
                solar_birthday = birthday.get(CONF_SOLAR_BIRTHDAY, "")
                lunar_birthday = birthday.get(CONF_LUNAR_BIRTHDAY, "")
                
                birthday_data = {
                    "名称": name,
                    "阳历生日": solar_birthday,
                    "阳历天数": "",
                    "阳历天数说明": "",
                    "农历生日": lunar_birthday,
                    "农历天数": "",
                    "农历天数说明": ""
                }
                
                # 计算阳历生日距离今天的天数
                if solar_birthday:
                    try:
                        month = int(solar_birthday[:2])
                        day = int(solar_birthday[2:])
                        
                        # 特殊处理：阳历0229的日期，如果是平年则按0228计算
                        if month == 2 and day == 29:
                            # 检查今年是否为闰年
                            is_leap_year = (today.year % 4 == 0 and today.year % 100 != 0) or (today.year % 400 == 0)
                            if not is_leap_year:
                                day = 28
                        
                        # 计算今年的生日日期
                        this_year_birthday = datetime(today.year, month, day).date()
                        
                        # 如果今年的生日已经过了，计算明年的生日
                        if this_year_birthday < today:
                            next_year = today.year + 1
                            # 检查明年是否为闰年（对于2月29日特殊处理）
                            if month == 2 and day == 29:
                                is_next_year_leap = (next_year % 4 == 0 and next_year % 100 != 0) or (next_year % 400 == 0)
                                if is_next_year_leap:
                                    next_birthday = datetime(next_year, month, day).date()
                                else:
                                    next_birthday = datetime(next_year, 2, 28).date()
                            else:
                                next_birthday = datetime(next_year, month, day).date()
                        else:
                            next_birthday = this_year_birthday
                        
                        days_until = (next_birthday - today).days
                        birthday_data["阳历天数"] = int(days_until)
                        birthday_data["阳历天数说明"] = f"{name} 距离{days_until}天"
                    except (ValueError, IndexError):
                        pass
                
                # 计算农历生日距离今天的天数
                if lunar_birthday:
                    try:
                        _LOGGER.debug(f"处理农历生日: {name}, 日期: {lunar_birthday}")
                        # 确保正确解析农历生日格式，处理前导零的情况
                        lunar_birth_month = int(lunar_birthday[:2])
                        lunar_birth_day = int(lunar_birthday[2:])
                        _LOGGER.debug(f"解析农历生日: 月份={lunar_birth_month}, 日期={lunar_birth_day}")
                                
                        # 获取农历月份的最大天数
                        def get_max_days_in_lunar_month(year, month):
                            try:
                                days_count = LunarMonth.fromYm(int(year), int(month)).getDayCount()
                                return days_count
                            except AttributeError:
                                return 29
                   
                        current_lunar_year = now_lunar_datetime.getYear()
                        _LOGGER.debug(f"当前农历年份: {current_lunar_year}")
                        
                        # 检查是否需要调整日期（如果日期超过了当月最大天数）
                        max_days = get_max_days_in_lunar_month(current_lunar_year, lunar_birth_month)
                        adjusted_lunar_day = min(lunar_birth_day, max_days)
                        
                        if adjusted_lunar_day != lunar_birth_day:
                            birthday_data["农历生日调整"] = f"原生日{lunar_birth_month}月{lunar_birth_day}日调整为{lunar_birth_month}月{adjusted_lunar_day}日（{lunar_birth_month}月最大天数为{max_days}天）"
                        
                        _LOGGER.debug(f"使用调整后的日期: {lunar_birth_month}月{adjusted_lunar_day}日")
                        this_year_lunar_birthday = Lunar.fromYmd(current_lunar_year, lunar_birth_month, adjusted_lunar_day).getSolar().toString()
                        this_birthday_parts = this_year_lunar_birthday.split('-')
                        this_year_birthday = datetime(int(this_birthday_parts[0]), int(this_birthday_parts[1]), int(this_birthday_parts[2])).date()

                        
                        # 如果今年的农历生日已经过了，计算明年的农历生日
                        if this_year_birthday < today:
                            # 检查明年是否需要调整日期（如果日期超过了当月最大天数）
                            next_lunar_year = current_lunar_year + 1
                            _LOGGER.debug(f"今年的生日已过，计算明年: {next_lunar_year}")
                            
                            max_days = get_max_days_in_lunar_month(next_lunar_year, lunar_birth_month)
                            next_lunar_day = min(lunar_birth_day, max_days)
                            
                            if next_lunar_day != lunar_birth_day:
                                if "农历生日调整" not in birthday_data:
                                    birthday_data["农历生日调整"] = f"原生日{lunar_birth_month}月{lunar_birth_day}日调整为{lunar_birth_month}月{next_lunar_day}日（明年{lunar_birth_month}月最大天数为{max_days}天）"
                            
                            next_year_lunar_birthday = Lunar.fromYmd(next_lunar_year, lunar_birth_month, next_lunar_day).getSolar().toString()
                            next_birthday_parts = next_year_lunar_birthday.split('-')
                            next_birthday = datetime(int(next_birthday_parts[0]), int(next_birthday_parts[1]), int(next_birthday_parts[2])).date()
                        else:
                            next_birthday = this_year_birthday
                        
                        days_until = (next_birthday - today).days
                        birthday_data["农历天数"] = int(days_until)
                        birthday_data["农历天数说明"] = f"{name} 距离{days_until}天"
                    except (ValueError, IndexError) as e:
                        _LOGGER.error(f"处理农历生日出错: {name}, 日期: {lunar_birthday}, 错误: {str(e)}")
                        
                        # 设置默认值，确保即使出错也有显示
                        birthday_data["农历天数"] = "365"
                        birthday_data["农历天数说明"] = f"{name} 日期无效"
                
                birthday_info.append(birthday_data)
            
            # 提取并排序阳历和农历天数（用于"最近的生日"）
            sort_start = time.time()
            sorted_birthdays = []
            for item in birthday_info:
                name = item.get("名称", "")
                lunar_days = item.get("农历天数", "")
                solar_days = item.get("阳历天数", "")
                
                # 优先使用农历天数，如果没有则使用阳历天数
                if lunar_days:
                    days = int(lunar_days)
                    sorted_birthdays.append({"name": name, "days": days})
                elif solar_days:
                    days = int(solar_days)
                    sorted_birthdays.append({"name": name, "days": days})
            
            # 按天数排序（仅用于"最近的生日"）
            sorted_birthdays.sort(key=lambda x: x["days"])
            
            # 生成最近生日信息数组
            nearest_birthdays_array = []
            for item in sorted_birthdays:
                nearest_birthdays_array.append(f"{item['name']} 距离{item['days']}天")
            
            sort_time = (time.time() - sort_start) * 1000
            birthday_time = (time.time() - birthday_start) * 1000
            _LOGGER.debug(f"[SENSOR] 生日处理完成，计算耗时: {birthday_time:.2f}毫秒，排序耗时: {sort_time:.2f}毫秒")
            
            # 更新生日缓存
            self._cached_birthdays = {
                "info": birthday_info,
                "nearest": nearest_birthdays_array
            }
            self._last_cache_date = str(today)
            _LOGGER.debug(f"[SENSOR] 生日缓存已更新，日期: {today}")
        else:
            # 使用缓存数据
            cached_data = self._cached_birthdays
            birthday_info = cached_data["info"]
            nearest_birthdays_array = cached_data["nearest"]
            _LOGGER.debug(f"[SENSOR] 使用生日缓存，跳过计算")
        
        # 更新状态和属性
        update_start = time.time()
        self._state = now_solar_date
        self._attributes = {
            "今天的阳历日期": now_solar,
            "今天的农历日期": now_lunar,
            "点击的阳历日期": tap_solar,
            "点击的农历日期": tap_lunar,
            "节气": jieqi,
            "生日": birthday_info,
            "最近的生日": nearest_birthdays_array,
            "最近的节日": jieri_array,
            "老黄历信息": huangli_info,
            "农历id": lunarday_num,   
            "农历文本": lunar_label,     
            "节气文本": jieqi_label,   
            "假期文本": jiaqi_label,   
            "农历节日文本": jieri_label_lunar, 
            "阳历节日文本": jieri_label_solar, 
        }
        update_time = (time.time() - update_start) * 1000
        total_time = (time.time() - start_time) * 1000
        _LOGGER.debug(f"[SENSOR] 属性更新耗时: {update_time:.2f}毫秒")
        _LOGGER.info(f"[SENSOR] 传感器数据更新完成，总耗时: {total_time:.2f}毫秒，点击日期: {tap_datetime}")
