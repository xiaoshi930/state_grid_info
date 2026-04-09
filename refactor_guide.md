# State Grid Info Refactor Guide

## 目标

本次重构需要同时解决以下问题：

1. 青龙 MQTT 通常只提供最近一段时间的数据，直接用最近 30 天数据计算年阶梯会失真。
2. 当前只有 1 个以余额为主状态的 sensor，不满足 Home Assistant 能源面板对累计电量实体的要求。
3. 现有卡片 UI 体验较好，需要尽量不改或只做兼容性微调。
4. 实际主用数据源为青龙 MQTT，HassBox 仅保留兼容路径，不再作为后续重构重点。
5. 国网官方数据常有 1 到 2 天延迟，若直接依赖实体当前状态进入能源面板，会导致能耗发生时间被错误归属到“数据到达时间”，需要补充历史统计回填机制。

本指南用于固定重构方案，后续实现直接按本文执行，不再重复摸底。

## 当前问题归因

### 1. sensor.py 责任过重

当前 [custom_components/state_grid_info/sensor.py](custom_components/state_grid_info/sensor.py) 同时承担了：

- 数据源接入
- MQTT 生命周期管理
- 原始数据解析
- 阶梯计费计算
- 月年汇总
- 实体属性输出

这会导致两个直接问题：

- 多 sensor 扩展时，所有实体都要依赖一个过于臃肿的文件。
- 数据抓取与实体展示强耦合，不利于后续增加存储层、统计导入层、以及 UI 兼容层。

### 2. attributes 被当成历史数据库使用

当前主实体通过 `extra_state_attributes` 输出 `daylist`、`monthlist`、`yearlist`。短期可用，但不适合承载长期历史。

Home Assistant 的最佳实践是：

- 实体属性只暴露展示需要的窗口数据。
- 长历史数据进入集成自己的存储层。
- 频繁变化且结构较大的信息不要长期放入 attributes。

### 3. 能源面板要求与当前实体类型不匹配

当前主实体状态是余额，单位是元。这与能源面板要求的累计能耗实体不匹配。

能源面板至少需要一个类似如下特征的实体：

- `device_class: energy`
- `native_unit_of_measurement: kWh`
- `state_class: total_increasing` 或 `total`

### 4. 官方数据存在时间延迟

国网查询得到的日用电通常会比真实发生时间晚 1 到 2 天。如果只在消息到达时更新累计电量实体，Recorder 只会在当前时间生成统计，能源面板就会误判能耗发生时点。

因此需要在“实体当前状态”之外，补一层“历史统计导入”来把迟到的数据回填到正确日期。

## 重构后的文件职责

建议将职责拆分为以下 4 层。

### 1. coordinator.py

新增文件：`custom_components/state_grid_info/coordinator.py`

职责：

- 统一负责 fetch 和 update
- 管理数据源接入
- 管理 MQTT 订阅或重连
- 从数据源收到原始 payload 后进行标准化
- 调用 storage.py 进行历史合并
- 生成当前运行时快照
- 驱动实体刷新
- 触发历史统计导入

为什么需要单独文件：

- 多 sensor 场景下，数据抓取不应该继续写在 sensor.py 中。
- Home Assistant 实体属性应只返回内存中的值，不应在属性访问时做 I/O。
- coordinator 适合成为“唯一数据入口”，后续扩展新实体不会重复实现抓取逻辑。

建议结构：

- `StateGridInfoCoordinator`
- `async_setup_source()`
- `async_handle_qinglong_payload(payload)`
- `async_refresh_from_hassbox()`
- `async_rebuild_runtime_snapshot()`
- `async_import_delayed_statistics_if_needed()`

### 2. storage.py

文件：`custom_components/state_grid_info/storage.py`

职责：

- 持久化每个户号的历史日电量、月汇总、年汇总、统计导入游标
- 提供原子读写接口
- 负责历史 merge、去重、裁剪、版本迁移
- 输出给 coordinator 可直接使用的完整账期数据

注意：

- storage.py 不直接暴露实体。
- storage.py 不直接操作 MQTT。
- storage.py 是历史真相源，UI attributes 只是它的裁剪视图。

### 3. sensor.py

文件：`custom_components/state_grid_info/sensor.py`

职责：

