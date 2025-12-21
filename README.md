## 安装步骤

### 方法一：通过 HACS 安装（推荐）
1. 确保已安装 [HACS](https://hacs.xyz/)。
2. 在 HACS 的「集成」页面中，点击右上角的「⋮」按钮，选择「自定义存储库」。
3. 输入以下信息：
   - 存储库: `https://github.com/xiaoshi930/state_grid_info`
   - 类别: 集成
4. 点击「添加」。
5. 在 HACS 的「集成」页面中搜索 `国家电网辅助`或者`xiaoshi`，然后点击「下载」。
6. 下载完成后，重启 Home Assistant。

### 方法二：手动安装
1. 下载集成文件：
   - 从 [GitHub 发布页面](https://github.com/xiaoshi930/state_grid_info/releases) 下载最新版本的 `.zip` 文件。
2. 解压文件，将 `custom_components/state_grid_info` 文件夹复制到您的 Home Assistant 的 `custom_components` 目录中。
   - 如果 `custom_components` 目录不存在，请手动创建。
3. 重启 Home Assistant。

## 数据来源（不会干扰原始数据获取频率）
1、HassBox集成生成的config配置文件  
2、青龙脚本发送的mqtt消息：多户号tate-grid-multiple.js（https://github.com/x2rr/state-grid）  

## 配套UI卡片
<img width="1576" height="1007" alt="image" src="https://github.com/user-attachments/assets/e334c30e-5c83-43c2-9800-c27c8321221e" />

### 功能1：国网日历
**引用示例**
~~~
type: custom:xiaoshi-state-grid-info
entities:
  - entity_id: sensor.state_grid_4105220903490
  - entity_id: sensor.state_grid_4105220903490
width: 100%
color_num: '#0fccc3'        # 电量颜色，默认值：'#0fccc3'
color_cost: '#804aff'       # 电费颜色，默认值：'#804aff'
~~~
