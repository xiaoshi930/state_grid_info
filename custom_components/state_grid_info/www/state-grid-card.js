console.info("%c 国网信息卡 \n%c   v 2.4   ", "color: red; font-weight: bold; background: black", "color: white; font-weight: bold; background: black");
import { LitElement, html, css } from "https://unpkg.com/lit-element@2.4.0/lit-element.js?module";
import tinycolor from "./tinycolor.js";

class StateGridNodeRed extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      width: { type: String, attribute: true },
      height: { type: String, attribute: true },
      config: { type: Object },
      _data: { type: Object, state: true },
      border: { type: String, attribute: 'border-radius' },
      cardwidth: { type: String, attribute: 'card-width' },
      cardheight: { type: String, attribute: 'card-height' },
      _isRefreshing: { type: Boolean, state: true },
      colorNum: { type: String, attribute: true },
      colorCost: { type: String, attribute: true },
      _layoutStyle: { type: String, state: true },
      entity: { type: String },
    };
  }

  setConfig(config) {
    this.config = {
      ...this.config,
      ...config,
      showIcon: config.icon !=='none'
    };
    this.border = this.config.border || '10px';
    this.cardheight = this.config.cardheight || '35px';
    this.style.setProperty('--title-font-size', this.config.titleFontSize || '20px'); 
    if (config.color_num !== undefined) this.colorNum = config.color_num;
    if (config.color_cost !== undefined) this.colorCost = config.color_cost;
    if (config.entity !== undefined) {
      const oldEntity = this.entity;
      this.entity = config.entity;
      // 如果entity发生变化，重新加载数据
      if (oldEntity !== this.entity && this.hass) {
        this._fetchData();
      }
    }
    this._updateLayout();
  }

  constructor() {
    super();
    this.hass = null;
    this.entity = 'sensor.state_grid';
    this.config = {
      title: '电费信息',
      theme: 'on',
      width: '380px',
      height: '300px',
      border: '10px',
      cardwidth: '',
      cardheight: '35px',
      titleFontSize: '20px',
      n_num: '',
      t_num: '',
      p_num: '',
      v_num: '',
      balance_name: '电费余额'
    };
    this._data = {};
    this._interval = null;
    this._isRefreshing = false;
    this.colorNum = '#0fccc3';
    this.colorCost = '#804aff';
    this._layoutStyle = '';
  }

  static get styles() {
    return css`
      :host {
        display: block;
      }
      .card-container {
        border: 0;
        display: grid;
        border-radius: 10px;
        padding: 0px;
        cursor: default;
        justify-items: center;
        align-items: center;
        gap: 0px;
        margin: 0 0 0 0;

      }
      .light-theme {
        background: rgb(255,255,255);
        color: rgb(0,0,0);
      }
      .dark-theme {
        background: rgb(50,50,50);
        color: rgb(255,255,255);
      }

      .refresh {
        grid-area: refresh;
        font-size: 13px;
        font-weight: bold;
        display: flex;
        align-items: flex-end;
        justify-content: flex-start;
        padding-left: 5px;
        justify-self: start;
      }
      .refresh-button {
        grid-area: refresh-button;
        margin-left: 7px;
        cursor: pointer;
        color: rgb(0,200,200);
        transition: transform 1s ease;
        display: flex;
        align-items: flex-end;
        align-items: flex-end;
        justify-content: flex-end;
      }
      .refresh-button.rotating {
        transform: rotate(360deg);
      }
      @keyframes rotate {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      .date {
        grid-area: date;
        font-size: 13px;
        font-weight: bold;
        display: flex;
        align-items: flex-start; 
        justify-content: flex-start;
        padding-left: 5px;
        justify-self: start;
      }

      .data-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(0,200,200,0.5);
        border-radius: 20px;
        width: var(--card-width, 55px);
        height: var(--card-height, 35px);
      }
      .data-item.light {
        background: rgb(255,255,255);
      }
      .data-item.dark {
        background: rgb(50,50,50);
      }
      .data-item-content {
        display: flex;
        align-items: center;
        width: 100%;
      }
      .data-item-icon {
        width: 9px;
        color: rgb(0,200,200);
        margin-right: 0px;
        flex-shrink: 0;
        transform: scale(0.6);
      }
      .data-item-text {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        width: 100%;
        text-align: center;
      }
      .data-item-value {
        font-size: 10px;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        width: 100%;
        text-align: center;
        margin-top: -3px;
      }
      .data-item-name {
        font-size: 10px;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        width: 100%;
        text-align: center;
        margin-top: 3px;
      }
      .warning {
        color: #FF2000;
        font-weight: bold;
      }
    `;
  }

  _getVisibleColumns() {
    const columns = ['total'];
    if (this.config.t_num !== 'none') columns.push('t');
    if (this.config.p_num !== 'none') columns.push('p');
    if (this.config.n_num !== 'none') columns.push('n');
    if (this.config.v_num !== 'none') columns.push('v');
    columns.push('cost');
    return columns;
  }

  _getDefaultCardWidth(columnCount) {
    switch(columnCount) {
      case 6: return '60px';
      case 5: return '70px';
      case 4: return '90px';
      case 3: return '90px';
      case 2: return '90px';
      default: return '75px';
    }
  }

  _updateLayout() {
    const visibleColumns = this._getVisibleColumns();
    const columnCount = visibleColumns.length;
    this.cardwidth = this.config.cardwidth || this._getDefaultCardWidth(columnCount);
    
    // 动态生成中间列的区域名
    const middleColumns = [];
    if (visibleColumns.includes('t')) middleColumns.push('title');
    if (visibleColumns.includes('p')) middleColumns.push('title');
    if (visibleColumns.includes('n')) middleColumns.push('title');
    if (visibleColumns.includes('v')) middleColumns.push('title');
    
    let gridTemplateAreas = ` 
      ". . ${middleColumns.map(() => '.').join(' ')} . ."   
      "a refresh ${middleColumns.map(() => 'refresh').join(' ')} refresh-button b"   
      "a date ${middleColumns.map(() => 'date').join(' ')} date b"`;
    
    const periods = ['daily', 'monthly', 'last-month', 'yearly'];
    periods.forEach(period => {
      let row = `"a ${period}-total`;
      if (visibleColumns.includes('t')) row += ` ${period}-t`;
      if (visibleColumns.includes('p')) row += ` ${period}-p`;
      if (visibleColumns.includes('n')) row += ` ${period}-n`;
      if (visibleColumns.includes('v')) row += ` ${period}-v`;
      row += ` ${period}-cost b"`;
      gridTemplateAreas += `\n${row}`;
    });

    gridTemplateAreas += `". . ${middleColumns.map(() => '.').join(' ')} . ."`;

    const gridTemplateColumns = `3px auto ${['t', 'p', 'n', 'v'].map(col => visibleColumns.includes(col) ? 'auto' : ' ').join(' ')} auto 3px`;
    this._layoutStyle = `
      grid-template-areas: ${gridTemplateAreas};
      grid-template-columns: ${gridTemplateColumns};
      grid-template-rows: 10px auto auto auto auto auto auto 10px;
    `;
  } 

  updated(changedProperties) {
    if (changedProperties.has('config') || changedProperties.has('entity')) {
      this._fetchData();
      this._updateLayout();
    }
  }

  connectedCallback() {
    super.connectedCallback();
    this._fetchData();
    this._setupInterval();
    this._updateLayout();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._interval) {
      clearInterval(this._interval);
    }
  }

  _setupInterval() {
    this._interval = setInterval(() => {
      this._fetchData();
    }, 10000);
  }

  async _fetchData() {
    if (!this.hass || !this.entity) return;
    try {
      const entity = this.hass.states[this.entity];
      if (!entity) return;
      const attributes = entity.attributes || {};
      const dayData = attributes.daylist?.[0] || {};
      const monthData = attributes.monthlist?.[0] || {};
      const last_monthData = attributes.monthlist?.[1] || {};
      const yearData = attributes.yearlist?.[0] || {};
      this._data = {
        refresh_time: attributes.date || 'N/A',
        daily_lasted_date: dayData.day || 'N/A',
        dayEleNum: dayData.dayEleNum || '0',
        daily_t_ele_num: dayData.dayTPq || '0',
        daily_p_ele_num: dayData.dayPPq || '0',
        daily_n_ele_num: dayData.dayNPq || '0',
        daily_v_ele_num: dayData.dayVPq || '0',
        daily_ele_cost: dayData.dayEleCost || '0',
        month_ele_num: monthData.monthEleNum || '0',
        month_t_ele_num: monthData.monthTPq || '0',
        month_p_ele_num: monthData.monthPPq || '0',
        month_n_ele_num: monthData.monthNPq || '0',
        month_v_ele_num: monthData.monthVPq || '0',
        month_ele_cost: monthData.monthEleCost || '0',
        last_month_ele_num: last_monthData.monthEleNum || '0',
        last_month_t_ele_num: last_monthData.monthTPq || '0',
        last_month_p_ele_num: last_monthData.monthPPq || '0',
        last_month_n_ele_num: last_monthData.monthNPq || '0',
        last_month_v_ele_num: last_monthData.monthVPq || '0',
        last_month_ele_cost: last_monthData.monthEleCost || '0',
        year_ele_num: yearData.yearEleNum || '0',
        year_t_ele_num: yearData.yearTPq || '0',
        year_p_ele_num: yearData.yearPPq || '0',
        year_n_ele_num: yearData.yearNPq || '0',
        year_v_ele_num: yearData.yearVPq || '0',
        year_ele_cost: yearData.yearEleCost || '0'
      };
    } catch (error) {
      console.error('获取数据出错:', error);
    } finally {
      this._isRefreshing = false;
    }
  }

  _handleRefresh() {
    if (this._isRefreshing || !this.config.button || 
        !this.hass.states[this.config.button]) return;
    this._isRefreshing = true;
    setTimeout(() => {
      this._isRefreshing = false;
      this.hass.callService('button', 'press', {entity_id: this.config.button});
    }, 1000);
  }

  _evaluateTheme() {
    try {
      if (!this.config || !this.config.theme) return 'on';
      if (typeof this.config.theme === 'function') {
        return this.config.theme();
      }
      if (typeof this.config.theme === 'string' && 
          (this.config.theme.includes('return') || this.config.theme.includes('=>'))) {
        return (new Function(`return ${this.config.theme}`))();
      }
      return this.config.theme;
    } catch(e) {
      console.error('计算主题时出错:', e);
      return 'on';
    }
  }

  render() {
    if (!this.config) return html``;
    const theme = this._evaluateTheme();
    const themeClass = theme === 'on' ? 'light-theme' : 'dark-theme';
    const itemThemeClass = theme === 'on' ? 'light' : 'dark';
    const visibleColumns = this._getVisibleColumns();
    const showT = visibleColumns.includes('t');
    const showP = visibleColumns.includes('p');
    const showN = visibleColumns.includes('n');
    const showV = visibleColumns.includes('v');
    return html`
      <div class="card-container ${themeClass}"\n
           style="height: ${this.config.height}; width: ${this.config.width};--border-radius: ${this.border};--card-width: ${this.cardwidth};--card-height: ${this.cardheight};${this._layoutStyle}">
        <div class="refresh">
          用电刷新时间：${this._data.refresh_time || 'N/A'}
        </div>
        ${this.config.button ? html`
        <ha-icon class="refresh-button ${this._isRefreshing ? 'rotating' : ''}"\n icon="mdi:refresh"\n @click=${this._handleRefresh}\n title="手动刷新数据">
        </ha-icon>
        ` : ''}
        <div class="date">
          最新用电日期：${this._data.daily_lasted_date || 'N/A'}
        </div>
        ${this._renderDataItem('日总用电', 'mdi:lightning-bolt', `${this._data.dayEleNum || '0'}°`, itemThemeClass, 'daily-total', this.colorNum)}
        ${showT ? this._renderDataItem('日尖用电', 'mdi:lightning-bolt', `${this._data.daily_t_ele_num || '0'}°`, itemThemeClass, 'daily-t', this.colorNum) : ''}
        ${showP ? this._renderDataItem('日峰用电', 'mdi:lightning-bolt', `${this._data.daily_p_ele_num || '0'}°`, itemThemeClass, 'daily-p', this.colorNum) : ''}
        ${showN ? this._renderDataItem('日平用电', 'mdi:lightning-bolt', `${this._data.daily_n_ele_num || '0'}°`, itemThemeClass, 'daily-n', this.colorNum) : ''}
        ${showV ? this._renderDataItem('日谷用电', 'mdi:lightning-bolt', `${this._data.daily_v_ele_num || '0'}°`, itemThemeClass, 'daily-v', this.colorNum) : ''}
        ${this._renderDataItem('日用电费', 'mdi:cash', `${this._data.daily_ele_cost || '0'}元`, itemThemeClass, 'daily-cost', this.colorCost)} 
        ${this._renderDataItem('月总用电', 'mdi:lightning-bolt', `${this._data.month_ele_num || '0'}°`, itemThemeClass, 'monthly-total', this.colorNum)}
        ${showT ? this._renderDataItem('月尖用电', 'mdi:lightning-bolt', `${this._data.month_t_ele_num || '0'}°`, itemThemeClass, 'monthly-t', this.colorNum) : ''}
        ${showP ? this._renderDataItem('月峰用电', 'mdi:lightning-bolt', `${this._data.month_p_ele_num || '0'}°`, itemThemeClass, 'monthly-p', this.colorNum) : ''}
        ${showN ? this._renderDataItem('月平用电', 'mdi:lightning-bolt', `${this._data.month_n_ele_num || '0'}°`, itemThemeClass, 'monthly-n', this.colorNum) : ''}
        ${showV ? this._renderDataItem('月谷用电', 'mdi:lightning-bolt', `${this._data.month_v_ele_num || '0'}°`, itemThemeClass, 'monthly-v', this.colorNum) : ''}
        ${this._renderDataItem('月用电费', 'mdi:cash', `${this._data.month_ele_cost || '0'}元`, itemThemeClass, 'monthly-cost', this.colorCost)}
        ${this._renderDataItem('上月总用电', 'mdi:lightning-bolt', `${this._data.last_month_ele_num || '0'}°`, itemThemeClass, 'last-month-total', this.colorNum)}
        ${showT ? this._renderDataItem('上月尖用电', 'mdi:lightning-bolt', `${this._data.last_month_t_ele_num || '0'}°`, itemThemeClass, 'last-month-t', this.colorNum) : ''}
        ${showP ? this._renderDataItem('上月峰用电', 'mdi:lightning-bolt', `${this._data.last_month_p_ele_num || '0'}°`, itemThemeClass, 'last-month-p', this.colorNum) : ''}
        ${showN ? this._renderDataItem('上月平用电', 'mdi:lightning-bolt', `${this._data.last_month_n_ele_num || '0'}°`, itemThemeClass, 'last-month-n', this.colorNum) : ''}
        ${showV ? this._renderDataItem('上月谷用电', 'mdi:lightning-bolt', `${this._data.last_month_v_ele_num || '0'}°`, itemThemeClass, 'last-month-v', this.colorNum) : ''}
        ${this._renderDataItem('上月用电费', 'mdi:cash', `${this._data.last_month_ele_cost || '0'}元`, itemThemeClass, 'last-month-cost', this.colorCost)}
        ${this._renderDataItem('年总用电', 'mdi:lightning-bolt', `${this._data.year_ele_num || '0'}°`, itemThemeClass, 'yearly-total', this.colorNum)}
        ${showT ? this._renderDataItem('年尖用电', 'mdi:lightning-bolt', `${this._data.year_t_ele_num || '0'}°`, itemThemeClass, 'yearly-t', this.colorNum) : ''}
        ${showP ? this._renderDataItem('年峰用电', 'mdi:lightning-bolt', `${this._data.year_p_ele_num || '0'}°`, itemThemeClass, 'yearly-p', this.colorNum) : ''}
        ${showN ? this._renderDataItem('年平用电', 'mdi:lightning-bolt', `${this._data.year_n_ele_num || '0'}°`, itemThemeClass, 'yearly-n', this.colorNum) : ''}
        ${showV ? this._renderDataItem('年谷用电', 'mdi:lightning-bolt', `${this._data.year_v_ele_num || '0'}°`, itemThemeClass, 'yearly-v', this.colorNum) : ''}
        ${this._renderDataItem('年用电费', 'mdi:cash', `${this._data.year_ele_cost || '0'}元`, itemThemeClass, 'yearly-cost', this.colorCost)}
      </div>
    `;
  }

  _renderDataItem(name, icon, value, themeClass, gridArea, color) {
    return html`
      <div class="data-item ${themeClass}"\n style="${gridArea ? `grid-area: ${gridArea}` : ''}">
        ${this.config.showIcon && icon !== 'none' ? html`
          <div class="data-item-content">
            <ha-icon class="data-item-icon"\n .icon=${icon}\n style="color: ${color}"></ha-icon>
            <div class="data-item-text">
              <div class="data-item-name">${name}</div>
              <div class="data-item-value"\n style="color: ${color};">${value}</div>
            </div>
          </div>
        ` : html`
          <div class="data-item-content">
            <div class="data-item-text">
              <div class="data-item-name">${name}</div>
              <div class="data-item-value"\n style="color: ${color}">${value}</div>
            </div>
          </div>
        `}
      </div>
    `;
  }
}
customElements.define('xiaoshi-state-grid-table', StateGridNodeRed);