- 只负责实体定义和属性映射
- 不负责 fetch
- 不负责持久化
- 不负责历史回填逻辑

建议实体拆分：

- `StateGridInfoOverviewSensor`
  - 主状态仍可保留余额
  - 继续服务现有 UI 卡片
  - 继续输出兼容属性：`daylist`、`monthlist`、`yearlist`、`计费标准`
- `StateGridInfoTotalEnergySensor`
  - 给能源面板使用
  - 状态为累计总电量
- `StateGridInfoCurrentMonthEnergySensor`
  - 当前月用电量
- `StateGridInfoCurrentMonthCostSensor`
  - 当前月电费
- `StateGridInfoTotalCostSensor`
  - 累计总电费，可选

### 4. 可选 statistics.py

新增可选文件：`custom_components/state_grid_info/statistics.py`

职责：

- 封装 `async_import_statistics` 相关逻辑
- 生成导入 metadata
- 构造需要回填的历史统计点
- 控制幂等导入

如果不想再多拆一个文件，也可以先把这部分逻辑放进 coordinator.py，但不建议继续塞回 sensor.py。

## storage.py 详细方案

storage.py 是本次重构的核心，需要明确它不是“缓存”，而是“集成内部账本”。

### 1. 存储目标

storage.py 要解决的不是“把更多属性搬个位置”，而是建立一个可长期累计的历史层，用于：

- 修复年阶梯和跨月阶梯计算
- 支撑多 sensor 输出
- 支撑 UI 展示窗口裁剪
- 支撑 delayed statistics 回填
- 避免 HA state attributes 体积持续膨胀

### 2. 存储粒度

建议以“户号”为分区键，每个户号单独维护一份历史数据。

建议主结构：

```json
{
  "version": 1,
  "accounts": {
    "4105220903490": {
      "meta": {
        "consumer_number": "4105220903490",
        "consumer_name": "某某",
        "source": "qinglong",
        "last_payload_at": "2026-03-20T10:30:00+08:00",
        "last_official_day": "2026-03-18",
        "last_imported_stat_day": "2026-03-17",
        "last_total_energy": 3256.42,
        "last_total_cost": 1876.31,
        "schema_version": 1
      },
      "daily": {
        "2026-03-18": {
          "day": "2026-03-18",
          "dayEleNum": 12.34,
          "dayEleCost": 6.27,
          "dayTPq": 1.20,
          "dayPPq": 4.80,
          "dayNPq": 3.10,
          "dayVPq": 3.24,
          "source_updated_at": "2026-03-20T10:30:00+08:00",
          "official": true
        }
      },
      "monthly": {
        "2026-03": {
          "month": "2026-03",
          "monthEleNum": 286.40,
          "monthEleCost": 154.26,
          "monthTPq": 18.00,
          "monthPPq": 110.20,
          "monthNPq": 82.30,
          "monthVPq": 75.90
        }
      },
      "yearly": {
        "2026": {
          "year": "2026",
          "yearEleNum": 912.50,
          "yearEleCost": 501.80,
          "yearTPq": 62.10,
          "yearPPq": 351.20,
          "yearNPq": 272.40,
          "yearVPq": 226.80
        }
      },
      "statistics": {
        "total_energy": {
          "statistic_id": "state_grid_info:4105220903490:total_energy",
          "last_imported_day": "2026-03-17",
          "last_imported_total": 3244.08
        }
      }
    }
  }
}
```

### 3. 为什么按 daily 保存最合适

日电量是最小且最稳定的官方结算粒度，按天保存有几个好处：

- 年阶梯可以准确累计
- 月汇总和年汇总都可从 daily 重算
- 可以根据官方迟到数据精确回填到历史日期
- 相比存原始大 payload，结构更小、更稳定

原则上，storage.py 内不保存“展示专用的裁剪数组”，只保存完整历史和少量派生缓存。

### 4. merge 规则

对于青龙 MQTT 每次收到的数据，storage.py 需要做增量合并，而不是覆盖。

建议规则：

- 以 `day` 为唯一键
- 同一天已存在数据时，优先保留“更可信”的一条
- 判断更可信的标准建议按以下顺序：
  - `official` 为真优先
  - 数值更完整优先
  - `source_updated_at` 更新更晚优先
  - 同日总电量更大者优先，仅作为兜底规则

