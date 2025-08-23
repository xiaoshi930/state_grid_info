## 安装步骤

### 方法一：通过 HACS 安装（推荐）
1. 确保已安装 [HACS](https://hacs.xyz/)。
2. 在 HACS 的「集成」页面中，点击右上角的「⋮」按钮，选择「自定义存储库」。
3. 输入以下信息：
   - 存储库: `https://github.com/your_repo/state_grid_info`
   - 类别: 集成
4. 点击「添加」。
5. 在 HACS 的「集成」页面中搜索 `State Grid Info`，然后点击「下载」。
6. 下载完成后，重启 Home Assistant。

### 方法二：手动安装
1. 下载集成文件：
   - 从 [GitHub 发布页面](https://github.com/your_repo/state_grid_info/releases) 下载最新版本的 `.zip` 文件。
2. 解压文件，将 `custom_components/state_grid_info` 文件夹复制到您的 Home Assistant 的 `custom_components` 目录中。
   - 如果 `custom_components` 目录不存在，请手动创建。
3. 重启 Home Assistant。

## 数据来源（不会干扰原始数据获取频率）
1、HassBox集成生成的config配置文件  
2、青龙脚本发送的mqtt消息：多户号tate-grid-multiple.js（https://github.com/x2rr/state-grid）  

## 配套UI卡片
<img width="1343" height="1062" alt="b8acd60ecba292966016b8120a090b0" src="https://github.com/user-attachments/assets/edd70f5c-b2a2-4e86-b27c-aefe0058d460" />

### 功能1：国网日历
**引用示例**
~~~
type: custom:state-grid-calendar
entity: sensor.state_grid   # 集成实体
theme: "off"                # 选项on是白色，选项off是黑色，也可以引用全局函数：'[[[ return theme()]]]'
height: 330px               # 总高度
width: 380px                # 总宽度
border: 10px                # 圆角大小
color_num: '#0fccc3'        # 电量颜色，默认值：'#0fccc3'
color_cost: '#804aff'       # 电费颜色，默认值：'#804aff'
~~~

### 功能2：国网表格
**引用示例**
~~~
type: custom:state-grid-table
entity: sensor.state_grid   # 集成实体
button: button.qinglong     # 刷新按钮
title: 电费信息              # 标题，默认电费信息
titleFontSize: 20px         # 标题字体大小
theme: "off"                # 选项on是白色，选项off是黑色，也可以引用全局函数：'[[[ return theme()]]]'
height: 330px               # 总高度
width: 380px                # 总宽度
border: 10px                # 圆角大小
cardwidth: 70px             # 每个按钮宽度
cardheight: 35px            # 每个按钮高度
color_num: '#0fccc3'        # 电量颜色，默认值：'#0fccc3'
color_cost: '#804aff'       # 电费颜色，默认值：'#804aff'
t_num: none                 # 有此项时，不显示尖相关数据
p_num: none                 # 有此项时，不显示峰相关数据
n_num: none                 # 有此项时，不显示平相关数据
v_num: none                 # 有此项时，不显示谷相关数据
icon: none                  # 有此项时，不显示图标
balance_name: '电费余额'     # 电费余额的名字
~~~

### 功能3：国网每日图表
**引用示例**
~~~
type: custom:state-grid-chart-day
entity: sensor.state_grid   # 集成实体
theme: "off"                # 选项on是白色，选项off是黑色，也可以引用全局函数：'[[[ return theme()]]]'
height: 330px               # 总高度
width: 380px                # 总宽度
color_num: '#0fccc3'        # 电量颜色，默认值：'#0fccc3'
color_cost: '#804aff'       # 电费颜色，默认值：'#804aff'
~~~

### 功能4：国网每月图表
**引用示例**
~~~
type: custom:state-grid-chart-month
entity: sensor.state_grid   # 集成实体
theme: "off"                # 选项on是白色，选项off是黑色，也可以引用全局函数：'[[[ return theme()]]]'
height: 330px               # 总高度
width: 380px                # 总宽度
color_num: '#0fccc3'        # 电量颜色，默认值：'#0fccc3'
color_cost: '#804aff'       # 电费颜色，默认值：'#804aff'
~~~

### 功能5：国网UI（手机端整合）
**引用示例**
~~~
type: custom:state-grid-phone
entity: sensor.state_grid   # 集成实体
theme: "off"                # 选项on是白色，选项off是黑色，也可以引用全局函数：'[[[ return theme()]]]'
height: 330px               # 总高度
width: 380px                # 总宽度
color_num: '#0fccc3'        # 电量颜色，默认值：'#0fccc3'
color_cost: '#804aff'       # 电费颜色，默认值：'#804aff'
~~~

### 功能6：国网UI（平板端整合）
**引用示例**
~~~
type: custom:state-grid-pad
entity: sensor.state_grid   # 集成实体
theme: "off"                # 选项on是白色，选项off是黑色，也可以引用全局函数：'[[[ return theme()]]]'
height: 330px               # 总高度
width: 380px                # 总宽度
color_num: '#0fccc3'        # 电量颜色，默认值：'#0fccc3'
color_cost: '#804aff'       # 电费颜色，默认值：'#804aff'
~~~