class StateGridCalendar extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      width: { type: String, attribute: true },
      height: { type: String, attribute: true },
      year: { type: Number },
      month: { type: Number },
      entity: { type: String },
      activeNav: { type: String },
      colorNum: { type: String, attribute: true },
      colorCost: { type: String, attribute: true },
      theme: { type: String },
      config: { type: Object }
    };
  }
  
  setConfig(config) {
    this.config = config;
    if (config) {
      if (config.width !== undefined) this.width = config.width;
      if (config.height !== undefined) this.height = config.height;
      if (config.year !== undefined) this.year = config.year;
      if (config.month !== undefined) this.month = config.month;
      if (config.entity !== undefined) {
        const oldEntity = this.entity;
        this.entity = config.entity;
        // 如果entity发生变化，重新加载数据
        if (oldEntity !== this.entity && this.hass) {
          this.updateDayData();
        }
      }
      if (config.color_num !== undefined) this.colorNum = config.color_num;
      if (config.color_cost !== undefined) this.colorCost = config.color_cost;
      this.requestUpdate();
    }
  }

  constructor() {
    super();
    const today = new Date();
    this.year = today.getFullYear();
    this.month = today.getMonth() + 1;
    this.width = '380px';
    this.height = '300px';
    this.theme = 'on';
    this.entity = 'sensor.state_grid';
    this.dayData = [];
    this.activeNav = '';
    this.monthData = null;
    this.colorNum = '#0fccc3';
    this.colorCost = '#804aff';
  }

  static get styles() {
    return css`
      :host {
        display: block;
      }
      .calendar-grid {
        border: 0;
        border-radius: 10px;
        display: grid;
        grid-template-areas:
          "yearlast year yearnext today monthlast month monthnext"
          "week1 week2 week3 week4 week5 week6 week7" 
          "id1 id2 id3 id4 id5 id6 id7" 
          "id8 id9 id10 id11 id12 id13 id14" 
          "id15 id16 id17 id18 id19 id20 id21" 
          "id22 id23 id24 id25 id26 id27 id28" 
          "id29 id30 id31 id32 id33 id34 id35" 
          "id36 id37 id98 id98 id99 id99 id99";
        grid-template-columns: repeat(7, 1fr);
        grid-template-rows: 1fr 0.6fr 1fr 1fr 1fr 1fr 1fr 1fr;
        gap: 0px;
        padding: 0px;
        margin: 0px;
      }
      .celltotal {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 0;
        cursor: default;
        font-size: 15px;
        font-weight: 600;
        white-space: nowrap;
      }
      .cell {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 0;
        cursor: default;
        font-size: 12px;
        line-height: 12px;
        font-weight: 500;
      }
      .month-cell {
        border-bottom: 0.5px solid #00a0a080;
        border-right: 0.5px solid #00a0a080;
      }
      .month-cell-left {
        border-left: 0.5px solid #00a0a080;
      }
      .month-cell-top {
        border-top: 0.5px solid #00a0a080;
      }
      .month-cell-right {
        border-right: 0.5px solid #00a0a080;
      }
      .month-cell-bottom {
        border-bottom: 0.5px solid #00a0a080;
      }
      .nav-button {
        cursor: pointer;
        user-select: none;
        font-size: 12px;
        transition: all 0.2s ease;
        border-radius: 10px;
      }
      .nav-button:active {
        transform: scale(0.95);
        opacity: 0.8;
      }
      .active-nav {
        background-color: rgba(0, 160, 160, 0.2);
        border-radius: 4px;
      }
      .today-button {
        cursor: pointer;
        user-select: none;
      }
      .weekday {
      }
      .month-day {
        cursor: pointer;
      }
      .electricity-num {
        font-size: 12px;
        line-height: 12px;
      }
      .electricity-cost {
        font-size: 12px;
        line-height: 12px;
      }
      .min-usage {
        background-color: rgba(0, 255, 0, 0.2);
      }
      .max-usage {
        background-color: rgba(255, 0, 0, 0.2);
      }
      .summary-info {
        display: flex;
        flex-direction: column;
        align-items:  flex-start;
        justify-content: center;
        font-size: 13px;
        line-height: 16px;
        font-weight: 500;
        padding: 0 0 0 30px;
        white-space: nowrap;
      }
    `;
  }

  updateDayData() {
    if (this.hass && this.entity) {
      const entityObj = this.hass.states[this.entity];
      if (entityObj && entityObj.attributes) {
        if (entityObj.attributes.daylist) {
          this.dayData = entityObj.attributes.daylist;
        } else {
          this.dayData = [];
        }
        if (entityObj.attributes.monthlist) {
          const monthStr = `${this.year}-${this.month.toString().padStart(2, '0')}`;
          this.monthData = entityObj.attributes.monthlist.find(item => item.month === monthStr);
        } else {
          this.monthData = null;
        }
      } else {
        this.dayData = [];
        this.monthData = null;
      }
    }
  }

  getDayData(year, month, day) {
    if (!this.dayData || this.dayData.length === 0) return null;
    const dateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    return this.dayData.find(item => item.day === dateStr);
  }

  getMinMaxUsageDays() {
    if (!this.dayData || this.dayData.length === 0) return { minDays: [], maxDays: [] };
    const monthStr = `${this.year}-${this.month.toString().padStart(2, '0')}`;
    const monthDays = this.dayData.filter(item => item.day.startsWith(monthStr));
    if (monthDays.length === 0) return { minDays: [], maxDays: [] };
    const validDays = monthDays.filter(day => day.dayEleNum !== undefined && day.dayEleNum !== null);
    if (validDays.length === 0) return { minDays: [], maxDays: [] };
    const minUsage = Math.min(...validDays.map(day => parseFloat(day.dayEleNum)));
    const maxUsage = Math.max(...validDays.map(day => parseFloat(day.dayEleNum)));
    const minDays = validDays
        .filter(day => parseFloat(day.dayEleNum) === minUsage)
        .map(day => parseInt(day.day.split('-')[2], 10).toString());
    const maxDays = validDays
        .filter(day => parseFloat(day.dayEleNum) === maxUsage)
        .map(day => parseInt(day.day.split('-')[2], 10).toString());
    return { minDays, maxDays };
  }

  set hass(value) {
    this._hass = value;
    this.updateDayData();
    this.requestUpdate();
  }

  get hass() {
    return this._hass;
  }

  render() {
    this.updateDayData();
    const theme = this._evaluateTheme();
    const bgColor = theme === 'on' ? 'rgb(255, 255, 255)' : 'rgb(50, 50, 50)';
    const fgColor = theme === 'on' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
    const daysInMonth = this.getDaysInMonth(this.year, this.month);
    const firstDayOfMonth = new Date(this.year, this.month - 1, 1).getDay();
    const adjustedFirstDay = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;
    const { minDays, maxDays } = this.getMinMaxUsageDays();
    const days = [];
    const weekdayNames = ['一', '二', '三', '四', '五', '六', '日'];
    const yearMonthRow = html` 
      <div class="celltotal nav-button ${this.activeNav === 'yearlast' ? 'active-nav' : ''}" 
           style="grid-area: yearlast;" 
           @click=${this.prevYear}
           @mousedown=${() => this.activeNav = 'yearlast'}
           @mouseup=${() => this.activeNav = ''}
           @mouseleave=${() => this.activeNav = ''}>◀</div>
      <div class="celltotal"
           style="grid-area: year;">${this.year+"年"}</div>
      <div class="celltotal nav-button ${this.activeNav === 'yearnext' ? 'active-nav' : ''}" 
           style="grid-area: yearnext;" 
           @click=${this.nextYear}
           @mousedown=${() => this.activeNav = 'yearnext'}
           @mouseup=${() => this.activeNav = ''}
           @mouseleave=${() => this.activeNav = ''}>▶</div>
      <div class="celltotal today-button"
           style="grid-area: today;" 
           @click=${this.goToToday}>当月</div>
      <div class="celltotal nav-button ${this.activeNav === 'monthlast' ? 'active-nav' : ''}" 
           style="grid-area: monthlast;" 
           @click=${this.prevMonth}
           @mousedown=${() => this.activeNav = 'monthlast'}
           @mouseup=${() => this.activeNav = ''}
           @mouseleave=${() => this.activeNav = ''}>◀</div>
      <div class="celltotal" 
           style="grid-area: month;">${this.month+"月"}</div>
      <div class="celltotal nav-button ${this.activeNav === 'monthnext' ? 'active-nav' : ''}" 
           style="grid-area: monthnext;" 
           @click=${this.nextMonth}
           @mousedown=${() => this.activeNav = 'monthnext'}
           @mouseup=${() => this.activeNav = ''}
           @mouseleave=${() => this.activeNav = ''}>▶</div>
    `;
    const weekdaysRow = weekdayNames.map((day, index) => 
      html`<div class="celltotal weekday" style="grid-area: week${index + 1};">${day}</div>`
    );
    for (let i = 0; i < adjustedFirstDay; i++) {
      if (i==adjustedFirstDay-1){
        days.push(html`<div class="cell month-cell-bottom month-cell-right" style="grid-area: id${i + 1};"></div>`);
      }
      else{
        days.push(html`<div class="cell month-cell-bottom" style="grid-area: id${i + 1};"></div>`);
      }
    }
    for (let i = 1; i <= daysInMonth; i++) {
      const dayData = this.getDayData(this.year, this.month, i);
      const isMinDay = minDays.includes(i.toString());
      const isMaxDay = maxDays.includes(i.toString());
      const dayClass = isMinDay ? 'min-usage' : isMaxDay ? 'max-usage' : '';
      const dayContent = html`
        <div>${i}</div>
        ${dayData ? html`
          <div class="electricity-num" style="color: ${this.colorNum}">${dayData.dayEleNum}°</div>
          <div class="electricity-cost" style="color: ${this.colorCost}">${dayData.dayEleCost}元</div>
        ` : ''}
      `;
      if(adjustedFirstDay>0 && i>=1 && i<=7-adjustedFirstDay){
        days.push(html`
        <div class="cell month-cell month-cell-top month-day ${dayClass}" 
          style="grid-area: id${i + adjustedFirstDay};">
          ${dayContent}
        </div>
        `);
      }
      else if(adjustedFirstDay==0 && i==1){
        days.push(html`
        <div class="cell month-cell month-cell-top month-cell-left month-day ${dayClass}"\nstyle="grid-area: id${i + adjustedFirstDay};">
          ${dayContent}
        </div>
        `);
      }
      else if(adjustedFirstDay==0 && i>1 && i<=7-adjustedFirstDay){
        days.push(html`
        <div class="cell month-cell month-cell-top month-day ${dayClass}" style="grid-area: id${i + adjustedFirstDay};">
          ${dayContent}
        </div>
        `);
      }
      else if(i==8-adjustedFirstDay || i==15-adjustedFirstDay || i==22-adjustedFirstDay || i==29-adjustedFirstDay || i==36-adjustedFirstDay){
        days.push(html`
        <div class="cell month-cell month-cell-left month-day ${dayClass}" style="grid-area: id${i + adjustedFirstDay};">
          ${dayContent}
        </div>
        `);
      }
      else{
        days.push(html`
        <div class="cell month-cell month-day ${dayClass}" style="grid-area: id${i + adjustedFirstDay};">
          ${dayContent}
        </div>
        `);
      }
    }
    const totalCells = 37;
    for (let i = daysInMonth + adjustedFirstDay + 1; i <= totalCells; i++) {
      days.push(html`<div class="cell" style="grid-area: id${i};"></div>`);
    }
    const bottomRow = html`
      <div class="cell" style="grid-area: id98;"></div>
      <div class="cell summary-info" style="grid-area: id99;">
        ${this.monthData ? html`
          <div><span  style="color: ${this.colorNum}">月电量: ${this.monthData.monthEleNum}度</span></div>
          <div><span  style="color: ${this.colorCost}">月电费: ${this.monthData.monthEleCost}元</span></div>
        ` : html`<div></div>`}
      </div>
    `;
    return html`
      <div class="calendar-grid" \n
           style="width: ${this.width}; height: ${this.height}; background-color: ${bgColor}; color: ${fgColor}; ">
        ${yearMonthRow}
        ${weekdaysRow}
        ${days}
        ${bottomRow}
      </div>
    `;
  }
  
   _handleClick() {
     navigator.vibrate(50);
  }
  
  _evaluateTheme() {
    try {
      if (!this.config || !this.config.theme) return 'on';
      if (typeof this.config.theme === 'function') {
        return this.config.theme();
      }
      if (typeof this.config.theme === 'string' && 
          (this.config.theme.includes('return') || this.config.theme.includes('=>'))) {
        return (new Function(`return ${this.config.theme}`))();
      }
      return this.config.theme;
    } catch(e) {
      console.error('计算主题时出错:', e);
      return 'on';
    }
  }

  getDaysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  prevYear() {
    this.year--;
    this.updateDayData();
    this.requestUpdate();
    this._handleClick();
  }

  nextYear() {
    this.year++;
    this.updateDayData();
    this.requestUpdate();
    this._handleClick();
  }

  prevMonth() {
    if (this.month === 1) {
      this.month = 12;
      this.year--;
    } else {
      this.month--;
    }
    this.updateDayData();
    this.requestUpdate();
    this._handleClick();
  }

  nextMonth() {
    if (this.month === 12) {
      this.month = 1;
      this.year++;
    } else {
      this.month++;
    }
    this.updateDayData();
    this.requestUpdate();
    this._handleClick();
  }

  goToToday() {
    const today = new Date();
    this.year = today.getFullYear();
    this.month = today.getMonth() + 1;
    this.updateDayData();
    this.requestUpdate();
    this._handleClick();
  }
}
customElements.define('xiaoshi-state-grid-calendar', StateGridCalendar);