不建议简单用“新数据直接覆盖旧数据”，否则迟到纠偏会把更完整的历史反复冲掉。

### 5. 派生汇总策略

storage.py 需要提供两个层次的接口：

- 完整历史接口
- 展示窗口接口

完整历史接口用于：

- 阶梯计算
- 统计导入
- 多实体计算

展示窗口接口用于：

- `daylist`: 最近 30 天
- `monthlist`: 最近 24 个月或最近 2 个自然年
- `yearlist`: 最近 3 到 5 年

也就是说：

- 计算层基于全量历史
- 实体 attributes 只基于裁剪结果

### 6. 裁剪和容量控制

虽然 .storage 不受 attributes 那种直接限制，但也不建议无限堆积。

建议保留策略：

- `daily`: 默认保留 5 年
- `monthly`: 可全保留，数据量很小
- `yearly`: 可全保留
- `statistics` 游标：长期保留

如果后续确实担心体积，可以只裁掉最老的 `daily`，但月年汇总不要裁。

### 7. storage.py 建议 API

建议提供如下接口：

- `async_load()`
- `async_save()`
- `async_get_account(consumer_number)`
- `async_merge_daily_records(consumer_number, records, meta)`
- `async_rebuild_monthly(consumer_number)`
- `async_rebuild_yearly(consumer_number)`
- `async_get_runtime_snapshot(consumer_number)`
- `async_mark_statistics_imported(consumer_number, stat_key, last_day, last_total)`
- `async_get_statistics_cursor(consumer_number, stat_key)`

### 8. version 和迁移

storage.py 应从一开始就带版本号。

建议：

- 顶层 `version`
- 账户级 `schema_version`
- 每次结构变更写迁移函数

不要把未来所有结构修改都寄希望于“删除 .storage 重来”。

## 数据流方案

### 1. 青龙 MQTT 主路径

推荐数据流：

1. coordinator 收到 MQTT payload
2. 标准化成统一 `daily records`
3. 调用 storage 合并历史
4. storage 重建 monthly 和 yearly
5. coordinator 读取 runtime snapshot
6. coordinator 更新内存快照
7. 多个 sensor 从同一个 snapshot 读取各自状态
8. coordinator 判断是否需要调用 `async_import_statistics` 回填延迟账单

### 2. HassBox 兼容路径

HassBox 保留，但定位为兼容模式：

- 初次导入历史
- 手动刷新时导入
- 作为备用数据源

不建议继续围绕 HassBox 路径设计新特性。

## 多 sensor 方案

### 必选实体

#### 1. Overview Sensor

用途：

- 保留现有卡片 UI
- 提供余额和汇总视图

建议：

- 实体名和实体 ID 尽量保持兼容
- 主状态仍可保留为余额
- attributes 保留以下兼容字段：
  - `date`
  - `daylist`
  - `monthlist`
  - `yearlist`
  - `计费标准`
  - `剩余天数`
  - `预付费`

#### 2. Total Energy Sensor

用途：

- 直接接入能源面板

建议属性：

- `device_class = energy`
- `native_unit_of_measurement = kWh`
- `state_class = total_increasing`
- `native_value = 官方累计总电量`

说明：

- 这个实体不要再挂大 attributes。
- 只保留少量必要信息，例如 `last_official_day`。

### 推荐辅助实体

- 当前月用电量
- 当前月电费
- 累计总电费
- 余额

这些实体主要用于自动化、仪表盘、模板卡片，而不是能源面板刚需。

## 阶梯计算策略

### 原则

阶梯计算不允许再基于 payload 当前窗口直接算。

必须基于 storage 中的完整账期历史。

### 年阶梯

- 根据配置项 `year_ladder_start` 计算当前账期起点
- 从 storage 的 `daily` 中选出账期内所有日期
- 按日期升序累加到目标日
- 计算该日属于哪一档，以及是否跨档

### 月阶梯

- 从 storage 的 `daily` 中选出目标月所有日期
- 按日期升序累加到目标日
- 计算月累计及跨档情况

### 结论

只要 storage 内的 daily 足够完整，阶梯计算就不会再受“MQTT 仅提供最近 30 天”影响。

## UI 保留策略

目标是尽量不动前端卡片，只替换后端供数方式。

