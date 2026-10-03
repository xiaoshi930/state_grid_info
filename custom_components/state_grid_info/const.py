"""Constants for the State Grid Info integration."""

DOMAIN = "state_grid_info"
NAME = "国家电网辅助信息"

# 数据来源选项
DATA_SOURCE_HASSBOX = "hassbox"
DATA_SOURCE_QINGLONG = "qinglong"
DATA_SOURCE_STATE_GRID_APP = "state_grid_app"
DATA_SOURCE_OPTIONS = [
    DATA_SOURCE_HASSBOX,
    DATA_SOURCE_QINGLONG,
    DATA_SOURCE_STATE_GRID_APP,
]
DATA_SOURCE_NAMES = {
    DATA_SOURCE_HASSBOX: "HassBox集成",
    DATA_SOURCE_QINGLONG: "国网青龙脚本",
    DATA_SOURCE_STATE_GRID_APP: "网上国网App",
}



# 计费标准选项
BILLING_STANDARD_YEAR_阶梯_峰平谷 = "year_ladder_fpg"
BILLING_STANDARD_YEAR_阶梯 = "year_ladder"
BILLING_STANDARD_MONTH_阶梯_峰平谷_变动阶梯 = "month_ladder_fpg_variable_ladder"
BILLING_STANDARD_MONTH_阶梯_峰平谷_变动价格 = "month_ladder_fpg_variable"
BILLING_STANDARD_MONTH_阶梯_峰平谷 = "month_ladder_fpg"
BILLING_STANDARD_MONTH_阶梯 = "month_ladder"
BILLING_STANDARD_OTHER_平均单价 = "other_average"

BILLING_STANDARD_OPTIONS = [
    BILLING_STANDARD_YEAR_阶梯_峰平谷,
    BILLING_STANDARD_YEAR_阶梯,
    BILLING_STANDARD_MONTH_阶梯_峰平谷_变动阶梯,
    BILLING_STANDARD_MONTH_阶梯_峰平谷_变动价格,
    BILLING_STANDARD_MONTH_阶梯_峰平谷,
    BILLING_STANDARD_MONTH_阶梯,
    BILLING_STANDARD_OTHER_平均单价,
]

BILLING_STANDARD_NAMES = {
    BILLING_STANDARD_YEAR_阶梯_峰平谷: "年阶梯峰平谷计费",
    BILLING_STANDARD_YEAR_阶梯: "年阶梯计费",
    BILLING_STANDARD_MONTH_阶梯_峰平谷_变动阶梯: "月阶梯峰平谷变动阶梯计费",
    BILLING_STANDARD_MONTH_阶梯_峰平谷_变动价格: "月阶梯峰平谷变动价格计费",
    BILLING_STANDARD_MONTH_阶梯_峰平谷: "月阶梯峰平谷计费",
    BILLING_STANDARD_MONTH_阶梯: "月阶梯计费",
    BILLING_STANDARD_OTHER_平均单价: "平均单价计费",
}

# MQTT 相关常量
CONF_MQTT_HOST = "mqtt_host"
CONF_MQTT_PORT = "mqtt_port"
CONF_MQTT_USERNAME = "mqtt_username"
CONF_MQTT_PASSWORD = "mqtt_password"
CONF_STATE_GRID_ID = "state_grid_id"

# 配置项
CONF_DATA_SOURCE = "data_source"
CONF_BILLING_STANDARD = "billing_standard"
CONF_SEGMENT_DATE = "segment_date"
CONF_SEGMENT_BEFORE_STANDARD = "segment_before_standard"
CONF_SEGMENT_AFTER_STANDARD = "segment_after_standard"
CONF_CONSUMER_NUMBER = "consumer_number"
CONF_CONSUMER_NUMBER_INDEX = "consumer_number_index"
CONF_CONSUMER_NAME = "consumer_name"

# 阶梯价格配置
CONF_LADDER_LEVEL_1 = "ladder_level_1"
CONF_LADDER_LEVEL_2 = "ladder_level_2"
CONF_LADDER_PRICE_1 = "ladder_price_1"
CONF_LADDER_PRICE_2 = "ladder_price_2"
CONF_LADDER_PRICE_3 = "ladder_price_3"
CONF_YEAR_LADDER_START = "year_ladder_start"

# 峰平谷价格配置
CONF_PRICE_TIP = "price_tip"
CONF_PRICE_PEAK = "price_peak"
CONF_PRICE_FLAT = "price_flat"
CONF_PRICE_VALLEY = "price_valley"

# 月份价格配置（变动价格）
CONF_MONTH_PRICES = "month_prices"

# ----------------------------------------------------------------------
# 变动阶梯：每月的阶梯电量与谷电价
# ----------------------------------------------------------------------
# 夏季月份（7-9 月）居民月阶梯电量放宽：第一档 0-260、第二档 261-460、第三档 460 以上；
# 其余月份（1-6 月、10-12 月）：第一档 0-180、第二档 181-280、第三档 280 以上。
SUMMER_LADDER_MONTHS = (7, 8, 9)
LADDER_LEVEL_DEFAULTS_SUMMER = (260.0, 460.0)
LADDER_LEVEL_DEFAULTS_OTHER = (180.0, 280.0)

# 每月三档谷电价默认值：6-10 月为一档，其余月份为另一档（沿用变动价格标准的原默认值）
VALLEY_PRICE_DEFAULTS_LOW = (0.1750, 0.2750, 0.4750)
VALLEY_PRICE_DEFAULTS_HIGH = (0.2535, 0.3535, 0.5535)
LOW_VALLEY_MONTHS = (6, 7, 8, 9, 10)


def month_ladder_level_key(month: int, level: int) -> str:
    """每月阶梯电量配置键名。

    ``level=1`` 表示第 2 档起始电量（第一档上限），``level=2`` 表示第 3 档起始电量。
    """
    return f"month_{int(month):02d}_ladder_level_{int(level)}"


def month_valley_price_key(month: int, level: int) -> str:
    """每月谷电价配置键名，``level`` 为档位 1..3。"""
    return f"month_{int(month):02d}_ladder_{int(level)}_valley"


def default_month_ladder_levels(month: int) -> tuple[float, float]:
    """某月的第 2 / 第 3 档起始电量默认值（夏季 260/460，其余月份 180/280）。"""
    if int(month) in SUMMER_LADDER_MONTHS:
        return LADDER_LEVEL_DEFAULTS_SUMMER
    return LADDER_LEVEL_DEFAULTS_OTHER


def default_month_valley_prices(month: int) -> tuple[float, float, float]:
    """某月三档谷电价的默认值。"""
    if int(month) in LOW_VALLEY_MONTHS:
        return VALLEY_PRICE_DEFAULTS_LOW
    return VALLEY_PRICE_DEFAULTS_HIGH

# 平均单价
CONF_AVERAGE_PRICE = "average_price"

# 预付费配置
CONF_IS_PREPAID = "is_prepaid"