class StateGridChartDay extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      entity: { type: String },
      width: { type: String, attribute: true },
      height: { type: String, attribute: true },
      colorNum: { type: String, attribute: true },
      colorCost: { type: String, attribute: true },
      theme: { type: String },
      config: { type: Object }
    };
  } 

  setConfig(config) {
    this.config = config;
    if (config) {
      if (config.width !== undefined) this.width = config.width;
      if (config.height !== undefined) this.height = config.height;
      if (config.entity !== undefined) {
        const oldEntity = this.entity;
        this.entity = config.entity;
        // 如果entity发生变化，重新加载数据
        if (oldEntity !== this.entity && this.hass) {
          this._loadData();
        }
      }
      if (config.color_num !== undefined) this.colorNum = config.color_num;
      if (config.color_cost !== undefined) this.colorCost = config.color_cost;
      this.requestUpdate();
    }
  }

  constructor() {
    super(); 
    this.width = '380px';
    this.height = '300px';
    this.theme = 'on';
    this.entity = 'sensor.state_grid';
    this.colorNum = '#0fccc3';
    this.colorCost = '#804aff';
    this.config = {};
  }

  static get styles() {
    return css`
      :host {
        display: block;
      }
      .card {
        border: 0;
        border-radius: 10px;
        display: grid;
        grid-template-rows: 20% 80%;
        grid-template-columns: 1fr 1fr;
        grid-template-areas: 
          "label1 label2"
          "chart chart";
        gap: 0px;
        padding: 2px;
        margin: 0px;
      }
      .label {
        padding: 5px;
      }
      .label1 {
        grid-area: label1;
        text-align: left;
      }
      .label2 {
        grid-area: label2;
        text-align: right;
      } 
      .value {
        font-size: 25px;
        font-weight: bold;
        line-height: 1.2;
        padding: 5px 5px 0 5px;
      }
      .unit {
        font-size: 15px;
      }
      .title {
        font-size: 13px;
        padding: 0 5px 0 5px;
      }
      #chart-container {
        grid-area: chart;
        height: 100%;
        width: 100%;
      }
      .apexcharts-legend {
        padding: 0px;
      }
    `;
  }

  async firstUpdated() { 
    await this._loadApexCharts();
    this._renderChart();
  }

  async _loadApexCharts() {
    if (!window.ApexCharts) {
      await new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/apexcharts';
        script.onload = resolve;
        document.head.appendChild(script);
      });
    }
  }

  _loadData() {
    // 重新渲染图表，数据会在_renderChart中通过_processedData获取
    this._renderChart();
  }

  get _processedData() {
    const entity = this.hass.states[this.entity];
    if (!entity?.attributes?.daylist) return null; 
    const daylist = entity.attributes.daylist.slice(0, 30);
    const currentDay = daylist[0] || {};
    return {
      electricity: daylist.map(item => ({
        x: new Date(item.day.split(' ')[0]).getTime(),
        y: Number(item.dayEleNum) || 0
      })),
      cost: daylist.map(item => ({
        x: new Date(item.day.split(' ')[0]).getTime(),
        y: Number(item.dayEleCost) || 0
      })),
      current: {
        ele: currentDay.dayEleNum || 0,
        cost: currentDay.dayEleCost || 0,
        days: daylist.length
      }
    };
  }

  _renderChart() {
    const container = this.renderRoot.querySelector('#chart-container');
    if (!container) return;
    const data = this._processedData;
    if (!data) {
      if (this._chart) {
        this._chart.destroy();
        this._chart = null;
      }
      return;
    }
    container.innerHTML = '';
    if (this._chart) {
      this._chart.destroy();
      this._chart = null;
    }
    this._chart = new ApexCharts(container, this._getChartConfig(data));
    this._chart.render();
  }

  _evaluateTheme() {
    try {
      if (!this.config || !this.config.theme) return 'on';
      if (typeof this.config.theme === 'function') {
        return this.config.theme();
      }
      if (typeof this.config.theme === 'string' && 
          (this.config.theme.includes('return') || this.config.theme.includes('=>'))) {
        return (new Function(`return ${this.config.theme}`))();
      }
      return this.config.theme;
    } catch(e) {
      console.error('计算主题时出错:', e);
      return 'on';
    }
  }

  _getChartConfig(data) {
    const theme = this._evaluateTheme();
    const Color = theme === 'on' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
    const BgColor = theme === 'on' ? 'rgb(255, 255, 255)' : 'rgb(50, 50, 50)';
    const maxElectricity = Math.max(...data.electricity.map(item => item.y));
    const minElectricity  = Math.min(...data.electricity.map(item => item.y));
    const maxCost = Math.max(...data.cost.map(item => item.y));
    const maxElectricityPoint  = data.electricity.find(item => item.y === maxElectricity);
    const maxCostPoint  = data.cost.find(item => item.y === maxCost);
    const colorCost = this.colorCost;
    const colorNum = this.colorNum;
    const colorMax = tinycolor(colorNum).spin(20).toHexString();
    const colorMin = tinycolor(colorNum).spin(-20).toHexString();
    return {
      series: [
        {
          name: `日用电量`,
          data: data.electricity,
          type: 'column',
          zIndex: 0
        },
        {
          name: `日用电金额`,
          data: data.cost,
          type: 'line',
          color: colorCost,
          zIndex: 1
        }
      ],      
      markers: {
        size: 3,
        strokeWidth: 1,
        colors: colorCost,
        strokeColors: "#fff"
      },
      chart: {
        type: 'line',
        height: 235,
        foreColor: Color,
        toolbar: { show: false },
        animations: {
          enabled: true,
          dynamicAnimation: {
            enabled: false
          }
        }
      },
      colors: [
        function({value}) {
          if (value < (3 * minElectricity + maxElectricity) / 4) {
            return colorMin;
          }
          if (value < (minElectricity + 3 * maxElectricity) / 4) {
            return colorNum;
          } 
          else {
            return colorMax;
          }
        }, 
        colorCost
      ],
      stroke: { width: [0, 2], curve: 'smooth' },
      xaxis: {
        type: 'datetime',
        labels: {
          datetimeFormatter: {
            day: 'MM-dd',
            month: 'MM-dd',
            year: 'MM-dd'
          },
          style: {
            fontSize: '10px',
          },
          hideOverlappingLabels: true
        },
        tooltip: { 
          enabled: false
        } 
      },
      yaxis: {
        min: 0,
        labels: {
          formatter: function(val, index) {
            return val.toFixed(0);
          }
        }
      },
      grid: {
        show: true,
        position: 'back',
        xaxis: {
            lines: {
                show: false
            }
        },   
        yaxis: {
            lines: {
                show: false
            }
        },  
        row: {
            colors: [Color, 'transparent'], 
            opacity: 0.1
        },
      },
      annotations: {
        points: [
          {
            x: maxElectricityPoint.x,
            y: maxElectricityPoint.y,
            seriesIndex: 0,
            marker: {
              size: 0
            },
            label: {
              borderColor: '#ffffff00', 
              offsetY: -5,
              offsetX: 0,
              style: {
                color: Color,
                background: '#ffffff00', 
                fontSize: '12px',
                fontWeight: 'bold'
              },
              text: `${maxElectricity.toFixed(2)}度`
            }
          },
          {
            x: maxElectricityPoint.x,
            y: maxElectricityPoint.y,
            seriesIndex: 0,
            marker: {
              size: 4,
              offsetX: 0, 
              fillColor: '#fff',
              strokeColor: colorNum,
              strokeWidth: 1,
              shape: "circle",
            },
            label: {
              borderColor: '#fff', 
              offsetY: 0,
              offsetX: 0,
              style: {
                color: '#fff',
                fontSize: '12px',
                fontWeight: 'bold'
              },
              text: ' '
            }
          },
          {
            x: maxCostPoint.x,
            y: maxCostPoint.y,
            seriesIndex: 1,
            marker: {
              size: 0,
              strokeColor: colorNum,
            },
            label: {
              borderColor: '#ffffff00', 
              offsetY: -5,
              offsetX: 0, 
              style: {
                color: Color,
                background: '#ffffff00', 
                fontSize: '12px',
                fontWeight: 'bold'
              },
              text: `${maxCost.toFixed(2)}元`
            }
          }
        ] 
      },
      tooltip: {
        shared: true,
        intersect: false,
        custom: function({ series, seriesIndex, dataPointIndex, w }) {
          const firstDate0 = new Date(w.globals.labels[0]);
          const firstDate = new Date(firstDate0);
          firstDate.setDate(firstDate.getDate() + 29);
          const currentDate = new Date(firstDate);  
          currentDate.setDate(firstDate.getDate() - dataPointIndex);
          const formattedDate = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
          const seriesInfo = [
            { name: '日电量', unit: '度', color: this.colorNum },
            { name: '日电费', unit: '元', color: this.colorCost }
          ];
          let tooltipHTML = `
            <div style="background: ${BgColor};color: ${Color};padding: 8px;border-radius: 4px;border: 1px solid ${Color};">
              <div style="font-weight: bold; font-size: 12px;color: ${Color};  border-bottom: 1px dashed #999;">
                ${formattedDate}
              </div>
          `;
          series.forEach((_, idx) => {
            const value = series[idx][dataPointIndex];
            if (value !== null && value !== undefined) {
              tooltipHTML += `
                <div style="display: flex;align-items: center;margin: 0;font-size: 12px;border-bottom: 1px dashed #999;">
                  <span style="display: inline-block;width: 8px;height: 8px;background: ${seriesInfo[idx].color};border-radius: 50%;margin-right: 5px;"></span>
                  <span style="color: ${seriesInfo[idx].color}">
                    ${seriesInfo[idx].name}: 
                    <strong>${value.toFixed(2)} ${seriesInfo[idx].unit}</strong>
                  </span>
                </div>
              `;
            }
          });
          tooltipHTML += `</div>`;
          return tooltipHTML;
        }.bind(this)
      },
      legend: {
        position: 'bottom',
        formatter: function(seriesName) {
          return seriesName;
        },
        markers: {
          width: 10,
          height: 10,
          radius: 5
        },
        itemMargin: {
          horizontal: 10
        }
      }
    };
  }

  render() {
    const data = this._processedData;
    const theme = this._evaluateTheme();
    const backgColor = theme === 'on' ? 'rgb(255, 255, 255)' : 'rgb(50, 50, 50)';
    const textColor = theme === 'on' ? 'rgba(0, 0, 0, 0.7)' : 'rgba(255, 255, 255, 0.7)';
    return html`
      <ha-card class="card"\n
               style="width: ${this.width};height: ${this.height};background: ${backgColor};">
        <div class="label label1">
          <div class="value"\n
               style="color: ${this.colorNum}">${data ? data.current.ele.toFixed(2) : '0.00'}
               <span class="unit"\n
                     style="color: ${textColor}">度</span></div>
          <div class="title"\n
               style="color: ${textColor}">日用电量</div>
        </div>
        <div class="label label2">
          <div class="value"\n
               style="color: ${this.colorCost}">${data ? data.current.cost.toFixed(2) : '0.00'}
               <span class="unit"\n
                     style="color: ${textColor}">元</span></div>
          <div class="title"\n
               style="color: ${textColor}">日用电金额</div>
        </div>
        <div id="chart-container"></div>
      </ha-card>
    `;
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    
    // 只在entity变化时重新渲染图表，避免频繁刷新
    if (changedProperties.has('entity')) {
      console.log('StateGridChartDay: entity changed, re-rendering chart');
      // 延迟执行图表重渲染，确保DOM已更新
      setTimeout(() => {
        this._renderChart();
      }, 0);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._chart) {
      this._chart.destroy();
      this._chart = null;
    }
  }
}
customElements.define('xiaoshi-state-grid-chart-day', StateGridChartDay);

