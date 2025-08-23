console.info("%c 国网信息卡 \n%c   v 1.0   ", "color: red; font-weight: bold; background: black", "color: white; font-weight: bold; background: dimgray");
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
    this._updateLayout();
  }

  constructor() {
    super();
    this.hass = null;
    this.config = {
      entity: 'sensor.state_grid',
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
        --title-font-size: 20px;
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
        margin: 0px;
      }
      .light-theme {
        background: rgb(255,255,255);
        color: rgb(0,0,0);
      }
      .dark-theme {
        background: rgb(50,50,50);
        color: rgb(255,255,255);
      }
      .title {
        grid-area: title;
        font-size: var(--title-font-size);
        font-weight: bold;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 10px;
      }
      .refresh-time {
        grid-area: refresh-time;
        font-size: 13px;
        font-weight: bold;
        display: flex;
        align-items: flex-end;
        justify-content: flex-start;
        padding-left: 5px;
        justify-self: start;
      }
      .refresh-button {
        margin-left: 7px;
        cursor: pointer;
        color: rgb(0,200,200);
        transition: transform 1s ease;
      }
      .refresh-button.rotating {
        transform: rotate(360deg);
      }
      @keyframes rotate {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      .data-date {
        grid-area: data-date;
        font-size: 13px;
        font-weight: bold;
        display: flex;
        align-items: flex-start; 
        justify-content: flex-start;
        padding-left: 5px;
        justify-self: start;
      }
      .balance {
        grid-area: balance;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: var(--card-width, 55px);
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
    const middleColumnsCount = columnCount - 2;
    let gridTemplateAreas = `
      "a title ${Array(middleColumnsCount + 1 ).fill('title').join(' ')} b"   
      "a refresh-time ${Array(middleColumnsCount).fill('refresh-time').join(' ')} balance b"   
      "a data-date ${Array(middleColumnsCount).fill('data-date').join(' ')} balance b"`;
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
    const gridTemplateColumns = `3px auto ${visibleColumns.map(() => 'auto').join(' ')} auto 3px`;
    this._layoutStyle = `
      grid-template-areas: ${gridTemplateAreas};
      grid-template-columns: ${gridTemplateColumns};
      grid-template-rows: auto auto auto auto auto auto auto;
    `;
  } 

  updated(changedProperties) {
    if (changedProperties.has('hass') || changedProperties.has('config')) {
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
    }, 60000);
  }

  async _fetchData() {
    if (!this.hass || !this.config.entity) return;
    try {
      const entity = this.hass.states[this.config.entity];
      if (!entity) return;
      const attributes = entity.attributes || {};
      const dayData = attributes.daylist?.[0] || {};
      const monthData = attributes.monthlist?.[0] || {};
      const last_monthData = attributes.monthlist?.[1] || {};
      const yearData = attributes.yearlist?.[0] || {};
      this._data = {
        refresh_time: attributes.date || 'N/A',
        daily_lasted_date: dayData.day || 'N/A',
        balance: entity.state || 'N/A',
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

  _formatBalance(balance) {
    return balance >= 20 ? 
      `${balance}元` : 
      html`<span class="warning">${balance}元</span>`;
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
        <div class="title">${this.config.title || '电费信息'}</div>
        <div class="refresh-time">
          用电刷新时间：${this._data.refresh_time || 'N/A'}
          ${this.config.button ? html`
          <ha-icon class="refresh-button ${this._isRefreshing ? 'rotating' : ''}"\n icon="mdi:refresh"\n @click=${this._handleRefresh}\n title="手动刷新数据"></ha-icon>
          ` : ''}
        </div>
        <div class="data-date">
          最新用电日期：${this._data.daily_lasted_date || 'N/A'}
        </div>
        <div class="balance">
          ${this._renderDataItem(this.config.balance_name || '电费余额', 'mdi:cash', this._formatBalance(this._data.balance), itemThemeClass, null, this.colorCost)}
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
customElements.define('state-grid-table', StateGridNodeRed);

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
      if (config.entity !== undefined) this.entity = config.entity;
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
customElements.define('state-grid-calendar', StateGridCalendar);

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
      if (config.entity !== undefined) this.entity = config.entity;
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

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._chart) {
      this._chart.destroy();
      this._chart = null;
    }
  }
}
customElements.define('state-grid-chart-day', StateGridChartDay);

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
      if (config.entity !== undefined) this.entity = config.entity;
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
        ele: monthlistDay.monthEleNum || 0,
        cost: monthlistDay.monthEleCost || 0,
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
        ele: lastmonthlistDay.monthEleNum || 0,
        cost: lastmonthlistDay.monthEleCost || 0,
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

  disconnectedCallback() {
    super.disconnectedCallback(); 
    if (this._chart) {
      this._chart.destroy();
      this._chart = null;
    }
  }
} 
customElements.define('state-grid-chart-month', StateGridChartMonth);

class StateGridPhone extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object },
      selectedDate: { type: String },
      todayDate: { type: String }
    };
  }

  setConfig(config) {
    this.config = {
      entity: config?.entity || 'sensor.state_grid',
      theme: config?.theme || 'on',
      width: config?.width || '100%',
      height: config?.height || '300px',
      showIcon: config.icon !=='none',
      cardheight: config?.cardheight || '35px',
      color_num: config?.color_num || '#0fccc3',
      color_cost: config?.color_cost || '#804aff',
      ...config
    }; 
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
    return html`
      <div class="card-container" style="width: ${this.config.width};">
        <state-grid-table 
          .hass=${this.hass}
          .config=${this.config}
					.entity=${this.config.entity}
          .width=${this.config.width}
          .height=${bodyHeight}
          .icon=${this.config.icon}
          .colorNum=${config.color_num}
          .colorCost=${config.color_cost}
          .cardwidth=${config.cardwidth}
          .cardheight=${config.cardheight}>
        </state-grid-table>
        <state-grid-calendar 
          .hass=${this.hass}
          .config=${this.config}
					.entity=${this.config.entity}
          .width=${this.config.width}
          .height=${bodyHeight}
          .colorNum=${config.color_num}
          .colorCost=${config.color_cost}>
        </state-grid-calendar>
        <state-grid-chart-day 
          .hass=${this.hass}
          .config=${this.config}
					.entity=${this.config.entity}
          .width=${this.config.width}
          .height=${bodyHeight}
          .colorNum=${config.color_num}
          .colorCost=${config.color_cost}>
        </state-grid-chart-day>
        <state-grid-chart-month 
          .hass=${this.hass}
          .config=${this.config}
					.entity=${this.config.entity}
          .width=${this.config.width}
          .height=${bodyHeight}
          .colorNum=${config.color_num}
          .colorCost=${config.color_cost}>
        </state-grid-chart-month>
      </div>
    `;
  }
}
customElements.define('state-grid-phone', StateGridPhone);