### 已确认的兼容字段

当前卡片核心依赖：

- `attributes.daylist`
- `attributes.monthlist`
- `attributes.yearlist`
- `attributes.计费标准`

因此后端只要保证这些字段结构不变，卡片即可继续使用。

### 建议做法

- Overview Sensor 继续输出这几个字段
- 但它们来自 storage 裁剪视图，而不是实时拼装全量历史
- `daylist` 只保留最近 30 天即可
- `monthlist` 保留最近 24 个月即可
- `yearlist` 保留最近若干年即可

这能同时满足：

- UI 不变
- attributes 不膨胀
- 后端计算仍然准确

## async_import_statistics 回填方案

这一部分是本次重构必须明确的重点。

### 1. 为什么仅靠 total_increasing 实体还不够

如果官方数据晚 2 天到达：

- 真实情况：3 月 18 日消耗了 12.34 kWh
- 你在 3 月 20 日才收到官方更新
- 若只是把 `total_energy` 实体在 3 月 20 日增加 12.34
- Recorder 会认为这段增量发生在 3 月 20 日附近

对能源面板来说，这会把能耗时间错挂到“更新日”，而不是“发生日”。

### 2. 目标

当收到迟到的官方日账单时：

- 当前实体状态继续更新为最新累计值
- 同时通过 `async_import_statistics` 把这一天对应的累计统计补写到正确日期

### 3. 导入对象

建议只对 `Total Energy Sensor` 做统计导入。

原因：

- 能源面板核心依赖累计能量统计
- 成本、余额、UI overview 不需要先做历史回填

后续如果要做电费统计，可再扩展，但第一阶段不要分散精力。

### 4. 导入粒度

以“天”为官方可信最小粒度时，建议按“日结束累计值”导入。

实现上需要把每天的官方日电量转换成累计总电量序列，例如：

- 2026-03-16 结束累计 3230.15
- 2026-03-17 结束累计 3244.08
- 2026-03-18 结束累计 3256.42

这样即便数据在 3 月 20 日才到，也可以将 3 月 18 日的统计回填到 3 月 18 日对应的时间点。

### 5. 幂等性要求

不能每次重启或每次收到 payload 都重复导入同一批历史。

因此 storage 需要记录：

- `statistics.total_energy.last_imported_day`
- `statistics.total_energy.last_imported_total`
- 或者更稳妥地记录一个 `imported_days` 游标区间

推荐方案：

- 使用 `last_imported_day`
- 每次只导入“该日期之后，且已成为官方稳定数据”的天数

### 6. 稳定数据判定

由于官方数据会有 1 到 2 天延迟，不建议当天一有数据就立刻认定为最终值。

建议规则：

- 仅导入“距离今天至少 2 天”的官方日数据
- 或仅导入 payload 中明确已结算完成的日期

例如在 3 月 20 日：

- 3 月 18 日及以前的数据可视为稳定
- 3 月 19 日和 3 月 20 日先不导入历史统计

这样可以避免次日官方又修正数据时，需要回滚已导入的统计。

### 7. 导入流程

推荐流程：

1. coordinator 收到新 payload 并完成 storage merge
2. coordinator 读取 `statistics.total_energy.last_imported_day`
3. 从 storage.daily 中找出所有“已稳定但尚未导入”的日期
4. 基于这些日期生成累计总电量序列
5. 调用 `async_import_statistics`
6. 成功后更新 storage 中的统计游标

### 8. 导入失败处理

如果导入失败：

- 不更新 `last_imported_day`
- 保留待导入队列
- 下次刷新时继续重试

不要在导入失败后仍然推进游标，否则会永久丢失历史回填机会。

### 9. 重要边界

`async_import_statistics` 解决的是“把已知历史补到正确时间”。

它不能替代：

- 实体当前状态维护
- storage 内部历史账本
- 阶梯计算所需的完整原始日历史

换句话说：

- storage 负责真相
- total_energy sensor 负责当前值
- async_import_statistics 负责历史时序修正

这三层缺一不可。

## 建议的运行时快照结构

coordinator 给实体暴露的运行时快照建议单独组装，不直接把 storage 原文扔给实体。

建议结构：