class StateGridChartMonth extends LitElement {
  static get properties() { 
    return {
      hass: { type: Object },
      entity: { type: String },
      width: { type: String, attribute: true },
      height: { type: String, attribute: true },
      colorNum: { type: String, attribute: true },
      colorCost: { type: String, attribute: true },
      theme: { type: String },
      config: { type: Object }
    };
  }  
 
  setConfig(config) {
    this.config = config;
    if (config) {
      if (config.width !== undefined) this.width = config.width;
      if (config.height !== undefined) this.height = config.height;
      if (config.entity !== undefined) {
        const oldEntity = this.entity;
        this.entity = config.entity;
        // 如果entity发生变化，重新加载数据
        if (oldEntity !== this.entity && this.hass) {
          this._loadData();
        }
      }
      if (config.color_num !== undefined) this.colorNum = config.color_num;
      if (config.color_cost !== undefined) this.colorCost = config.color_cost;
      this.requestUpdate();
    }
  }

  constructor() {
    super();
    this.width = '380px';
    this.height = '300px';
    this.theme = 'on';
    this.entity = 'sensor.state_grid';
    this.colorNum = '#0fccc3';
    this.colorCost = '#804aff'; 
    this.config = {};
  }

  static get styles() {
    return css`
      :host {
        display: block;
      }
      .card {
        border: 0;
        border-radius: 10px;
        display: grid;
        grid-template-rows: 20% 80%;
        grid-template-columns: 1fr 1fr;
        grid-template-areas: 
          "label1 label2"
          "chart chart";
        gap: 0px;
        padding: 2px;
        margin: 0px;
      }
      .label {
        padding: 5px;
      }
      .label1 {
        grid-area: label1;
        text-align: left;
      }
      .label2 {
        grid-area: label2;
        text-align: right;
      }
      .value {
        font-size: 25px;
        font-weight: bold;
        line-height: 1.2;
        padding: 5px 5px 0 5px;
      }
      .unit {
        font-size: 15px;
      }
      .title {
        font-size: 13px;
        padding: 0 5px 0 5px;
      }
      #chart-container {
        grid-area: chart;
        height: 100%;
        width: 100%;
      }
      .apexcharts-legend {
        padding: 0px;
      }
    `;
  }
 
  async firstUpdated() { 
    await this._loadApexCharts();
    this._renderChart();
  }

  async _loadApexCharts() {
    if (!window.ApexCharts) {
      await new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/apexcharts';
        script.onload = resolve;
        document.head.appendChild(script);
      });
    }
  }

  _loadData() {
    // 重新渲染图表，数据会在_renderChart中通过_processedData获取
    this._renderChart();
  }

  get _processedData() {
    const lastYear  = (new Date().getFullYear() - 1).toString();
    const currentYear = new Date().getFullYear().toString();
    const entity = this.hass.states[this.entity];
    if (!entity?.attributes?.monthlist) return null;
    // 确保数据安全，处理可能为空的情况
    const lastYearBills = entity.attributes.monthlist.filter(item => 
      item?.month && item.month.startsWith(lastYear)
    ) || [];
    const thisYearBills = entity.attributes.monthlist.filter(item => 
      item?.month && item.month.startsWith(currentYear)
    ) || [];
    const lastmonthlist = [...lastYearBills ].slice(0, 12).reverse();
    const monthlist = [...thisYearBills].slice(0, 12).reverse();
    const lastmonthlistDay = [...lastYearBills ][0];
    const monthlistDay = [...thisYearBills][0];
    return {
      electricity: monthlist.map(item => ({
        x: new Date(item.month.substr(0,7)+'-01').getTime(),
        y: Number(item.monthEleNum) || 0
      })),
      cost: monthlist.map(item => ({
        x: new Date(item.month.substr(0,7)+'-01').getTime(),
        y: Number(item.monthEleCost) || 0
      })),
      current: {
        ele: monthlistDay?.monthEleNum || 0,
        cost: monthlistDay?.monthEleCost || 0,
        days: monthlist.length
      },
      lastelectricity: lastmonthlist.map(item => ({
        x: new Date(`${currentYear}-${item.month.split("-")[1]}-01`).getTime(),
        y: Number(item.monthEleNum) || 0
      })),
      lastcost: lastmonthlist.map(item => ({
        x: new Date(`${currentYear}-${item.month.split("-")[1]}-01`).getTime(),
        y: Number(item.monthEleCost) || 0
      })),
      lastcurrent: {
        ele: lastmonthlistDay?.monthEleNum || 0,
        cost: lastmonthlistDay?.monthEleCost || 0,
        days: lastmonthlist.length
      }
    };
  }

  _renderChart() {
    const container = this.renderRoot.querySelector('#chart-container');
    if (!container) return;
    const data = this._processedData;
    if (!data) {
      if (this._chart) {
        this._chart.destroy();
        this._chart = null;
      }
      return;
    }
    container.innerHTML = '';
    if (this._chart) {
      this._chart.destroy();
      this._chart = null;
    }
    this._chart = new ApexCharts(container, this._getChartConfig(data));
    this._chart.render();
  }

  _evaluateTheme() {
    try {
      if (!this.config || !this.config.theme) return 'on';
      if (typeof this.config.theme === 'function') {
        return this.config.theme();
      }
      if (typeof this.config.theme === 'string' && 
          (this.config.theme.includes('return') || this.config.theme.includes('=>'))) {
        return (new Function(`return ${this.config.theme}`))();
      }
      return this.config.theme;
    } catch(e) {
      console.error('计算主题时出错:', e);
      return 'on';
    }
  }

  _getChartConfig(data) {
    const theme = this._evaluateTheme();
    const Color = theme === 'on' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
    const BgColor = theme === 'on' ? 'rgb(255, 255, 255)' : 'rgb(50, 50, 50)';
    const maxElectricity = Math.max(...data.electricity.map(item => item.y));
    const minElectricity  = Math.min(...data.electricity.map(item => item.y));
    const maxCost = Math.max(...data.cost.map(item => item.y));
    const maxElectricityPoint  = data.electricity.find(item => item.y === maxElectricity);
    const maxCostPoint  = data.cost.find(item => item.y === maxCost);
    const colorCost = this.colorCost;
    const colorNum = this.colorNum;
    const colorMax = tinycolor(colorNum).spin(20).toHexString();
    const colorMin = tinycolor(colorNum).spin(-20).toHexString();
    return {
      series: [
        {
          name: `上年电量`,
          data: data.lastelectricity,
          type: 'column',
          zIndex: 0,
          color: "#f8500080"
        },
        {
          name: `本年电量`,
          data: data.electricity,
          type: 'column',
          zIndex: 1,
        },
        {
          name: `上年金额`,
          data: data.lastcost,
          type: 'line',
          color: "#f30660",
          zIndex: 2
        },
        {
          name: `本年金额`,
          data: data.cost,
          type: 'line',
          color: colorCost,
          zIndex: 3
        }
      ],      
      markers: {
        size: 3,
        strokeWidth: 1,
        colors: ["#f30660",colorCost],
        strokeColors: "#fff"
      },
      chart: {
        type: 'line',
        height: 235,
        foreColor: Color,
        toolbar: { show: false },
        animations: {
          enabled: true,
          dynamicAnimation: { 
            enabled: false
          }
        }
      },
      colors: [
        function({value}) {
          if (value < (3 * minElectricity + maxElectricity) / 4) {
            return colorMin;
          }
          if (value < (minElectricity + 3 * maxElectricity) / 4) {
            return colorNum;
          } 
          else {
            return colorMax;
          }
        }
      ],
      stroke: { width: [0,0,2,2], curve: 'smooth' },
      xaxis: {
        type: 'datetime',
        labels: {
          datetimeFormatter: {
            day: 'M月',
            month: 'M月',
            year: 'M月'
          },
          style: {
            fontSize: '10px',
          },
          hideOverlappingLabels: false
        },
        tooltip: { 
          enabled: false
        }
      },
      yaxis: {
        min: 0,
        labels: {
          formatter: function(val, index) {
            return val.toFixed(0);
          }
        }
      },
      grid: {
        show: true,
        position: 'back',
        xaxis: {
            lines: {
                show: false
            }
        },   
        yaxis: {
            lines: {
                show: false
            }
        },  
        row: {
            colors: [Color, 'transparent'], 
            opacity: 0.1
        },
      },
      annotations: {
        points: [
          {
            x: maxElectricityPoint.x,
            y: maxElectricityPoint.y,
            seriesIndex: 1,
            marker: {
              size: 0
            },
            label: {
              borderColor: '#ffffff00', 
              offsetY: -5,
              offsetX: 0,
              style: {
                color: Color,
                background: '#ffffff00', 
                fontSize: '12px',
                fontWeight: 'bold'
              },
              text: `${maxElectricity.toFixed(2)}度`
            }
          },
          {
            x: maxElectricityPoint.x,
            y: maxElectricityPoint.y,
            seriesIndex: 1,
            marker: {
              size: 4,
              offsetX: 0, 
              fillColor: '#fff',
              strokeColor: colorNum,
              strokeWidth: 1,
              shape: "circle",
            },
            label: {
              offsetY: 0,
              offsetX: 0,
              style: {
                color: Color,
                fontSize: '12px',
                fontWeight: 'bold'
              },
              text: ' '
            } 
          },
          {
            x: maxCostPoint.x,
            y: maxCostPoint.y,
            seriesIndex: 3,
            marker: {
              size: 0,
              strokeColor: colorNum,
            },
            label: {
              borderColor: '#ffffff00', 
              offsetY: -5,
              offsetX: 0, 
              style: {
                color: Color,
                background: '#ffffff00', 
                fontSize: '12px',
                fontWeight: 'bold'
              },
              text: `${maxCost.toFixed(2)}元`
            }
          }
        ]
      },
      tooltip: {
        shared: true,
        intersect: false,
        custom: function({ series, seriesIndex, dataPointIndex, w }) {
          const date = new Date(w.globals.labels[0]);
          const formattedDate = new Date(date);
          formattedDate.setMonth(date.getMonth() + dataPointIndex);
          
          const displayDate = `${formattedDate.getFullYear()}-${String(formattedDate.getMonth() + 1).padStart(2, '0')}`;
          const seriesInfo = [
            { name: '上年电量', unit: '度', color: "#f85000" },
            { name: '本年电量', unit: '度', color: this.colorNum },
            { name: '上年电费', unit: '元', color: "#f30660" },
            { name: '本年电费', unit: '元', color: this.colorCost }
          ];
          let tooltipHTML = `
            <div style="background: ${BgColor};color: ${Color};padding: 8px;border-radius: 4px;border: 1px solid ${Color};">
              <div style="font-weight: bold; font-size: 12px;color: ${Color};  border-bottom: 1px dashed #999;">
                ${displayDate }
              </div>
          `;
          series.forEach((_, idx) => {
            const value = series[idx][dataPointIndex];
            if (value !== null && value !== undefined) {
              tooltipHTML += `
                <div style="display: flex; align-items: center;margin: 0;font-size: 12px;border-bottom: 1px dashed #999;">
                  <span style="display: inline-block;width: 8px;height: 8px;background: ${seriesInfo[idx].color};border-radius: 50%;margin-right: 5px;"></span>
                  <span style="color: ${seriesInfo[idx].color}">
                    ${seriesInfo[idx].name}: 
                    <strong>${value.toFixed(2)} ${seriesInfo[idx].unit}</strong>
                  </span>
                </div>
              `;
            }
          });
          tooltipHTML += `</div>`;
          return tooltipHTML;
        }.bind(this)
      },

      legend: {
        position: 'bottom',
        formatter: function(seriesName) {
          return seriesName;
        },
        markers: {
          width: 10,
          height: 10,
          radius: 5
        },
        itemMargin: {
          horizontal: 10
        }
      }
    };
  }

  render() {
    const data = this._processedData;
    const theme = this._evaluateTheme();
    const backgColor = theme === 'on' ? 'rgb(255, 255, 255)' : 'rgb(50, 50, 50)';
    const textColor = theme === 'on' ? 'rgba(0, 0, 0, 0.7)' : 'rgba(255, 255, 255, 0.7)';
    return html`
      <ha-card class="card"\n
               style="width: ${this.width};height: ${this.height};background: ${backgColor};">
        <div class="label label1">
          <div class="value"\n
               style="color: ${this.colorNum}">${data ? data.current.ele.toFixed(2) : '0.00'}
          <span class="unit"\n
                style="color: ${textColor}">度</span></div>
          <div class="title"\n
               style="color: ${textColor}">月用电量</div>
        </div>
        <div class="label label2">
          <div class="value"\n
               style="color: ${this.colorCost}">${data ? data.current.cost.toFixed(2) : '0.00'}
          <span class="unit"\n
                style="color: ${textColor}">元</span></div>
          <div class="title"\n
               style="color: ${textColor}">月用电金额</div>
        </div>
        <div id="chart-container"></div>
      </ha-card>
    `;
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    
    // 只在entity变化时重新渲染图表，避免频繁刷新
    if (changedProperties.has('entity')) {
      console.log('StateGridChartMonth: entity changed, re-rendering chart');
      // 延迟执行图表重渲染，确保DOM已更新
      setTimeout(() => {
        this._renderChart();
      }, 0);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback(); 
    if (this._chart) {
      this._chart.destroy();
      this._chart = null;
    }
  }
} 
customElements.define('xiaoshi-state-grid-chart-month', StateGridChartMonth);