class StateGridPad extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object },
    };
  }

  setConfig(config) {
    this.config = {
      entity: config?.entity || 'sensor.state_grid',
      theme: config?.theme || 'on',
      width: config?.width || '380px',
      height: config?.height || '300px',
      showIcon: config.icon !=='none',
      cardheight: config?.cardheight || '35px',
      color_num: config?.color_num || '#0fccc3',
      color_cost: config?.color_cost || '#804aff',
      ...config
    };
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
        grid-template-columns: 380px 380px;
        grid-template-rows: 300px 300px;
        width: 770px;
        height: 610px;
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
    `;
  }

  render() {
    if (!this.hass) {
      return html`<div>Loading...</div>`;
    }

    const config = {
      ...this.config
    };

    return html`
      <div class="grid-container">
        <div class="grid-item a">
          <state-grid-table
            .hass=${this.hass}
            .config=${config}
						.entity=${this.config.entity}
            .icon=${this.config.icon}
            .colorNum=${config.color_num}
            .colorCost=${config.color_cost}
            .cardwidth=${config.cardwidth}
            .cardheight=${config.cardheight}>
          </state-grid-table>
        </div>
        <div class="grid-item b">
          <state-grid-calendar
            .hass=${this.hass}
            .config=${config}
						.entity=${this.config.entity}
            .colorNum=${config.color_num}
            .colorCost=${config.color_cost}>
          </state-grid-calendar>
        </div>
        <div class="grid-item c">
          <state-grid-chart-day
            .hass=${this.hass}
            .config=${config}
						.entity=${this.config.entity}
            .colorNum=${config.color_num}
            .colorCost=${config.color_cost}>
          </state-grid-chart-day>
        </div>
        <div class="grid-item d">
          <state-grid-chart-month
            .hass=${this.hass}
            .config=${config}
						.entity=${this.config.entity}
            .colorNum=${config.color_num}
            .colorCost=${config.color_cost}>
          </state-grid-chart-month>
        </div>
      
      </div>
    `;
  }
}
customElements.define('state-grid-pad', StateGridPad);

window.customCards = window.customCards || [];
window.customCards.push(
  {
    type: 'state-grid-table',
    name: '国网卡片:表格',
    description: '国网表格',
    preview: true
  },
  {
    type: 'state-grid-calendar',
    name: '国网卡片:日历',
    description: '国网日历',
    preview: true
  },
  {
    type: 'state-grid-chart-day',
    name: '国网卡片:日图表',
    description: '国网日图表',
    preview: true
  },
  {
    type: 'state-grid-chart-month',
    name: '国网卡片:月图表',
    description: '国网月图表',
    preview: true
  },
  {
    type: 'state-grid-phone',
    name: '国网卡片:手机端',
    description: '国网手机端UI',
    preview: true
  },
  {
    type: 'state-grid-pad',
    name: '国网卡片:平板端',
    description: '国网平板端UI',
    preview: true
  }
);
 