```python
{
    "consumer_number": "4105220903490",
    "consumer_name": "某某",
    "balance": 186.35,
    "date": "2026-03-20 10:30:00",
    "overview": {
        "daylist": [...30d...],
        "monthlist": [...24m...],
        "yearlist": [...years...],
        "billing_info": {...}
    },
    "energy": {
        "total_kwh": 3256.42,
        "current_month_kwh": 286.40,
        "current_year_kwh": 912.50,
        "last_official_day": "2026-03-18"
    },
    "cost": {
        "current_month_cost": 154.26,
        "current_year_cost": 501.80,
        "total_cost": 1876.31
    }
}
```

这样 sensor.py 中不同实体只取自己需要的片段。

## 推荐实施顺序

### ~~第一阶段~~

- ~~新增 coordinator.py~~
- ~~把 fetch、update、source handling 从 sensor.py 拆出去~~
- ~~在 storage.py 实现基础读写和历史 merge~~

### ~~第二阶段~~

- ~~基于 storage 改写阶梯计算~~
- ~~让 Overview Sensor 改为读取 runtime snapshot~~
- ~~增加 Total Energy Sensor~~

### ~~第三阶段~~

- ~~增加 async_import_statistics 回填机制~~
- ~~为 delayed official data 建立稳定日期判定和导入游标~~

### 第四阶段

- ~~增加辅助实体~~
- 评估是否还需要把 MQTT 连接切换为 HA 原生 MQTT 订阅

### 第五阶段

- 整理各省电价预设数据，生成 `price_presets.json`
- 在 config_flow 中增加"选择地区"可选步骤
- Options Flow 中同样支持重新选择或清除预设

## 最终结论

### 1. 是否应该新增一个文件负责 fetch 和 update

应该。

对于多 sensor 架构，fetch 和 update 应迁移到新增的 coordinator.py，而不是继续堆在 sensor.py。

### 2. storage.py 的定位

storage.py 不是简单缓存层，而是集成内部的历史账本。它负责：

- 保存完整日历史
- 输出月年汇总
- 支撑阶梯计算
- 支撑 UI 窗口裁剪
- 支撑历史统计回填游标

### 3. delayed official data 的处理原则

必须同时具备两套机制：

- 当前实体状态更新，用于实时展示
- `async_import_statistics` 历史回填，用于修正能源面板时序

### 4. UI 保留策略

保留现有 UI 的关键不是保留单 sensor 架构，而是保留 Overview Sensor 的 attributes 契约。

只要 `daylist`、`monthlist`、`yearlist`、`计费标准` 这些字段结构保持兼容，前端卡片即可继续使用。
## 电价地区预设

### 背景

当前配置集成时，用户需要手动填写计费标准、阶梯电量上限和各时段单价，对于不熟悉当地价格政策的用户来说门槛较高，也容易填错。

### 目标

内置一份按省份/地区整理的电价预设数据集，用户在初次配置（或重新配置）集成时，可以选择所在地区，自动填充：

- 计费标准（年阶梯 / 月阶梯峰平谷 等）
- 阶梯电量上限（第2、3档起始电量）
- 各档平均电价或峰平谷电价
- 年阶梯账期起始月日

选择预设后，所有字段仍可在下一步手动覆盖，预设仅作为初始默认值。

### 数据文件

以 JSON 文件形式内置预设，按省份名称索引，存放于：

`custom_components/state_grid_info/price_presets.json`

### config_flow 改动

- 在现有配置流程中，数据源选择之后新增一个可选步骤「选择地区电价预设」
- 提供一个下拉列表，选项为所有已内置的省份，加一项「手动配置（不使用预设）」
- 选择省份后，后续步骤中的电价字段以预设值作为 default，用户仍可修改
- 选择「手动配置」时流程与当前一致，不做任何预填
- Options Flow（集成已安装后的重新配置）也支持重新选择预设或切换为手动

### 注意事项

- 预设数据仅影响配置时的默认值，不会在运行时替换已保存的配置
- 各省电价每年可能调整，price_presets.json 需注明数据来源和版本日期，便于后续核实更新
- 初期可只收录部分省份，逐步补全；文件结构需保证向后兼容（新增省份不影响已有配置）
- 峰平谷子类型较多（变动谷价等），预设数据中可先只覆盖主流价格，特殊情况留给手动配置