class StateGridPhoneEditor extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object },
      _buttonSearchTerm: { type: String },
      _filteredButtons: { type: Array },
      _showButtonList: { type: Boolean },
      _balanceSearchTerm: { type: String },
      _filteredBalanceEntities: { type: Array },
      _showBalanceEntityList: { type: Boolean }
    };
  }

  static get styles() {
    return css`
      .form {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 16px;
      }
      .form-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      label {
        font-weight: bold;
        font-size: 14px;
        color: var(--primary-text-color);
      }
      select, input {
        padding: 6px 12px;
        border: 1px solid var(--primary-color);
        border-radius: 4px;
        background: var(--card-background-color);
        color: var(--primary-text-color);
        font-size: 14px;
      }
      .help-text {
        font-size: 12px;
        color: var(--secondary-text-color);
        margin-top: 4px;
      }
      .color-input-wrapper {
        display: flex;
        gap: 3px;
        align-items: center;
      }
      .color-input {
        width: 70px;
        height: 36px;
        border: 1px solid var(--primary-color);
        border-radius: 4px;
        cursor: pointer;
      }
      .color-text {
        flex: 1;
        height: 22px;
      }
      .entity-selector {
        position: relative;
      }
      .entity-search-input {
        width: 70%;
        padding: 6px 12px;
        border: 1px solid var(--primary-color);
        border-radius: 4px;
        background: var(--card-background-color);
        color: var(--primary-text-color);
        box-sizing: border-box;
      }
      .entity-dropdown {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        height: 200px;
        overflow-y: auto;
        background: var(--card-background-color);
        border: 1px solid var(--primary-color);
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        z-index: 1000;
        margin-top: 4px;
      }
      .entity-option {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 2px 12px;
        cursor: pointer;
        border-bottom: 1px solid var(--divider-color);
      }
      .entity-option:hover {
        background: var(--secondary-background-color);
      }
      .entity-option.selected {
        background: var(--primary-color);
        color: var(--text-primary-color);
      }
      .entity-info {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 1;
      }
      .entity-details {
        flex: 1;
      }
      .entity-name {
        font-weight: 500;
        font-size: 14px;
      }
      .entity-id {
        font-size: 12px;
        opacity: 0.7;
        font-family: monospace;
      }
      .check-icon {
        color: var(--success-color);
      }
      .no-results {
        padding: 6px;
        text-align: center;
        color: var(--secondary-text-color);
        font-style: italic;
      }
      .checkbox-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .checkbox-label {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        cursor: pointer;
        color: var(--primary-text-color);
        margin: 0 24px;
      }
      .checkbox-icon {
        margin: 0;
      }

      .checkbox-label input[type="checkbox"] {
        width: auto;
        padding: 0;
      }

      /* 余额实体选择器样式 */
      .balance-entity-section {
        border-top: 1px solid var(--divider-color);
        padding-top: 16px;
        margin-top: 16px;
      }

      .balance-entity-search {
        width: 100%;
        padding: 6px 12px;
        border: 1px solid var(--primary-color);
        border-radius: 4px;
        background: var(--card-background-color);
        color: var(--primary-text-color);
        box-sizing: border-box;
        margin-bottom: 8px;
      }

      .selected-balance-entities {
        margin-top: 12px;
      }

      .selected-balance-label {
        font-size: 14px;
        font-weight: bold;
        margin-bottom: 8px;
        color: var(--primary-text-color);
      }

      .selected-balance-entity {
        margin-bottom: 12px;
        border: 1px solid var(--divider-color);
        border-radius: 4px;
        padding: 8px;
        background: var(--card-background-color);
      }

      .balance-entity-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
        font-size: 12px;
        color: var(--primary-text-color);
      }

      .balance-entity-info {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 1;
      }

      .balance-entity-name {
        font-weight: 500;
      }

      .balance-entity-id {
        opacity: 0.7;
        font-family: monospace;
      }

      .remove-balance-btn {
        background: none;
        border: none;
        cursor: pointer;
        padding: 2px;
        color: var(--secondary-text-color);
      }

      .remove-balance-btn:hover {
        color: var(--error-color);
      }

      .balance-entity-overrides {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 8px;
      }

      .override-config {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-top: 2px;
      }

      .override-checkbox {
        margin-right: 4px;
      }

      .override-row {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .override-row label {
        font-size: 12px;
        font-weight: normal;
        min-width: 60px;
        margin: 0;
      }

      .override-row input {
        flex: 1;
        padding: 4px 8px;
        font-size: 12px;
      }

      .override-label {
        font-size: 11px;
        color: #666;
        white-space: nowrap;
      }

      .override-input {
        flex: 1;
        padding: 2px 6px;
        border: 1px solid #ddd;
        border-radius: 3px;
        font-size: 11px;
        box-sizing: border-box;
      }

      .balance-name-input {
        width: 100%;
        padding: 6px 12px;
        border: 1px solid var(--primary-color);
        border-radius: 4px;
        background: var(--card-background-color);
        color: var(--primary-text-color);
        box-sizing: border-box;
        margin-bottom: 8px;
      }
    `;
  }

  render() {
    if (!this.hass) return html``;

    return html`
      <div class="form">
        <div class="form-group">
          <label class="entity-selector">
            青龙脚本刷新实体：
            <input 
              type="text" 
              @input=${this._onButtonSearch}
              @focus=${this._onButtonSearch}
              .value=${this._buttonSearchTerm || this.config.button }
              placeholder="搜索或输入按钮实体ID..."
              class="entity-search-input"
            /></label>
            ${this._showButtonList ? html`
              <div class="entity-dropdown">
                ${this._filteredButtons.map(entity => html`
                  <div 
                    class="entity-option ${this.config.button === entity.entity_id ? 'selected' : ''}"
                    @click=${() => this._selectButton(entity.entity_id)}
                  >
                    <div class="entity-info">
                      <ha-icon icon="${entity.attributes?.icon || 'mdi:refresh'}"></ha-icon>
                      <div class="entity-details">
                        <div class="entity-name">${entity.attributes?.friendly_name || entity.entity_id}</div>
                        <div class="entity-id">${entity.entity_id}</div>
                      </div>
                    </div>
                    ${this.config.button === entity.entity_id ? 
                      html`<ha-icon icon="mdi:check" class="check-icon"></ha-icon>` : ''}
                  </div>
                `)}
                ${this._filteredButtons.length === 0 ? html`
                  <div class="no-results">未找到匹配的按钮</div>
                ` : ''}
              </div>
            ` : ''}
        </div>

        <div class="form-group">
          <label>主题：
          <select 
            @change=${this._valueChanged}
            .value=${this.config.theme !== undefined ? this.config.theme : 'on'}
            name="theme"
          >
            <option value="on">浅色主题</option>
            <option value="off">深色主题</option>
          </select>
          </label>
        </div>

        <div class="form-group">
          <label>每个模块宽度：
          <input 
            type="text" 
            @change=${this._valueChanged}
            .value=${this.config.width !== undefined ? this.config.width : '100%'}
            name="width"
            placeholder="100%"
            </label>
        </div>

        <div class="form-group">
          <label>每个模块高度：
          <input 
            type="text" 
            @change=${this._valueChanged}
            .value=${this.config.height !== undefined ? this.config.height : '300px'}
            name="height"
            placeholder="300px"
           </label>
        </div>

        <div class="form-group">
          <label class="checkbox-label checkbox-icon">
            数据表格内是否显示图标：
            <input 
              type="checkbox" 
              @change=${this._checkboxChanged}
              .checked=${this.config.icon !== 'none'}
              name="icon"
            />
          </label>
        </div>


        <div class="form-group">
          <label class="color-text">数据表格内每个格子的宽度：
          <input 
            type="text" 
            @change=${this._valueChanged}
            .value=${this.config.cardwidth !== undefined ? this.config.cardwidth : ''}
            name="cardwidth"
            placeholder=""
          </label>
        </div>

        <div class="form-group">
          <label class="color-text">数据表格内每个格子的高度：
          <input 
            type="text" 
            @change=${this._valueChanged}
            .value=${this.config.cardheight !== undefined ? this.config.cardheight : '35px'}
            name="cardheight"
            placeholder="35px"
            </label>
        </div>

        <div class="form-group">
            <label class="color-input-wrapper">用电量数据颜色：
              <input 
                type="color" 
                @change=${this._valueChanged}
                .value=${this.config.color_num !== undefined ? this.config.color_num : '#0fccc3'}
                name="color_num"
                class="color-input"
              />
              <input 
                type="text" 
                @change=${this._valueChanged}
                .value=${this.config.color_num !== undefined ? this.config.color_num : '#0fccc3'}
                name="color_num"
                class="color-text"
                placeholder="#0fccc3"
              />
          </label>
        </div>

        <div class="form-group">
        <label class="color-input-wrapper">用电费数据颜色：
            <input 
              type="color" 
              @change=${this._valueChanged}
              .value=${this.config.color_cost !== undefined ? this.config.color_cost : '#804aff'}
              name="color_cost"
              class="color-input"
            />
            <input 
              type="text" 
              @change=${this._valueChanged}
              .value=${this.config.color_cost !== undefined ? this.config.color_cost : '#804aff'}
              name="color_cost"
              class="color-text"
              placeholder="#804aff"
            />
            </label>
        </div>

        <div class="form-group">
          <label>表格内电量时段显示控制</label>
          <div class="checkbox-group">
            <label class="checkbox-label">
              <input 
                type="checkbox" 
                @change=${this._checkboxChanged}
                .checked=${this.config.n_num === 'none'}
                name="n_num"
              />
              隐藏平段电量
            </label>
            <label class="checkbox-label">
              <input 
                type="checkbox" 
                @change=${this._checkboxChanged}
                .checked=${this.config.t_num === 'none'}
                name="t_num"
              />
              隐藏尖段电量
            </label>
            <label class="checkbox-label">
              <input 
                type="checkbox" 
                @change=${this._checkboxChanged}
                .checked=${this.config.p_num === 'none'}
                name="p_num"
              />
              隐藏峰段电量
            </label>
            <label class="checkbox-label">
              <input 
                type="checkbox" 
                @change=${this._checkboxChanged}
                .checked=${this.config.v_num === 'none'}
                name="v_num"
              />
              隐藏谷段电量
            </label>
          </div>
        </div>

        <!-- 余额实体配置 -->
        <div class="balance-entity-section">
          <div class="form-group">
            <label>国网信息标题：</label>
            <input 
              type="text" 
              @change=${this._valueChanged}
              .value=${this.config.balance_name !== undefined ? this.config.balance_name : '国网信息'}
              name="balance_name"
              placeholder="国网信息"
              class="balance-name-input"
            />
          </div>

          <div class="form-group">
            <label>全局预警条件：</label>
            <input 
              type="text" 
              @change=${this._valueChanged}
              .value=${this.config.global_warning !== undefined ? this.config.global_warning : ''}
              name="global_warning"
              placeholder="例如: <10 或 <=0 或 ==off"
              class="balance-name-input"
            />
          </div>

          <div class="form-group">
            <label>添加余额实体：</label>
            <input 
              type="text" 
              @input=${this._onBalanceEntitySearch}
              @focus=${this._onBalanceEntitySearch}
              .value=${this._balanceSearchTerm || ''}
              placeholder="搜索或输入实体ID..."
              class="balance-entity-search"
            />
            ${this._showBalanceEntityList ? html`
              <div class="entity-dropdown">
                ${this._filteredBalanceEntities.map(entity => html`
                  <div 
                    class="entity-option ${this._isBalanceEntitySelected(entity.entity_id) ? 'selected' : ''}"
                    @click=${() => this._selectBalanceEntity(entity.entity_id)}
                  >
                    <div class="entity-info">
                      <ha-icon icon="${entity.attributes?.icon || 'mdi:help-circle'}"></ha-icon>
                      <div class="entity-details">
                        <div class="entity-name">${entity.attributes?.friendly_name || entity.entity_id}</div>
                        <div class="entity-id">${entity.entity_id}</div>
                      </div>
                    </div>
                    ${this._isBalanceEntitySelected(entity.entity_id) ? 
                      html`<ha-icon icon="mdi:check" class="check-icon"></ha-icon>` : ''}
                  </div>
                `)}
                ${this._filteredBalanceEntities.length === 0 ? html`
                  <div class="no-results">未找到匹配的实体</div>` : ''}
              </div>
            ` : ''}
          </div>

          ${this.config.entities && this.config.entities.length > 0 ? html`
            <div class="selected-balance-entities">
              <div class="selected-balance-label">已选择的余额实体：</div>
              ${this.config.entities.map((entityConfig, index) => {
                const entity = this.hass.states[entityConfig.entity_id];
                const friendlyName = entityConfig.overrides?.name || entity?.attributes?.friendly_name || entityConfig.entity_id;
                
                return html`
                  <div class="selected-balance-entity">
                    <div class="balance-entity-header">
                      <div class="balance-entity-info">
                        <ha-icon icon="${entity?.attributes?.icon || 'mdi:help-circle'}"></ha-icon>
                        <div>
                          <div class="balance-entity-name">${friendlyName}</div>
                          <div class="balance-entity-id">${entityConfig.entity_id}</div>
                        </div>
                      </div>
                      <button 
                        class="remove-balance-btn"
                        @click=${() => this._removeBalanceEntity(index)}
                      >
                        <ha-icon icon="mdi:close"></ha-icon>
                      </button>
                    </div>
                    
                    <div class="balance-entity-overrides">
                      <div class="override-config">
                        <input 
                          type="checkbox" 
                          class="override-checkbox"
                          @change=${(e) => this._updateEntityOverride(index, 'name', e.target.checked)}
                          .checked=${entityConfig.overrides?.name !== undefined}
                        />
                        <span class="override-label">名称:</span>
                        <input 
                          type="text" 
                          class="override-input"
                          @change=${(e) => this._updateEntityOverrideValue(index, 'name', e.target.value)}
                          .value=${entityConfig.overrides?.name || ''}
                          placeholder="自定义名称"
                          ?disabled=${entityConfig.overrides?.name === undefined}
                        />
                      </div>

                      <div class="override-config">
                        <input 
                          type="checkbox" 
                          class="override-checkbox"
                          @change=${(e) => this._updateEntityOverride(index, 'unit', e.target.checked)}
                          .checked=${entityConfig.overrides?.unit !== undefined}
                        />
                        <span class="override-label">单位:</span>
                        <input 
                          type="text" 
                          class="override-input"
                          @change=${(e) => this._updateEntityOverrideValue(index, 'unit', e.target.value)}
                          .value=${entityConfig.overrides?.unit || ''}
                          placeholder="自定义单位"
                          ?disabled=${entityConfig.overrides?.unit === undefined}
                        />
                      </div>

                      <div class="override-config">
                        <input 
                          type="checkbox" 
                          class="override-checkbox"
                          @change=${(e) => this._updateEntityOverride(index, 'icon', e.target.checked)}
                          .checked=${entityConfig.overrides?.icon !== undefined}
                        />
                        <span class="override-label">图标:</span>
                        <input 
                          type="text" 
                          class="override-input"
                          @change=${(e) => this._updateEntityOverrideValue(index, 'icon', e.target.value)}
                          .value=${entityConfig.overrides?.icon || ''}
                          placeholder="mdi:icon-name"
                          ?disabled=${entityConfig.overrides?.icon === undefined}
                        />
                      </div>

                      <div class="override-config">
                        <input 
                          type="checkbox" 
                          class="override-checkbox"
                          @change=${(e) => this._updateEntityOverride(index, 'warning', e.target.checked)}
                          .checked=${entityConfig.overrides?.warning !== undefined}
                        />
                        <span class="override-label">预警:</span>
                        <input 
                          type="text" 
                          class="override-input"
                          @change=${(e) => this._updateEntityOverrideValue(index, 'warning', e.target.value)}
                          .value=${entityConfig.overrides?.warning || ''}
                          placeholder='>10, <=5, ==on,=="hello world"'
                          ?disabled=${entityConfig.overrides?.warning === undefined}
                        />
                      </div>

                    </div>
                  </div>
                `;
              })}
            </div>
          ` : ''}
        </div>

      </div>
    `;
  }

  _valueChanged(e) {
    const { name, value } = e.target;
    if (!value) return;
    
    this.config = {
      ...this.config,
      [name]: value
    };
    
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this.config },
      bubbles: true,
      composed: true
    }));
  }

  _checkboxChanged(e) {
    const { name, checked } = e.target;
    
    this.config = {
      ...this.config,
      [name]: checked ? 'none' : ''
    };
    
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this.config },
      bubbles: true,
      composed: true
    }));
  }

  _onButtonSearch(e) {
    const searchTerm = e.target.value.toLowerCase();
    this._buttonSearchTerm = searchTerm;
    this._showButtonList = true;
    
    if (!this.hass) return;
    
    const allEntities = Object.values(this.hass.states);
    
    this._filteredButtons = allEntities.filter(entity => {
      const entityId = entity.entity_id.toLowerCase();
      const friendlyName = (entity.attributes.friendly_name || '').toLowerCase();
      
      // 优先显示button.开头的实体，或者包含refresh、button等关键词的实体
      const isButtonEntity = entityId.startsWith('button.') || entityId.startsWith('input_button.');
      const isRefreshEntity = entityId.includes('refresh') || entityId.includes('reload') || entityId.includes('update');
      const matchesSearch = entityId.includes(searchTerm) || friendlyName.includes(searchTerm);
      
      return (isButtonEntity || isRefreshEntity) && matchesSearch;
    }).slice(0, 20);
    
    this.requestUpdate();
  }

  _selectButton(buttonId) {
    this.config = {
      ...this.config,
      button: buttonId
    };
    
    this._buttonSearchTerm = ''; // 清除搜索词，让输入框显示选中的实体ID
    
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this.config },
      bubbles: true,
      composed: true
    }));
    
    this._showButtonList = false;
    this.requestUpdate();
  }



  firstUpdated() {
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.balance-entity-section')) {
        this._showButtonList = false;
        this._showBalanceEntityList = false;
        this.requestUpdate();
      }
    });
  }

  constructor() {
    super();
    this._buttonSearchTerm = '';
    this._filteredButtons = [];
    this._showButtonList = false;
    this._balanceSearchTerm = '';
    this._filteredBalanceEntities = [];
    this._showBalanceEntityList = false;
  }

  setConfig(config) {
    this.config = { ...config };
  }

  // 余额实体相关方法
  _onBalanceEntitySearch(e) {
    const searchTerm = e.target.value.toLowerCase();
    this._balanceSearchTerm = searchTerm;
    this._showBalanceEntityList = true;
    
    if (!this.hass) return;
    
    const allEntities = Object.values(this.hass.states);
    
    this._filteredBalanceEntities = allEntities.filter(entity => {
      const entityId = entity.entity_id.toLowerCase();
      const friendlyName = (entity.attributes.friendly_name || '').toLowerCase();
      
      // 过滤掉已经选择的实体
      const isAlreadySelected = this._isBalanceEntitySelected(entity.entity_id);
      
      // 优先显示sensor.开头的实体
      const isSensorEntity = entityId.startsWith('sensor.');
      const matchesSearch = entityId.includes(searchTerm) || friendlyName.includes(searchTerm);
      
      return isSensorEntity && matchesSearch && !isAlreadySelected;
    }).slice(0, 20);
    
    this.requestUpdate();
  }

  _isBalanceEntitySelected(entityId) {
    return this.config.entities && this.config.entities.some(entity => entity.entity_id === entityId);
  }

  _selectBalanceEntity(entityId) {
    const currentEntities = this.config.entities || [];
    
    // 添加新的余额实体配置
    const newEntity = {
      entity_id: entityId,
    };
    
    this.config = {
      ...this.config,
      entities: [...currentEntities, newEntity]
    };
    
    this._balanceSearchTerm = '';
    
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this.config },
      bubbles: true,
      composed: true
    }));
    
    this._showBalanceEntityList = false;
    this.requestUpdate();
  }

  _updateEntityOverride(index, overrideType, enabled) {
    const currentEntities = this.config.entities || [];
    const newEntities = [...currentEntities];
    
    if (newEntities[index]) {
      const overrides = { ...newEntities[index].overrides };
      
      if (enabled) {
        overrides[overrideType] = '';
      } else {
        delete overrides[overrideType];
      }
      
      newEntities[index] = {
        ...newEntities[index],
        overrides: Object.keys(overrides).length > 0 ? overrides : undefined
      };
    }
    
    this.config = {
      ...this.config,
      entities: newEntities
    };
    
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this.config },
      bubbles: true,
      composed: true
    }));
    
    this.requestUpdate();
  }

  _updateEntityOverrideValue(index, overrideType, value) {
    const currentEntities = this.config.entities || [];
    const newEntities = [...currentEntities];
    
    if (newEntities[index] && newEntities[index].overrides && newEntities[index].overrides[overrideType] !== undefined) {
      const overrides = { ...newEntities[index].overrides };
      overrides[overrideType] = value.trim();
      
      newEntities[index] = {
        ...newEntities[index],
        overrides: overrides
      };
    }
    
    this.config = {
      ...this.config,
      entities: newEntities
    };
    
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this.config },
      bubbles: true,
      composed: true
    }));
    
    this.requestUpdate();
  }

  _removeBalanceEntity(index) {
    const currentEntities = this.config.entities || [];
    const newEntities = currentEntities.filter((_, i) => i !== index);
    
    this.config = {
      ...this.config,
      entities: newEntities
    };
    
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: this.config },
      bubbles: true,
      composed: true
    }));
    
    this.requestUpdate();
  }
}
customElements.define('xiaoshi-state-grid-editor', StateGridPhoneEditor);

