"""Constants for the State Grid Info integration."""

DOMAIN = "state_grid_info"
NAME = "国家电网辅助信息"

# 数据来源选项
DATA_SOURCE_HASSBOX = "hassbox"
DATA_SOURCE_QINGLONG = "qinglong"
DATA_SOURCE_OPTIONS = [
    DATA_SOURCE_HASSBOX,
    DATA_SOURCE_QINGLONG,
]
DATA_SOURCE_NAMES = {
    DATA_SOURCE_HASSBOX: "HassBox集成",
    DATA_SOURCE_QINGLONG: "国网青龙脚本",
}



# 计费标准选项
BILLING_STANDARD_YEAR_阶梯_峰平谷 = "year_ladder_fpg"
BILLING_STANDARD_YEAR_阶梯 = "year_ladder"
BILLING_STANDARD_MONTH_阶梯_峰平谷_变动价格 = "month_ladder_fpg_variable"
BILLING_STANDARD_MONTH_阶梯_峰平谷 = "month_ladder_fpg"
BILLING_STANDARD_MONTH_阶梯 = "month_ladder"
BILLING_STANDARD_OTHER_平均单价 = "other_average"

BILLING_STANDARD_OPTIONS = [
    BILLING_STANDARD_YEAR_阶梯_峰平谷,
    BILLING_STANDARD_YEAR_阶梯,
    BILLING_STANDARD_MONTH_阶梯_峰平谷_变动价格,
    BILLING_STANDARD_MONTH_阶梯_峰平谷,
    BILLING_STANDARD_MONTH_阶梯,
    BILLING_STANDARD_OTHER_平均单价,
]

BILLING_STANDARD_NAMES = {
    BILLING_STANDARD_YEAR_阶梯_峰平谷: "年阶梯峰平谷计费",
    BILLING_STANDARD_YEAR_阶梯: "年阶梯计费",
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

# 平均单价
CONF_AVERAGE_PRICE = "average_price"