class StateGridPhone extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object },
      selectedDate: { type: String },
      todayDate: { type: String },
      _balanceData: { type: Array },
      _balanceLoading: { type: Boolean },
      _balanceRefreshInterval: { type: Number },
      _selectedBalanceEntity: { type: String }
    };
  }

  setConfig(config) {
    this.config = {
      theme: config?.theme || 'on',
      width: config?.width || '100%',
      height: config?.height || '300px',
      showIcon: config.icon !=='none',
      cardheight: config?.cardheight || '35px',
      color_num: config?.color_num || '#0fccc3',
      color_cost: config?.color_cost || '#804aff',
      ...config
    }; 
    
    // 配置更新时重新加载余额数据
    if (this.hass) {
      this._loadBalanceData();
    }
  }
  
  constructor() {
    super();
    this._balanceData = [];
    this._balanceLoading = false;
    this._balanceRefreshInterval = null;
    this._selectedBalanceEntity = '';
  }
  
  static getConfigElement() {
    return document.createElement("xiaoshi-state-grid-editor");
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadBalanceData();
    
    // 每300秒刷新一次数据
    this._balanceRefreshInterval = setInterval(() => {
      this._loadBalanceData();
    }, 300000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._balanceRefreshInterval) {
      clearInterval(this._balanceRefreshInterval);
    }
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    
    // 监听_selectedBalanceEntity的变化，立即触发更新
    if (changedProperties.has('_selectedBalanceEntity')) {
      console.log('StateGridPhone: _selectedBalanceEntity changed to', this._selectedBalanceEntity);
      // 立即请求更新，确保子组件收到新的entity
      this.requestUpdate();
    }
  }

  async _loadBalanceData() {
    if (!this.hass || !this.config.entities) return;
    
    this._balanceLoading = true;
    this.requestUpdate();
    
    try {
      const balanceData = [];
      
      for (const entityConfig of this.config.entities) {
        const entity = this.hass.states[entityConfig.entity_id];
        if (!entity) continue;
        
        let value = entity.state;
        let unit = entityConfig.unit || entity.attributes.unit_of_measurement || '';
        let friendlyName = entityConfig.name || entity.attributes.friendly_name || entity.entity_id;
        let icon = entityConfig.icon || entity.attributes.icon || 'mdi:help-circle';
        let warning = entityConfig.warning || '';
        
        // 应用覆盖配置
        if (entityConfig.overrides) {
          if (entityConfig.overrides.name && entityConfig.overrides.name.trim() !== '') {
            friendlyName = entityConfig.overrides.name;
          }
          if (entityConfig.overrides.unit && entityConfig.overrides.unit.trim() !== '') {
            unit = entityConfig.overrides.unit;
          }
          if (entityConfig.overrides.icon && entityConfig.overrides.icon.trim() !== '') {
            icon = entityConfig.overrides.icon;
          }
          if (entityConfig.overrides.warning && entityConfig.overrides.warning.trim() !== '') {
            warning = entityConfig.overrides.warning;
          }
        }
        
        balanceData.push({
          entity_id: entityConfig.entity_id,
          friendly_name: friendlyName,
          value: value,
          unit: unit,
          icon: icon,
          warning: warning
        });
      }
      
      this._balanceData = balanceData;
      
      // 如果没有选中的实体，默认选中第一个
      if (balanceData.length > 0 && !this._selectedBalanceEntity) {
        this._selectedBalanceEntity = balanceData[0].entity_id;
      }
    } catch (error) {
      console.error('加载国网实体数据失败:', error);
    } finally {
      this._balanceLoading = false;
      this.requestUpdate();
    }
  }

  _calculateTotalAmount() {
    if (!this._balanceData || this._balanceData.length === 0) {
      return '0.00';
    }
    
    let total = 0;
    for (const item of this._balanceData) {
      const value = parseFloat(item.value);
      if (!isNaN(value)) {
        total += value;
      }
    }
    
    return total.toFixed(2);
  }

  _evaluateWarningCondition(value, condition) {
    if (!condition || condition.trim() === '') return false;
    
    // 支持的操作符
    const operators = ['>=', '<=', '>', '<', '==', '!='];
    let operator = null;
    let compareValue = '';
    
    // 查找操作符
    for (const op of operators) {
      if (condition.includes(op)) {
        operator = op;
        const parts = condition.split(op);
        if (parts.length >= 2) {
          compareValue = parts.slice(1).join(op).trim();
        }
        break;
      }
    }
    
    if (!operator) return false;
    
    // 移除比较值两端的引号（如果有的话）
    if ((compareValue.startsWith('"') && compareValue.endsWith('"')) || 
        (compareValue.startsWith("'") && compareValue.endsWith("'"))) {
      compareValue = compareValue.slice(1, -1);
    }
    
    // 尝试将值转换为数字
    const numericValue = parseFloat(value);
    const numericCompare = parseFloat(compareValue);
    
    // 如果两个值都是数字，进行数值比较
    if (!isNaN(numericValue) && !isNaN(numericCompare)) {
      switch (operator) {
        case '>': return numericValue > numericCompare;
        case '>=': return numericValue >= numericCompare;
        case '<': return numericValue < numericCompare;
        case '<=': return numericValue <= numericCompare;
        case '==': return numericValue === numericCompare;
        case '!=': return numericValue !== numericCompare;
      }
    }
    
    // 字符串比较
    const stringValue = String(value);
    const stringCompare = compareValue;
    
    switch (operator) {
      case '==': return stringValue === stringCompare;
      case '!=': return stringValue !== stringCompare;
      case '>': return stringValue > stringCompare;
      case '>=': return stringValue >= stringCompare;
      case '<': return stringValue < stringCompare;
      case '<=': return stringValue <= stringCompare;
    }
    
    return false;
  }

  _handleBalanceEntityClick(balanceData) {
    if (!balanceData.entity_id) return;
    
    // 切换选中的实体
    const oldEntity = this._selectedBalanceEntity;
    this._selectedBalanceEntity = balanceData.entity_id;
    
    // 只有当entity真正改变时才请求更新
    if (oldEntity !== this._selectedBalanceEntity) {
      console.log('Entity changed from', oldEntity, 'to', this._selectedBalanceEntity);
      // 立即触发更新，确保子组件立即收到新的entity
      this.requestUpdate();
      
      // 使用setTimeout确保在下一个事件循环中触发更新，避免延迟
      setTimeout(() => {
        this.requestUpdate();
      }, 0);
    }
  }
  
  static get styles() {
    return css`
      :host {
        display: block;
      }
      .card-container {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      
      .balance-card {
        width: 100%;
        background: var(--bg-color, #fff);
        border-radius: 12px;
      }

      .balance-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px;
        background: var(--bg-color, #fff);
        border-radius: 12px;
      }

      .balance-indicator {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        margin-right: 8px;
      }

      @keyframes pulse {
        0% { opacity: 1; }
        50% { opacity: 0.5; }
        100% { opacity: 1; }
      }

      .balance-title {
        font-size: 20px;
        font-weight: 500;
        color: var(--fg-color, #000);
        height: 30px;
        line-height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      /*标题统计数字*/
      .balance-count {
        color: var(--fg-color, #000);
        border-radius: 8px;
        font-size: 20px;
        height: 30px;
        line-height: 30px;
        text-align: center;
        line-height: 30px;
        font-weight: bold;
        padding: 0px;
      }

      .balance-count.warning {
        color: #F44336;
      }

      .balance-count.warning {
        color: #F44336;
      }

      .balance-devices-list {
        flex: 1;
        overflow-y: auto;
        min-height: 0;
        padding: 0 0 8px 0;
      }

      .balance-device-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin: 0px 16px;
        padding: 8px 0;
        border-bottom: 1px solid rgb(150,150,150,0.5);
        cursor: pointer;
        transition: background-color 0.2s;
      }

      .balance-device-item:first-child {
        border-top: 1px solid rgb(150,150,150,0.5);
      }

      .balance-device-item:hover {
        background-color: rgba(150,150,150,0.1);
      }

      .balance-device-item.selected {
        background-color: rgba(33, 150, 243, 0.2);
        border-left: 3px solid rgb(33, 150, 243);
      }

      .balance-device-left {
        display: flex;
        align-items: center;
        flex: 1;
        min-width: 0;
      }

      .balance-device-icon {
        margin-right: 12px;
        color: var(--fg-color, #000);
        flex-shrink: 0;
      }

      .balance-device-name {
        color: var(--fg-color, #000);
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .balance-device-value {
        color: var(--fg-color, #000);
        font-size: 12px;
        margin-left: auto;
        flex-shrink: 0;
        font-weight: bold;
      }

      .balance-device-value.warning {
        color: #F44336;
      }

      .balance-device-unit {
        font-size: 12px;
        color: var(--fg-color, #000);
        margin-left: 4px;
        font-weight: bold;
      }

      .balance-device-unit.warning {
        color: #F44336;
      }

      .balance-no-devices {
        text-align: center;
        padding: 10px 0;
        color: var(--fg-color, #000);
      }

      .balance-loading {
        text-align: center;
        padding: 10px 0;
        color: var(--fg-color, #000);
      }
    `;
  }

  render() {
    if (!this.hass) {
      return html`<div>Loading...</div>`;
    };
    const config = {
      ...this.config
    };

    const bodyHeight =  this.config.height;
    
    // 获取主题和颜色
    const theme = this.config.theme || 'on';
    const fgColor = theme === 'on' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
    const bgColor = theme === 'on' ? 'rgb(255, 255, 255)' : 'rgb(50, 50, 50)';
    
    // 计算总金额的预警状态
    const totalAmount = this._calculateTotalAmount();
    let totalAmountWarning = false;
    if (this.config.global_warning && this.config.global_warning.trim() !== '') {
      totalAmountWarning = this._evaluateWarningCondition(totalAmount, this.config.global_warning);
    }
    
    return html`
      <div class="card-container" style="width: ${this.config.width};">
        <!-- 国王信息卡片 -->
        <div class="balance-card" style="--fg-color: ${fgColor}; --bg-color: ${bgColor};">
          <div class="balance-header">
            <div class="balance-title">
              <span class="balance-indicator" style="background: rgb(0,222,220); animation: pulse 2s infinite"></span>
              ${this.config.balance_name || '国网信息'}
            </div>
            <div class="balance-count ${totalAmountWarning ? 'warning' : ''}">
              ￥ ${totalAmount} 元
            </div>
          </div>
          
          ${this._balanceData.length > 1 ? html`
            <div class="balance-devices-list">
              ${this._balanceLoading ? 
                html`<div class="balance-loading">加载中...</div>` :
                
                this._balanceData.length === 0 ? 
                  html`<div class="balance-no-devices">请配置国网实体</div>` :
                  html`
                    ${this._balanceData.map(balanceData => {
                      // 明细预警优先级最高
                      let isWarning = false;
                      
                      // 首先检查明细预警，如果存在且满足条件，直接设为预警状态
                      if (balanceData.warning && balanceData.warning.trim() !== '') {
                        isWarning = this._evaluateWarningCondition(balanceData.value, balanceData.warning); 
                      } else {
                        // 只有在没有明细预警时才检查全局预警
                        if (this.config.global_warning && this.config.global_warning.trim() !== '') {
                          isWarning = this._evaluateWarningCondition(balanceData.value, this.config.global_warning);
                        }
                      }
                      
                      const isSelected = this._selectedBalanceEntity === balanceData.entity_id;
                      
                      return html`
                        <div class="balance-device-item ${isSelected ? 'selected' : ''}" @click=${() => this._handleBalanceEntityClick(balanceData)}>
                          <div class="balance-device-left">
                            <ha-icon class="balance-device-icon" icon="${balanceData.icon}"></ha-icon>
                            <div class="balance-device-name">${balanceData.friendly_name}</div>
                          </div>
                          <div class="balance-device-value ${isWarning ? 'warning' : ''}">
                            ${balanceData.value}
                            <span class="balance-device-unit ${isWarning ? 'warning' : ''}">${balanceData.unit}</span>
                          </div>
                        </div>
                      `;
                    })}
                  `
              }
            </div>
          ` : ''}
        </div>

        <xiaoshi-state-grid-table 
          .hass=${this.hass}
          .config=${this.config}
					.entity=${this._selectedBalanceEntity}
          .width=${this.config.width}
          .height=${bodyHeight}
          .icon=${this.config.icon}
          .colorNum=${config.color_num}
          .colorCost=${config.color_cost}
          .cardwidth=${config.cardwidth}
          .cardheight=${config.cardheight}>
        </xiaoshi-state-grid-table>

        <xiaoshi-state-grid-calendar 
          .hass=${this.hass}
          .config=${this.config}
					.entity=${this._selectedBalanceEntity}
          .width=${this.config.width}
          .height=${bodyHeight}
          .colorNum=${config.color_num}
          .colorCost=${config.color_cost}>
        </xiaoshi-state-grid-calendar>

        <xiaoshi-state-grid-chart-day 
          .hass=${this.hass}
          .config=${this.config}
					.entity=${this._selectedBalanceEntity}
          .width=${this.config.width}
          .height=${bodyHeight}
          .colorNum=${config.color_num}
          .colorCost=${config.color_cost}>
        </xiaoshi-state-grid-chart-day>

        <xiaoshi-state-grid-chart-month 
          .hass=${this.hass}
          .config=${this.config}
					.entity=${this._selectedBalanceEntity}
          .width=${this.config.width}
          .height=${bodyHeight}
          .colorNum=${config.color_num}
          .colorCost=${config.color_cost}>
        </xiaoshi-state-grid-chart-month>
        
      </div>
    `;
  }
}
customElements.define('xiaoshi-state-grid-phone', StateGridPhone);

class StateGridPad extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object },
      selectedDate: { type: String },
      todayDate: { type: String },
      _balanceData: { type: Array },
      _balanceLoading: { type: Boolean },
      _balanceRefreshInterval: { type: Number },
      _selectedBalanceEntity: { type: String }
    };
  }

  setConfig(config) {
    this.config = {
      theme: config?.theme || 'on',
      width: config?.width || '380px',
      height: config?.height || '300px',
      showIcon: config.icon !=='none',
      cardheight: config?.cardheight || '35px',
      color_num: config?.color_num || '#0fccc3',
      color_cost: config?.color_cost || '#804aff',
      ...config
    };
    
    // 配置更新时重新加载余额数据
    if (this.hass) {
      this._loadBalanceData();
    }
  }

  constructor() {
    super();
    this._balanceData = [];
    this._balanceLoading = false;
    this._balanceRefreshInterval = null;
    this._selectedBalanceEntity = '';
  }

  static getConfigElement() {
    return document.createElement("xiaoshi-state-grid-editor");
  }


  connectedCallback() {
    super.connectedCallback();
    this._loadBalanceData();
    
    // 每300秒刷新一次数据
    this._balanceRefreshInterval = setInterval(() => {
      this._loadBalanceData();
    }, 300000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._balanceRefreshInterval) {
      clearInterval(this._balanceRefreshInterval);
    }
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    
    // 监听_selectedBalanceEntity的变化，立即触发更新
    if (changedProperties.has('_selectedBalanceEntity')) {
      console.log('StateGridPhone: _selectedBalanceEntity changed to', this._selectedBalanceEntity);
      // 立即请求更新，确保子组件收到新的entity
      this.requestUpdate();
    }
  }

  async _loadBalanceData() {
    if (!this.hass || !this.config.entities) return;
    
    this._balanceLoading = true;
    this.requestUpdate();
    
    try {
      const balanceData = [];
      
      for (const entityConfig of this.config.entities) {
        const entity = this.hass.states[entityConfig.entity_id];
        if (!entity) continue;
        
        let value = entity.state;
        let unit = entityConfig.unit || entity.attributes.unit_of_measurement || '';
        let friendlyName = entityConfig.name || entity.attributes.friendly_name || entity.entity_id;
        let icon = entityConfig.icon || entity.attributes.icon || 'mdi:help-circle';
        let warning = entityConfig.warning || '';
        
        // 应用覆盖配置
        if (entityConfig.overrides) {
          if (entityConfig.overrides.name && entityConfig.overrides.name.trim() !== '') {
            friendlyName = entityConfig.overrides.name;
          }
          if (entityConfig.overrides.unit && entityConfig.overrides.unit.trim() !== '') {
            unit = entityConfig.overrides.unit;
          }
          if (entityConfig.overrides.icon && entityConfig.overrides.icon.trim() !== '') {
            icon = entityConfig.overrides.icon;
          }
          if (entityConfig.overrides.warning && entityConfig.overrides.warning.trim() !== '') {
            warning = entityConfig.overrides.warning;
          }
        }
        
        balanceData.push({
          entity_id: entityConfig.entity_id,
          friendly_name: friendlyName,
          value: value,
          unit: unit,
          icon: icon,
          warning: warning
        });
      }
      
      this._balanceData = balanceData;
      
      // 如果没有选中的实体，默认选中第一个
      if (balanceData.length > 0 && !this._selectedBalanceEntity) {
        this._selectedBalanceEntity = balanceData[0].entity_id;
      }
    } catch (error) {
      console.error('加载国网实体数据失败:', error);
    } finally {
      this._balanceLoading = false;
      this.requestUpdate();
    }
  }

  _calculateTotalAmount() {
    if (!this._balanceData || this._balanceData.length === 0) {
      return '0.00';
    }
    
    let total = 0;
    for (const item of this._balanceData) {
      const value = parseFloat(item.value);
      if (!isNaN(value)) {
        total += value;
      }
    }
    
    return total.toFixed(2);
  }

  _evaluateWarningCondition(value, condition) {
    if (!condition || condition.trim() === '') return false;
    
    // 支持的操作符
    const operators = ['>=', '<=', '>', '<', '==', '!='];
    let operator = null;
    let compareValue = '';
    
    // 查找操作符
    for (const op of operators) {
      if (condition.includes(op)) {
        operator = op;
        const parts = condition.split(op);
        if (parts.length >= 2) {
          compareValue = parts.slice(1).join(op).trim();
        }
        break;
      }
    }
    
    if (!operator) return false;
    
    // 移除比较值两端的引号（如果有的话）
    if ((compareValue.startsWith('"') && compareValue.endsWith('"')) || 
        (compareValue.startsWith("'") && compareValue.endsWith("'"))) {
      compareValue = compareValue.slice(1, -1);
    }
    
    // 尝试将值转换为数字
    const numericValue = parseFloat(value);
    const numericCompare = parseFloat(compareValue);
    
    // 如果两个值都是数字，进行数值比较
    if (!isNaN(numericValue) && !isNaN(numericCompare)) {
      switch (operator) {
        case '>': return numericValue > numericCompare;
        case '>=': return numericValue >= numericCompare;
        case '<': return numericValue < numericCompare;
        case '<=': return numericValue <= numericCompare;
        case '==': return numericValue === numericCompare;
        case '!=': return numericValue !== numericCompare;
      }
    }
    
    // 字符串比较
    const stringValue = String(value);
    const stringCompare = compareValue;
    
    switch (operator) {
      case '==': return stringValue === stringCompare;
      case '!=': return stringValue !== stringCompare;
      case '>': return stringValue > stringCompare;
      case '>=': return stringValue >= stringCompare;
      case '<': return stringValue < stringCompare;
      case '<=': return stringValue <= stringCompare;
    }
    
    return false;
  }

  _handleBalanceEntityClick(balanceData) {
    if (!balanceData.entity_id) return;
    
    // 切换选中的实体
    const oldEntity = this._selectedBalanceEntity;
    this._selectedBalanceEntity = balanceData.entity_id;
    
    // 只有当entity真正改变时才请求更新
    if (oldEntity !== this._selectedBalanceEntity) {
      console.log('Entity changed from', oldEntity, 'to', this._selectedBalanceEntity);
      // 立即触发更新，确保子组件立即收到新的entity
      this.requestUpdate();
      
      // 使用setTimeout确保在下一个事件循环中触发更新，避免延迟
      setTimeout(() => {
        this.requestUpdate();
      }, 0);
    }
  }
    
  static get styles() {
    return css`
      :host {
        display: block;
      } 
      .grid-container {
        display: grid;
        grid-template-areas: 
          "a b"
          "c d";
        grid-template-columns: var(--width, 380px) var(--width, 380px);
        grid-template-rows: var(--height, 300px) var(--height, 300px);
        width: calc(var(--width, 380px) * 2 + 5px);
        height: calc(var(--height, 300px) * 2 + 5px);
        gap: 5px;
      } 
      .grid-item {
        display: flex;
        position: relative;
      }
      .a { grid-area: a; width:380px; height: 300px; }
      .b { grid-area: b; width:380px; height: 300px; }
      .c { grid-area: c; width:380px; height: 300px; }
      .d { grid-area: d; width:380px; height: 300px; }

      .card-container {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      
      .balance-card {
        width: calc(var(--width, 380px) * 2 + 5px);
        background: var(--bg-color, #fff);
        border-radius: 12px;
      }

      .balance-header {
        width: calc(var(--width, 380px) * 2 - 27px);
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px;
        background: var(--bg-color, #fff);
        border-radius: 12px;
      }

      .balance-indicator {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        margin-right: 8px;
      }

      @keyframes pulse {
        0% { opacity: 1; }
        50% { opacity: 0.5; }
        100% { opacity: 1; }
      }

      .balance-title {
        font-size: 20px;
        font-weight: 500;
        color: var(--fg-color, #000);
        height: 30px;
        line-height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .balance-count {
        color: var(--fg-color, #000);
        border-radius: 8px;
        font-size: 20px;
        height: 30px;
        line-height: 30px;
        text-align: center;
        line-height: 30px;
        font-weight: bold;
        padding: 0px;
      }

      .balance-count.warning {
        color: #F44336;
      }

      .balance-devices-list {
        width: calc(var(--width, 380px) * 2 - 27px);
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        justify-content: flex-start;
        align-items: stretch;
        overflow-x: auto;
        overflow-y: hidden;
        min-height: 0;
        padding: 0 0 8px 0;
        gap: 8px;
        margin-left: 16px;
      }

      .balance-device-item {
        width: calc(var(--width, 380px) / 2 - 24px);
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin: 0px 4px;
        padding: 8px 0;
        border-top: 1px solid rgb(150,150,150,0.5);
        border-bottom: 1px solid rgb(150,150,150,0.5);
        cursor: pointer;
        transition: background-color 0.2s;
      }

      .balance-device-item:first-child {
      }

      .balance-device-item:hover {
        background-color: rgba(150,150,150,0.1);
      }

      .balance-device-item.selected {
        background-color: rgba(33, 150, 243, 0.2);
        border-left: 3px solid rgb(33, 150, 243);
      }

      .balance-device-left {
        display: flex;
        align-items: center;
        flex: 1;
        min-width: 0;
      }

      .balance-device-icon {
        margin-right: 10px;
        color: var(--fg-color, #000);
        flex-shrink: 0;
      }

      .balance-device-name {
        color: var(--fg-color, #000);
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .balance-device-value {
        color: var(--fg-color, #000);
        font-size: 12px;
        margin-left: auto;
        flex-shrink: 0;
        font-weight: bold;
        margin-left: 4px;
      }

      .balance-device-value.warning {
        color: #F44336;
      }

      .balance-device-unit {
        font-size: 12px;
        color: var(--fg-color, #000);
        margin-left: 4px;
        font-weight: bold;
      }

      .balance-device-unit.warning {
        color: #F44336;
      }

      .balance-no-devices {
        text-align: center;
        padding: 10px 0;
        color: var(--fg-color, #000);
      }

      .balance-loading {
        text-align: center;
        padding: 10px 0;
        color: var(--fg-color, #000);
      }

    `;
  }

  render() {
    if (!this.hass) {
      return html`<div>Loading...</div>`;
    };
    const config = {
      ...this.config
    };

    const bodyHeight =  this.config.height;

    // 获取主题和颜色
    const theme = this.config.theme || 'on';
    const fgColor = theme === 'on' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
    const bgColor = theme === 'on' ? 'rgb(255, 255, 255)' : 'rgb(50, 50, 50)';
    
    // 计算总金额的预警状态
    const totalAmount = this._calculateTotalAmount();
    let totalAmountWarning = false;
    if (this.config.global_warning && this.config.global_warning.trim() !== '') {
      totalAmountWarning = this._evaluateWarningCondition(totalAmount, this.config.global_warning);
    }
    

    return html`
      <div class="card-container" style="width: ${this.config.width};">
        <!-- 国王信息卡片 -->
        <div class="balance-card" style="--fg-color: ${fgColor}; --bg-color: ${bgColor}; --width: ${this.config.width}; --height: ${this.config.height};">
          <div class="balance-header">
            <div class="balance-title">
              <span class="balance-indicator" style="background: rgb(0,222,220); animation: pulse 2s infinite"></span>
              ${this.config.balance_name || '国网信息'}
            </div>
            <div class="balance-count ${totalAmountWarning ? 'warning' : ''}">
              ￥ ${totalAmount} 元
            </div>
          </div>

          ${this._balanceData.length > 1 ? html`
            <div class="balance-devices-list">
              ${this._balanceLoading ? 
                html`<div class="balance-loading">加载中...</div>` :
                
                this._balanceData.length === 0 ? 
                  html`<div class="balance-no-devices">请配置国网实体</div>` :
                  html`
                    ${this._balanceData.map(balanceData => {
                      // 明细预警优先级最高
                      let isWarning = false;
                      
                      // 首先检查明细预警，如果存在且满足条件，直接设为预警状态
                      if (balanceData.warning && balanceData.warning.trim() !== '') {
                        isWarning = this._evaluateWarningCondition(balanceData.value, balanceData.warning); 
                      } else {
                        // 只有在没有明细预警时才检查全局预警
                        if (this.config.global_warning && this.config.global_warning.trim() !== '') {
                          isWarning = this._evaluateWarningCondition(balanceData.value, this.config.global_warning);
                        }
                      }
                      
                      const isSelected = this._selectedBalanceEntity === balanceData.entity_id;
                      
                      return html`
                        <div class="balance-device-item ${isSelected ? 'selected' : ''}" @click=${() => this._handleBalanceEntityClick(balanceData)}>
                          <div class="balance-device-left">
                            <ha-icon class="balance-device-icon" icon="${balanceData.icon}"></ha-icon>
                            <div class="balance-device-name">${balanceData.friendly_name}</div>
                          </div>
                          <div class="balance-device-value ${isWarning ? 'warning' : ''}">
                            ${balanceData.value}
                            <span class="balance-device-unit ${isWarning ? 'warning' : ''}">${balanceData.unit}</span>
                          </div>
                        </div>
                      `;
                    })}
                  `
              }
            </div>
          ` : ''}
        </div>
    
        <div class="grid-container" style="--width: ${this.config.width}; --height: ${this.config.height};">
          <div class="grid-item a">
            <xiaoshi-state-grid-table
              .hass=${this.hass}
              .config=${config}
              .entity=${this._selectedBalanceEntity}
              .width=${this.config.width}
              .height=${bodyHeight}
              .icon=${this.config.icon}
              .colorNum=${config.color_num}
              .colorCost=${config.color_cost}
              .cardwidth=${config.cardwidth}
              .cardheight=${config.cardheight}>
            </xiaoshi-state-grid-table>
          </div>
          <div class="grid-item b">
            <xiaoshi-state-grid-calendar
              .hass=${this.hass}
              .config=${config}
              .entity=${this._selectedBalanceEntity}
              .width=${this.config.width}
              .height=${bodyHeight}
              .colorNum=${config.color_num}
              .colorCost=${config.color_cost}>
            </xiaoshi-state-grid-calendar>
          </div>
          <div class="grid-item c">
            <xiaoshi-state-grid-chart-day
              .hass=${this.hass}
              .config=${config}
              .entity=${this._selectedBalanceEntity}
              .width=${this.config.width}
              .height=${bodyHeight}
              .colorNum=${config.color_num}
              .colorCost=${config.color_cost}>
            </xiaoshi-state-grid-chart-day>
          </div>
          <div class="grid-item d">
            <xiaoshi-state-grid-chart-month
              .hass=${this.hass}
              .config=${config}
              .entity=${this._selectedBalanceEntity}
              .width=${this.config.width}
              .height=${bodyHeight}
              .colorNum=${config.color_num}
              .colorCost=${config.color_cost}>
            </xiaoshi-state-grid-chart-month>
          </div>

        </div>
    `;
  }
}
customElements.define('xiaoshi-state-grid-pad', StateGridPad);

window.customCards = window.customCards || [];
window.customCards.push(
  {
    type: 'xiaoshi-state-grid-phone',
    name: '消逝国网卡片:手机端聚合UI',
    description: '国网手机端UI'
  },
  {
    type: 'xiaoshi-state-grid-pad',
    name: '消逝国网卡片:平板端聚合UI',
    description: '国网平板端UI'
  }
);
 
