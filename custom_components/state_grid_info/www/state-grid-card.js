console.info("%c 国网信息卡 \n%c   v 2.6   ", "color: red; font-weight: bold; background: black", "color: white; font-weight: bold; background: black");
import { LitElement, html, css } from "https://unpkg.com/lit-element@2.4.0/lit-element.js?module";
import tinycolor from "./tinycolor.js";

class StateGridPhoneEditor extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object },
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
        width: var(--editor-width, 100%);
        max-width: 100%;
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

      .input-wrapper {
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
        padding-top: 6px;
        margin-top: 6px;
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

    const editorWidth = this.config.width || '100%';

    return html`
      <div class="form" style="--editor-width: ${editorWidth}">

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
          <label>卡片宽度：
            <input 
              type="text" 
              @change=${this._valueChanged}
              .value=${this.config.width !== undefined ? this.config.width : '100%'}
              name="width"
              placeholder="例如: 100%, 300px"
            />
          </label>
        </div>

        <div class="form-group">
            <label class="color-input-wrapper">用电量数据颜色：
              <input 
                type="color" 
                @change=${this._valueChanged}
                .value=${this.config.color_num !== undefined ? this.config.color_num : '#08b3a5'}
                name="color_num"
                class="color-input"
              />
              <input 
                type="text" 
                @change=${this._valueChanged}
                .value=${this.config.color_num !== undefined ? this.config.color_num : '#08b3a5'}
                name="color_num"
                class="color-text"
                placeholder="#08b3a5"
              />
          </label>
        </div>

        <div class="form-group">
          <label class="color-input-wrapper">用电费数据颜色：
            <input 
              type="color" 
              @change=${this._valueChanged}
              .value=${this.config.color_cost !== undefined ? this.config.color_cost : '#770ef6'}
              name="color_cost"
              class="color-input"
            />
            <input 
              type="text" 
              @change=${this._valueChanged}
              .value=${this.config.color_cost !== undefined ? this.config.color_cost : '#770ef6'}
              name="color_cost"
              class="color-text"
              placeholder="#770ef6"
            />
            </label>
        </div>

        <!-- 余额实体配置 -->
        <div class="balance-entity-section">
          <div class="form-group">
            <label> 国网信息标题：</label>
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
            <label  class="input-wrapper">全局预警条件</label>
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





  async firstUpdated() {
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.balance-entity-section')) {
        this._showBalanceEntityList = false;
        this.requestUpdate();
      }
    });
    await this._loadApexCharts();
    this._renderDayChart();
    this._renderMonthChart();
  }

  constructor() {
    super();
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

class StateGridInfo extends LitElement {
  static getConfigElement() {
    return document.createElement("xiaoshi-state-grid-editor");
  }

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
      config: { type: Object },
      showPanel: { type: String },
      selectedDate: { type: String },
      todayDate: { type: String },
      _balanceData: { type: Array },
      _balanceLoading: { type: Boolean },
      _balanceRefreshInterval: { type: Number },
      _selectedBalanceEntity: { type: String }
    };
  }

  setConfig(config) {
    this.config = config;
    if (config) {
      if (config.width !== undefined) this.width = config.width;
      if (config.year !== undefined) this.year = config.year;
      if (config.month !== undefined) this.month = config.month;
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
    this.width = '';
    this.theme = 'on';
    this.dayData = [];
    this.activeNav = '';
    this.monthData = null;
    this.colorNum = '#08b3a5';
    this.colorCost = '#770ef6';
    this.showPanel = ''; // 初始不显示任何面板
    this._balanceData = [];
    this._balanceLoading = false;
    this._balanceRefreshInterval = null;
    this._selectedBalanceEntity = '';
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
    if (this._chart) {
      this._chart.destroy();
      this._chart = null;
    }
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    
    // 监听_selectedBalanceEntity的变化，立即触发更新
    if (changedProperties.has('_selectedBalanceEntity')) {
      // 立即请求更新，确保子组件收到新的entity
      this.requestUpdate();
      this._renderDayChart();
      this._renderMonthChart();
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
      
      .card-header{
        border-radius: 10px;
        padding: 10px;
      }

      .card-main{
        border-radius: 10px;
        padding: 10px;
        padding-bottom: 0px;
        margin-top: 5px;
        margin-bottom: 0px;
      }

      .card-container {
        height: 100%;
        display: flex;
        flex-direction: column;
      }
      
      .top-section {
        display: grid;
        grid-template-columns: 33% 66.66%;
        gap: 8px;
        margin-bottom: 8px;
        height: 100%;
        align-items: end;
      }
      
      .balance-section {
        display: flex;
        flex-direction: column;
        align-items: center;
        height: 100%;
        justify-content: space-between;
      }
      
      .top-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 100%;
        flex-shrink: 0;
      }
      
      .spacer {
        flex: 1;
        width: 100%;
        min-height: 0px;
        height: auto;
      }

      .balance-icon {
        width: 80px;
        height: 80px;
        margin-bottom: 12px;
        margin-top: 10px;
        border-radius: 6px;
      }
      
      .balance-time {
        font-size: 10px;
        opacity: 0.8;
        margin-top: -7px;
        margin-bottom: 4px;
        text-align: center;
      }
      
      .balance-controls-container {
        display: flex;
        flex-direction: column;
        gap: 6px;
        width: 100%;
      }

      .balance-info {
        border-radius: 6px;
        text-align: center;
        flex: 0 0 auto;
        width: 100%;
        height: 40px;
        line-height: 20px;
      }
      
      .balance-amount {
        font-size: 15px;
        font-weight: bold;
        margin-top: 1px;
        white-space: nowrap;
      }
      
      .balance-amount .currency {
        font-size: 10px;
      }
      
      .balance-label {
        font-size: 10px;
        margin-top: -1px;
        opacity: 0.9;
      }
      
      .days-info {
        border-radius: 6px;
        text-align: center;
        flex: 0 0 auto;
        width: 100%;
        height: 40px;
        line-height: 20px;
      }
      
      .days-amount {
        font-size: 15px;
        font-weight: bold;
        white-space: nowrap;
        margin-top: 1px;
      }

      .days-amount .currency {
        font-size: 10px;
      }
      
      .days-label {
        font-size: 10px;
        margin-top: -1px;
        opacity: 0.9;
      }
      
      .action-buttons {
        display: flex;
        gap: 7px;
        padding: 0;
        width: 100%;
        justify-content: center;
      }
      
      .action-button {
        border-radius: 6px;
        font-size: 10px;
        color: white;
        cursor: pointer;
        transition: all 0.2s ease;
        text-align: center;
        font-weight: 500;
        flex: 1;
        max-width: 33.33%;
        height: 39px;
        line-height: 39px;
        white-space: nowrap;
      }
      
      .action-button.active {
        background: rgba(0, 160, 160, 0.8) !important;
        color: #00ffff;
        font-weight: bold;
      }
      
      .action-button:hover {
        background: rgba(160, 160, 160, 0.6) !important;
      }
      
      .action-button.active:hover {
        background: rgba(0, 160, 160, 0.6) !important;
      }
      
      .panel-section {
        animation: slideIn 0.3s ease-out;
        margin-top: 0px;
      }
      
      @keyframes slideIn {
        from {
          opacity: 0;
          transform: translateY(-10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      
      .right-section {
        display: flex;
        flex-direction: column;
        gap: 6px;
        height: 100%;
      }
      
      .price-area {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
      }
      
      .price-section {
        border-radius: 8px;
        padding: 12px;
        text-align: center;
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: center;
      }
      
      .price-title {
        font-size: 14px;
        font-weight: bold;
        margin-bottom: 8px;
        color: white;
      }
      
      .price-value {
        font-size: 18px;
        font-weight: bold;
        color: #00ffff;
      }
      
      .price-details {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      
      .price-item {
        font-size: 12px;
        color: white;
        opacity: 0.9;
      }
      
      .ladder-area {
        flex: 1;
        overflow: hidden;
      }
      
      .usage-grid {
        flex: 2;
        display: grid;
        grid-template-columns: 1fr 1fr;
        grid-template-rows: 1fr 1fr;
        gap: 6px;
      }
      
      .middle-section {
        height: 40%;
        margin-bottom: 8px;
      }
      
      .bottom-section {
        padding-top: 7px;
        height: 35%;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .ladder-section {
        border-radius: 8px;
        padding: 9px 5px;
        margin: 0px 0px;
        min-height: 95px;
      }
      
      .ladder-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 4px;
        opacity: 0.8;
        font-weight: bold;
        text-align: start;
        font-size: 10px;
      }
      
      .ladder-progress {
        position: relative;
        height: 16px;
        border-radius: 6px;
        margin: 25px 0 4px 0;
        overflow: visible;
      }
      
      .progress-segment {
        position: absolute;
        height: 100%;
        transition: width 0.3s ease;
      }
      
      .progress-segment.level1 {
        background: #4CAF50;
        left: 0;
        width: calc(33.33% + 6px) !important;
        border-radius: 3px 0 0 3px;
        clip-path: polygon(0 0, calc(100% - 6px) 0, 100% 50%, calc(100% - 6px) 100%, 0 100%);
        z-index: 3;
      }
      
      .progress-segment.level2 {
        background: #FFC107;
        left: 33.33%;
        width: calc(33.33% + 6px) !important;
        clip-path: polygon(0 0, calc(100% - 6px) 0, 100% 50%, calc(100% - 6px) 100%, 0 100%);
        z-index: 2;
      }
      
      .progress-segment.level3 {
        background: #FF5722;
        left: 66.66%;
        width: 33.34% !important;
        border-radius: 0 3px 3px 0;
        z-index: 1;
      }
      
      .progress-bubble {
        position: absolute;
        top: -25px;
        transform: translateX(-50%);
        color: white;
        padding: 4px 6px;
        border-radius: 10px;
        font-size: 9px;
        font-weight: bold;
        white-space: nowrap;
        text-align: center;
        line-height: 1.2;
      }
      
      .progress-bubble-arrow {
        position: absolute;
        bottom: 20px;
        transform: translateX(-50%);
        width: 0;
        height: 0;
        border-left: 4px solid transparent;
        border-right: 4px solid transparent;
        border-top: 4px solid;
        border-top-color: inherit;
        z-index: 6;
      }
      
      .progress-indicator {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 3px;
        border-radius: 3px;
        transform: translateX(-50%);
        z-index: 14;
      }
      
      .progress-labels {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        align-items: center;
        justify-content: space-around;
        pointer-events: none;
        z-index: 5;
      }
      
      .progress-label {
        font-size: 8px;
        color: white;
        font-weight: bold;
        text-align: center;
      }

      .ladder-price-section {
        display: flex;
        justify-content: space-between;
        gap: 2px;
        margin-top: 0px;
      }
      
      .price-block {
        flex: 1;
        padding: 2px 4px;
        border-radius: 4px;
        font-size: 8px;
        text-align: center;
      }
      
      .level1-price {
        background: rgba(76, 175, 80, 0.15);
      }
      
      .level2-price {
        background: rgba(255, 193, 7, 0.15);
      }
      
      .level3-price {
        background: rgba(255, 87, 34, 0.15);
      }
      
      .price-range {
        font-weight: bold;
        margin-bottom: 2px;
        font-size: 9px;
      }
      
      .price-item-block {
        margin: 2px 0;
        font-size: 8px;
        line-height: 1.2;
        white-space: nowrap;
      }
      
      .usage-section {
        text-align: center;
        padding: 4px;
        border-radius: 6px;
        display: flex;
        flex-direction: column;
        justify-content: center;
      }
      
      .usage-title {
        font-size: 10px;
        margin-bottom: 6px;
        opacity: 0.8;
        font-weight: bold;
        text-align: start;
      }
      
      .usage-amount {
        font-size: 10px;
        font-weight: bold;
        display: flex;
        align-items: center;
        position: relative;
        margin-bottom: 8px;
      }
      
      .usage-electricity {
        position: absolute;
        left: 0;
        text-align: left;
      }
      
      .usage-cost {
        position: absolute;
        left: 50%;
        text-align: left;
      }
      
      .usage-bar {
        height: 14px;
        border-radius: 2px;
        margin-bottom: 2px;
        overflow: hidden;
      }
      
      .usage-bar-fill {
        height: 100%;
        display: flex;
        position: relative;
      }
      
      .usage-bar-text {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        font-size: 9px;
        color: white;
        font-weight: bold;
        white-space: nowrap;
        z-index: 1;
      }
      
      .usage-bar-text.tip {
        left: 0;
        width: var(--tip-width, 0);
        text-align: center;
      }
      
      .usage-bar-text.peak {
        left: var(--tip-width, 0);
        width: var(--peak-width, 0);
        text-align: center;
      }
      
      .usage-bar-text.normal {
        left: calc(var(--tip-width, 0) + var(--peak-width, 0));
        width: var(--normal-width, 0);
        text-align: center;
      }
      
      .usage-bar-text.valley {
        left: calc(var(--tip-width, 0) + var(--peak-width, 0) + var(--normal-width, 0));
        width: var(--valley-width, 0);
        text-align: center;
      }
      
      .usage-bar-segment {
        height: 100%;
      }
      
      .usage-labels {
        position: relative;
        height: 12px;
        font-size: 8px;
        background: transparent;
      }
      
      .usage-label {
        position: absolute;
        top: 0;
        font-weight: bold;
        color: white;
        background: transparent;
      }
      
      .usage-label.tip {
        left: 0;
        width: var(--tip-width, 0);
        text-align: center;
      }
      
      .usage-label.peak {
        left: var(--tip-width, 0);
        width: var(--peak-width, 0);
        text-align: center;
      }
      
      .usage-label.normal {
        left: calc(var(--tip-width, 0) + var(--peak-width, 0));
        width: var(--normal-width, 0);
        text-align: center;
      }
      
      .usage-label.valley {
        left: calc(var(--tip-width, 0) + var(--peak-width, 0) + var(--normal-width, 0));
        width: var(--valley-width, 0);
        text-align: center;
      }
      
      .usage-bar-segment.tip { background: #E91E63; }
      .usage-bar-segment.peak { background: #FF9800; }
      .usage-bar-segment.normal { background: #8BC34A; }
      .usage-bar-segment.valley { background: #00BCD4; }
    
    /*
     * 日历部分  *
     *          */

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
        padding: 10px 4px;
        margin-top: 5px;
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
        border-bottom: 0.5px solid rgb(150,150,150,0.8);
        border-right: 0.5px solid  rgb(150,150,150,0.8);
      }
      .month-cell-left {
        border-left: 0.5px solid  rgb(150,150,150,0.8);
      }
      .month-cell-top {
        border-top: 0.5px solid  rgb(150,150,150,0.8);
      }
      .month-cell-right {
        border-right: 0.5px solid  rgb(150,150,150,0.8);
      }
      .month-cell-bottom {
        border-bottom: 0.5px solid rgb(150,150,150,0.8);
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
      
      /* 表头信息 */

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

      /*每日条形图*/
      .card-chart {
        border: 0;
        border-radius: 10px;
        display: grid;
        grid-template-rows: 20% 80%;
        grid-template-columns: 1fr 1fr;
        grid-template-areas: 
          "label1 label2"
          "chart chart";
        gap: 0px;
        padding: 8px;
        margin-top: 5px;
        height: 300px;
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

     `;
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

  get _processedDayData() {
    const selectedEntityId = this._selectedBalanceEntity;
    if (!selectedEntityId || !this.hass || !this.hass.states[selectedEntityId]) {
      return {};
    }
    
    const selectedEntity = this.hass.states[selectedEntityId];

    if (!selectedEntity?.attributes?.daylist) return null; 
    const daylist = selectedEntity.attributes.daylist.slice(0, 30);
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

  get _processedMonthData() {    
    const selectedEntityId = this._selectedBalanceEntity;
    if (!selectedEntityId || !this.hass || !this.hass.states[selectedEntityId]) {
      return {};
    }
    
    const selectedEntity = this.hass.states[selectedEntityId];

    const lastYear  = (new Date().getFullYear() - 1).toString();
    const currentYear = new Date().getFullYear().toString();

    if (!selectedEntity?.attributes?.monthlist) return null;
    // 确保数据安全，处理可能为空的情况
    const lastYearBills = selectedEntity.attributes.monthlist.filter(item => 
      item?.month && item.month.startsWith(lastYear)
    ) || [];
    const thisYearBills = selectedEntity.attributes.monthlist.filter(item => 
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

  _renderDayChart() {
    const container = this.renderRoot.querySelector('#chart-container');
    if (!container) return;
    const data = this._processedDayData;
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
    this._chart = new ApexCharts(container, this._getChartDayConfig(data));
    this._chart.render();
  }

  _renderMonthChart() {
    const container = this.renderRoot.querySelector('#chart-container');
    if (!container) return;
    const data = this._processedMonthData;
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
    this._chart = new ApexCharts(container, this._getChartMonthConfig(data));
    this._chart.render();
  }

  _loadData() {
    // 重新渲染图表，数据会在中通过
    this._renderDayChart();
    this._renderMonthChart();
  }


  _getChartDayConfig(data) {
    const theme = this._evaluateTheme();
    const width = this.config.width ? `${parseFloat(this.config.width) * 0.97}${this.config.width.replace(/[0-9.]/g, '')}` : '95vw';
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
        height: 210,
        width: width,
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

  _getChartMonthConfig(data) {
    const theme = this._evaluateTheme();
    const width = this.config.width ? `${parseFloat(this.config.width) * 0.97}${this.config.width.replace(/[0-9.]/g, '')}` : '95vw';
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
        height: 210,
        width: width,
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
          width: 9,
          height: 10,
          radius: 5
        },
        itemMargin: {
          horizontal: 10
        }
      }
    };
  }

  /*获取当前月份的字符串格式 (YYYY-MM)*/
  getCurrentMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  /*处理跨年的情况，如1月份的上个月是上一年的12月*/
  getPreviousMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    if (month === 0) {
      return `${year - 1}-12`;
    }
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  /*分析最近3个月的用电数据，根据尖平谷的用电量判断有哪些类型在使用*/
  getElectricityType(monthList) {
    if (!monthList || monthList.length === 0) return null;
    
    const last3Months = monthList.slice(0,3);
    const totals = {
      tip: 0, peak: 0, normal: 0, valley: 0
    };
    
    last3Months.forEach(month => {
      totals.tip += month.monthTPq || 0;
      totals.peak += month.monthPPq || 0;
      totals.normal += month.monthNPq || 0;
      totals.valley += month.monthVPq || 0;
      
    });
    const types = [];
    if (totals.tip > 0) types.push('tip');
    if (totals.peak > 0) types.push('peak');
    if (totals.normal > 0) types.push('normal');
    if (totals.valley > 0) types.push('valley');

    return types.length > 0 ? types : null;
  }

  /* 根据计费标准和用电类型获取对应的电价信息
   * 支持6种不同的计费标准：年阶梯峰平谷、年阶梯、月阶梯峰平谷、月阶梯峰平谷变动价格、月阶梯、平均单价*/
  getElectricityPrices(billingStandard, currentLevel, electricityTypes) {
    // 使用选中的余额实体而不是固定的this.entity
    const selectedEntityId = this._selectedBalanceEntity;
    if (!selectedEntityId || !this.hass || !this.hass.states[selectedEntityId]) {
      return {};
    }
    
    const selectedEntity = this.hass.states[selectedEntityId];
    const prices = {};
    if (!electricityTypes || electricityTypes.length === 0) return prices;
    
    electricityTypes.forEach(type => {
      const levelKey = `第${currentLevel}档`;
      switch (billingStandard) {
        case '年阶梯峰平谷':
          if (type === 'tip') prices.tip = selectedEntity.attributes.计费标准[`年阶梯第${currentLevel}档尖电价`];
          if (type === 'peak') prices.peak = selectedEntity.attributes.计费标准[`年阶梯第${currentLevel}档峰电价`];
          if (type === 'normal') prices.normal = selectedEntity.attributes.计费标准[`年阶梯第${currentLevel}档平电价`];
          if (type === 'valley') prices.valley = selectedEntity.attributes.计费标准[`年阶梯第${currentLevel}档谷电价`];
          break;
        case '年阶梯':
          prices.single = selectedEntity.attributes.计费标准[`年阶梯第${currentLevel}档电价`];
          break;
        case '月阶梯峰平谷':
          if (type === 'tip') prices.tip = selectedEntity.attributes.计费标准[`月阶梯第${currentLevel}档尖电价`];
          if (type === 'peak') prices.peak = selectedEntity.attributes.计费标准[`月阶梯第${currentLevel}档峰电价`];
          if (type === 'normal') prices.normal = selectedEntity.attributes.计费标准[`月阶梯第${currentLevel}档平电价`];
          if (type === 'valley') prices.valley = selectedEntity.attributes.计费标准[`月阶梯第${currentLevel}档谷电价`];
          break;
        case '月阶梯峰平谷变动价格':
          if (type === 'tip') prices.tip = selectedEntity.attributes.计费标准[`月阶梯第${currentLevel}档尖电价`];
          if (type === 'peak') prices.peak = selectedEntity.attributes.计费标准[`月阶梯第${currentLevel}档峰电价`];
          if (type === 'normal') prices.normal = selectedEntity.attributes.计费标准[`月阶梯第${currentLevel}档平电价`];
          if (type === 'valley') {
            const currentMonth = new Date().getMonth() + 1;
            const monthKey = `${currentMonth}月`;
            prices.valley = selectedEntity.attributes.计费标准[`${monthKey}阶梯第${currentLevel}档谷电价`];
          }
          break;
        case '月阶梯':
          prices.single = selectedEntity.attributes.计费标准[`月阶梯第${currentLevel}档电价`];
          break;
        case '平均单价':
          prices.single = selectedEntity.attributes.计费标准.平均单价;
          break;
      }
    });
    
    return prices;
  }

  /*从月度用电数据列表中查找指定月份的数据 */
  getMonthUsage(monthList, targetMonth) {
    if (!monthList) return null;
    return monthList.find(item => item.month === targetMonth);
  }

  /*从年度用电数据列表中查找指定年份的数据*/
  getYearUsage(yearList, targetYear) {
    if (!yearList) return null;
    return yearList.find(item => item.year === targetYear.toString());
  }

 /*渲染日度用电条形图*/
  renderDayBar(usage) {
    const theme = this._evaluateTheme();
    const Color = theme === 'on' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
    const Shadow = theme === 'on' ? '0 1px 2px rgba(255, 255, 255, 0.3)' : '0 1px 2px rgba(47, 45, 45, 0.6)';

    const total = usage.dayTPq + usage.dayPPq + usage.dayNPq + usage.dayVPq;
    if (total === 0) return '';
    
    // 计算各类型百分比
    const tipPercent = (usage.dayTPq / total) * 100;
    const peakPercent = (usage.dayPPq / total) * 100;
    const normalPercent = (usage.dayNPq / total) * 100;
    const valleyPercent = (usage.dayVPq / total) * 100;
    
    // 计算累积位置
    const tipAccum = tipPercent;
    const peakAccum = tipAccum + peakPercent;
    const normalAccum = peakAccum + normalPercent;
    
    const segments = [];
    if (usage.dayTPq > 0) {
      segments.push(html`<div class="usage-bar-segment tip" style="width: ${tipPercent}%"></div>`);
    }
    if (usage.dayPPq > 0) {
      segments.push(html`<div class="usage-bar-segment peak" style="width: ${peakPercent}%"></div>`);
    }
    if (usage.dayNPq > 0) {
      segments.push(html`<div class="usage-bar-segment normal" style="width: ${normalPercent}%"></div>`);
    }
    if (usage.dayVPq > 0) {
      segments.push(html`<div class="usage-bar-segment valley" style="width: ${valleyPercent}%"></div>`);
    }
    
    const texts = [];
    if (usage.dayTPq > 0) {
      texts.push(html`<div class="usage-bar-text tip" style="color: ${Color}; text-shadow: ${Shadow}; --tip-width: ${tipPercent}%; left: 0;">${usage.dayTPq}</div>`);
    }
    if (usage.dayPPq > 0) {
      texts.push(html`<div class="usage-bar-text peak" style="color: ${Color}; text-shadow: ${Shadow}; --tip-width: ${tipPercent}%; --peak-width: ${peakPercent}%; left: calc(${tipPercent}%);">${usage.dayPPq}</div>`);
    }
    if (usage.dayNPq > 0) {
      texts.push(html`<div class="usage-bar-text normal" style="color: ${Color}; text-shadow: ${Shadow}; --tip-width: ${tipPercent}%; --peak-width: ${peakPercent}%; --normal-width: ${normalPercent}%; left: calc(${tipPercent}% + ${peakPercent}%);">${usage.dayNPq}</div>`);
    }
    if (usage.dayVPq > 0) {
      texts.push(html`<div class="usage-bar-text valley" style="color: ${Color}; text-shadow: ${Shadow}; --tip-width: ${tipPercent}%; --peak-width: ${peakPercent}%; --normal-width: ${normalPercent}%; --valley-width: ${valleyPercent}%; left: calc(${tipPercent}% + ${peakPercent}% + ${normalPercent}%);">${usage.dayVPq}</div>`);
    }
    
    const labels = [];
    if (usage.dayTPq > 0) labels.push(html`<div class="usage-label tip" style="color: ${Color}; text-shadow: ${Shadow};--tip-width: ${tipPercent}%; left: 0;">尖</div>`);
    if (usage.dayPPq > 0) labels.push(html`<div class="usage-label peak" style="color: ${Color}; text-shadow: ${Shadow};--tip-width: ${tipPercent}%; --peak-width: ${peakPercent}%; left: calc(${tipPercent}%);">峰</div>`);
    if (usage.dayNPq > 0) labels.push(html`<div class="usage-label normal" style="color: ${Color}; text-shadow: ${Shadow};--tip-width: ${tipPercent}%; --peak-width: ${peakPercent}%; --normal-width: ${normalPercent}%; left: calc(${tipPercent}% + ${peakPercent}%);">平</div>`);
    if (usage.dayVPq > 0) labels.push(html`<div class="usage-label valley" style="color: ${Color}; text-shadow: ${Shadow};--tip-width: ${tipPercent}%; --peak-width: ${peakPercent}%; --normal-width: ${normalPercent}%; --valley-width: ${valleyPercent}%; left: calc(${tipPercent}% + ${peakPercent}% + ${normalPercent}%);">谷</div>`);
    
    return html`
      <div class="usage-bar">
        <div class="usage-bar-fill">
          ${segments}
          ${texts}
        </div>
      </div>
      <div class="usage-labels">${labels}</div>
    `;
  }

  /*渲染月度用电条形图*/
  renderUsageBar(usage) {
    const theme = this._evaluateTheme();
    const Color = theme === 'on' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
    const Shadow = theme === 'on' ? '0 1px 2px rgba(255, 255, 255, 0.3)' : '0 1px 2px rgba(50, 50, 50, 0.6)';

    const total = usage.monthTPq + usage.monthPPq + usage.monthNPq + usage.monthVPq;
    if (total === 0) return '';
    
    // 计算各类型百分比
    const tipPercent = (usage.monthTPq / total) * 100;
    const peakPercent = (usage.monthPPq / total) * 100;
    const normalPercent = (usage.monthNPq / total) * 100;
    const valleyPercent = (usage.monthVPq / total) * 100;
    
    // 计算累积位置
    const tipAccum = tipPercent;
    const peakAccum = tipAccum + peakPercent;
    const normalAccum = peakAccum + normalPercent;
    
    const segments = [];
    if (usage.monthTPq > 0) {
      segments.push(html`<div class="usage-bar-segment tip" style="width: ${tipPercent}%"></div>`);
    }
    if (usage.monthPPq > 0) {
      segments.push(html`<div class="usage-bar-segment peak" style="width: ${peakPercent}%"></div>`);
    }
    if (usage.monthNPq > 0) {
      segments.push(html`<div class="usage-bar-segment normal" style="width: ${normalPercent}%"></div>`);
    }
    if (usage.monthVPq > 0) {
      segments.push(html`<div class="usage-bar-segment valley" style="width: ${valleyPercent}%"></div>`);
    }
    
    const texts = [];
    if (usage.monthTPq > 0) {
      texts.push(html`<div class="usage-bar-text tip" style="color: ${Color}; text-shadow: ${Shadow};--tip-width: ${tipPercent}%; left: 0;">${usage.monthTPq}</div>`);
    }
    if (usage.monthPPq > 0) {
      texts.push(html`<div class="usage-bar-text peak" style="color: ${Color}; text-shadow: ${Shadow};--tip-width: ${tipPercent}%; --peak-width: ${peakPercent}%; left: calc(${tipPercent}%);">${usage.monthPPq}</div>`);
    }
    if (usage.monthNPq > 0) {
      texts.push(html`<div class="usage-bar-text normal" style="color: ${Color}; text-shadow: ${Shadow};--tip-width: ${tipPercent}%; --peak-width: ${peakPercent}%; --normal-width: ${normalPercent}%; left: calc(${tipPercent}% + ${peakPercent}%);">${usage.monthNPq}</div>`);
    }
    if (usage.monthVPq > 0) {
      texts.push(html`<div class="usage-bar-text valley" style="color: ${Color}; text-shadow: ${Shadow};--tip-width: ${tipPercent}%; --peak-width: ${peakPercent}%; --normal-width: ${normalPercent}%; --valley-width: ${valleyPercent}%; left: calc(${tipPercent}% + ${peakPercent}% + ${normalPercent}%);">${usage.monthVPq}</div>`);
    }
    
    const labels = [];
    if (usage.monthTPq > 0) labels.push(html`<div class="usage-label tip" style="color: ${Color}; text-shadow: ${Shadow};--tip-width: ${tipPercent}%; left: 0;">尖</div>`);
    if (usage.monthPPq > 0) labels.push(html`<div class="usage-label peak" style="color: ${Color}; text-shadow: ${Shadow};--tip-width: ${tipPercent}%; --peak-width: ${peakPercent}%; left: calc(${tipPercent}%);">峰</div>`);
    if (usage.monthNPq > 0) labels.push(html`<div class="usage-label normal" style="color: ${Color}; text-shadow: ${Shadow};--tip-width: ${tipPercent}%; --peak-width: ${peakPercent}%; --normal-width: ${normalPercent}%; left: calc(${tipPercent}% + ${peakPercent}%);">平</div>`);
    if (usage.monthVPq > 0) labels.push(html`<div class="usage-label valley" style="color: ${Color}; text-shadow: ${Shadow};--tip-width: ${tipPercent}%; --peak-width: ${peakPercent}%; --normal-width: ${normalPercent}%; --valley-width: ${valleyPercent}%; left: calc(${tipPercent}% + ${peakPercent}% + ${normalPercent}%);">谷</div>`);
    
    return html`
      <div class="usage-bar">
        <div class="usage-bar-fill">
          ${segments}
          ${texts}
        </div>
      </div>
      <div class="usage-labels">${labels}</div>
    `;
  }

  /*渲染年度用电条形图*/
  renderYearUsageBar(usage) {
    const theme = this._evaluateTheme();
    const Color = theme === 'on' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
    const Shadow = theme === 'on' ? '0 1px 2px rgba(255, 255, 255, 0.3)' : '0 1px 2px rgba(50, 50, 50, 0.6)';
    const total = usage.yearTPq + usage.yearPPq + usage.yearNPq + usage.yearVPq;
    if (total === 0) return '';
    
    // 计算各类型百分比
    const tipPercent = (usage.yearTPq / total) * 100;
    const peakPercent = (usage.yearPPq / total) * 100;
    const normalPercent = (usage.yearNPq / total) * 100;
    const valleyPercent = (usage.yearVPq / total) * 100;
    
    const segments = [];
    if (usage.yearTPq > 0) {
      segments.push(html`<div class="usage-bar-segment tip" style="width: ${tipPercent}%"></div>`);
    }
    if (usage.yearPPq > 0) {
      segments.push(html`<div class="usage-bar-segment peak" style="width: ${peakPercent}%"></div>`);
    }
    if (usage.yearNPq > 0) {
      segments.push(html`<div class="usage-bar-segment normal" style="width: ${normalPercent}%"></div>`);
    }
    if (usage.yearVPq > 0) {
      segments.push(html`<div class="usage-bar-segment valley" style="width: ${valleyPercent}%"></div>`);
    }
    
    const texts = [];
    if (usage.yearTPq > 0) {
      texts.push(html`<div class="usage-bar-text tip" style="color: ${Color}; text-shadow: ${Shadow};--tip-width: ${tipPercent}%; left: 0;">${usage.yearTPq}</div>`);
    }
    if (usage.yearPPq > 0) {
      texts.push(html`<div class="usage-bar-text peak" style="color: ${Color}; text-shadow: ${Shadow};--tip-width: ${tipPercent}%; --peak-width: ${peakPercent}%; left: calc(${tipPercent}%);">${usage.yearPPq}</div>`);
    }
    if (usage.yearNPq > 0) {
      texts.push(html`<div class="usage-bar-text normal" style="color: ${Color}; text-shadow: ${Shadow};--tip-width: ${tipPercent}%; --peak-width: ${peakPercent}%; --normal-width: ${normalPercent}%; left: calc(${tipPercent}% + ${peakPercent}%);">${usage.yearNPq}</div>`);
    }
    if (usage.yearVPq > 0) {
      texts.push(html`<div class="usage-bar-text valley" style="color: ${Color}; text-shadow: ${Shadow};--tip-width: ${tipPercent}%; --peak-width: ${peakPercent}%; --normal-width: ${normalPercent}%; --valley-width: ${valleyPercent}%; left: calc(${tipPercent}% + ${peakPercent}% + ${normalPercent}%);">${usage.yearVPq}</div>`);
    }
    
    const labels = [];
    if (usage.yearTPq > 0) labels.push(html`<div class="usage-label tip" style="color: ${Color}; text-shadow: ${Shadow};--tip-width: ${tipPercent}%; left: 0;">尖</div>`);
    if (usage.yearPPq > 0) labels.push(html`<div class="usage-label peak" style="color: ${Color}; text-shadow: ${Shadow};--tip-width: ${tipPercent}%; --peak-width: ${peakPercent}%; left: calc(${tipPercent}%);">峰</div>`);
    if (usage.yearNPq > 0) labels.push(html`<div class="usage-label normal" style="color: ${Color}; text-shadow: ${Shadow};--tip-width: ${tipPercent}%; --peak-width: ${peakPercent}%; --normal-width: ${normalPercent}%; left: calc(${tipPercent}% + ${peakPercent}%);">平</div>`);
    if (usage.yearVPq > 0) labels.push(html`<div class="usage-label valley" style="color: ${Color}; text-shadow: ${Shadow};--tip-width: ${tipPercent}%; --peak-width: ${peakPercent}%; --normal-width: ${normalPercent}%; --valley-width: ${valleyPercent}%; left: calc(${tipPercent}% + ${peakPercent}% + ${normalPercent}%);">谷</div>`);
    
    return html`
      <div class="usage-bar">
        <div class="usage-bar-fill">
          ${segments}
          ${texts}
        </div>
      </div>
      <div class="usage-labels">${labels}</div>
    `;
  }

  /*渲染价格区块*/
  renderPriceBlock(prices, level) {
    // 使用选中的余额实体而不是固定的this.entity
    const selectedEntityId = this._selectedBalanceEntity;
    if (!selectedEntityId || !this.hass || !this.hass.states[selectedEntityId]) {
      return '';
    }
    
    const selectedEntity = this.hass.states[selectedEntityId];
    const electricityTypes = this.getElectricityType(selectedEntity.attributes.monthlist);
    const billingStandard = selectedEntity.attributes.计费标准?.计费标准;
    
    if (billingStandard === '平均单价') {


      return html`<div class="price-item-block">单价：${prices.single}元/度</div>`;
    }
    
    let blockPrices = {};
    if (electricityTypes) {
      electricityTypes.forEach(type => {
        switch (billingStandard) {
          case '年阶梯峰平谷':
            if (type === 'tip') blockPrices.tip = selectedEntity.attributes.计费标准[`年阶梯第${level}档尖电价`];
            if (type === 'peak') blockPrices.peak = selectedEntity.attributes.计费标准[`年阶梯第${level}档峰电价`];
            if (type === 'normal') blockPrices.normal = selectedEntity.attributes.计费标准[`年阶梯第${level}档平电价`];
            if (type === 'valley') blockPrices.valley = selectedEntity.attributes.计费标准[`年阶梯第${level}档谷电价`];
            break;
          case '年阶梯':
            blockPrices.single = selectedEntity.attributes.计费标准[`年阶梯第${level}档电价`];
            break;
          case '月阶梯峰平谷':
            if (type === 'tip') blockPrices.tip = selectedEntity.attributes.计费标准[`月阶梯第${level}档尖电价`];
            if (type === 'peak') blockPrices.peak = selectedEntity.attributes.计费标准[`月阶梯第${level}档峰电价`];
            if (type === 'normal') blockPrices.normal = selectedEntity.attributes.计费标准[`月阶梯第${level}档平电价`];
            if (type === 'valley') blockPrices.valley = selectedEntity.attributes.计费标准[`月阶梯第${level}档谷电价`];
            break;
          case '月阶梯峰平谷变动价格':
            if (type === 'tip') blockPrices.tip = selectedEntity.attributes.计费标准[`月阶梯第${level}档尖电价`];
            if (type === 'peak') blockPrices.peak = selectedEntity.attributes.计费标准[`月阶梯第${level}档峰电价`];
            if (type === 'normal') blockPrices.normal = selectedEntity.attributes.计费标准[`月阶梯第${level}档平电价`];
            if (type === 'valley') {
              const currentMonth = new Date().getMonth() + 1;
              const monthKey = `${currentMonth}月`;
              blockPrices.valley = selectedEntity.attributes.计费标准[`${monthKey}阶梯第${level}档谷电价`];
            }
            break;
          case '月阶梯':
            blockPrices.single = selectedEntity.attributes.计费标准[`月阶梯第${level}档电价`];
            break;
        }
      });
    }
    
    return html`
      ${blockPrices.single ? html`<div class="price-item-block">单价：${blockPrices.single}元/度</div>` : ''}
      ${blockPrices.tip ? html`<div class="price-item-block">尖单价：${blockPrices.tip}元/度</div>` : ''}
      ${blockPrices.peak ? html`<div class="price-item-block">峰单价：${blockPrices.peak}元/度</div>` : ''}
      ${blockPrices.normal ? html`<div class="price-item-block">平单价：${blockPrices.normal}元/度</div>` : ''}
      ${blockPrices.valley ? html`<div class="price-item-block">谷单价：${blockPrices.valley}元/度</div>` : ''}
    `;
  }

  /*按钮功能函数 - 电费日历*/
  showCalendar() {
    this.showPanel = this.showPanel === 'calendar' ? '' : 'calendar';
    this.updateDayData();
    this.requestUpdate();
    this._handleClick();
  }

  /*按钮功能函数 - 日用电*/
  async showDayUsage() {
    this.showPanel = this.showPanel === 'dayUsage' ? '' : 'dayUsage';
    this.requestUpdate();
    await this._loadApexCharts();
    this._renderDayChart();
    this._handleClick();
  }

  /*按钮功能函数 - 月用电*/
  async showMonthUsage() {
    this.showPanel = this.showPanel === 'monthUsage' ? '' : 'monthUsage';
    this.requestUpdate();
    await this._loadApexCharts();
    this._renderMonthChart();
    this._handleClick();
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

  /*日历功能函数*/
  updateDayData() {
    // 使用选中的余额实体而不是固定的this.entity
    const selectedEntityId = this._selectedBalanceEntity;
    if (this.hass && selectedEntityId) {
      const entityObj = this.hass.states[selectedEntityId];
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

  renderChartDay() {

    const data = this._processedDayData;
    const theme = this._evaluateTheme();
    const backgColor = theme === 'on' ? 'rgb(255, 255, 255)' : 'rgb(50, 50, 50)';
    const textColor = theme === 'on' ? 'rgba(0, 0, 0, 0.7)' : 'rgba(255, 255, 255, 0.7)';
    return html`
      <ha-card class="card-chart" style="; height: 300px; background: ${backgColor};">
        <div class="label label1">
          <div class="value" style="color: ${this.colorNum}">${data ? data.current.ele.toFixed(2) : '0.00'}
               <span class="unit"  style="color: ${textColor}">度</span>
          </div>
          <div class="title" style="color: ${textColor}">日用电量</div>
        </div>

        <div class="label label2">
          <div class="value" style="color: ${this.colorCost}">${data ? data.current.cost.toFixed(2) : '0.00'}
               <span class="unit" style="color: ${textColor}">元</span>
          </div>
          <div class="title" style="color: ${textColor}">日用电金额</div>
        </div>

        <div id="chart-container"></div>
      </ha-card>
    `;
  }

  renderChartMonth() {
    const data = this._processedMonthData;
    const theme = this._evaluateTheme();
    const backgColor = theme === 'on' ? 'rgb(255, 255, 255)' : 'rgb(50, 50, 50)';
    const textColor = theme === 'on' ? 'rgba(0, 0, 0, 0.7)' : 'rgba(255, 255, 255, 0.7)';
    return html`
      <ha-card class="card-chart" style="height: 300px; background: ${backgColor};">
        <div class="label label1">
          <div class="value" style="color: ${this.colorNum}">${data ? data.current.ele.toFixed(2) : '0.00'}
               <span class="unit"  style="color: ${textColor}">度</span>
          </div>
          <div class="title" style="color: ${textColor}">日用电量</div>
        </div>

        <div class="label label2">
          <div class="value" style="color: ${this.colorCost}">${data ? data.current.cost.toFixed(2) : '0.00'}
               <span class="unit" style="color: ${textColor}">元</span>
          </div>
          <div class="title" style="color: ${textColor}">日用电金额</div>
        </div>

        <div id="chart-container"></div>
      </ha-card>
    `;
  }

  renderHeader() {
    if (!this.hass) {
      return html`<div>Loading...</div>`;
    };
    
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
     ${this._balanceData.length > 1 ? html`
      <div class="card-container" style="width: ${this.config.width};">
        <!-- 国网信息卡片 -->
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
        </div>
      </div>
    ` : ''}
    `;
  }

  renderCalendar() {
    // 使用选中的余额实体而不是固定的this.entity
    const selectedEntityId = this._selectedBalanceEntity;
    if (!selectedEntityId || !this.hass || !this.hass.states[selectedEntityId]) {
      return html`<div style="padding: 20px; text-align: center;">请选择有效的国网实体</div>`;
    }
    
    const selectedEntity = this.hass.states[selectedEntityId];
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
      <div class="calendar-grid"  style="height: 280px; background-color: ${bgColor}; color: ${fgColor}; ">
        ${yearMonthRow}
        ${weekdaysRow}
        ${days}
        ${bottomRow}
      </div>
    `;
  }

  renderMain() {
    const theme = this._evaluateTheme();
    const Color = theme === 'on' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
    const Color2 = theme === 'on' ? 'rgb(0, 0, 0 ,0.7)' : 'rgb(255, 255, 255,0.7)';
    const BgColor = theme === 'on' ? 'rgb(255, 255, 255)' : 'rgb(50, 50, 50)';
    const BgColor2 = theme === 'on' ? 'rgb(150, 150, 150, 0.1)' : 'rgb(255, 255,255,0.1)';
    const Shadow = theme === 'on' ? '0 1px 2px rgba(255, 255, 255, 0.3)' : '0 1px 2px rgba(50, 50, 50, 0.6)';
    const svgpath = theme === 'on' ? '/state_grid_info-local/icon/state-grid-on.svg' : '/state_grid_info-local/icon/state-grid-off.svg';

    // 使用选中的余额实体而不是固定的this.entity
    const selectedEntityId = this._selectedBalanceEntity;
    if (!selectedEntityId || !this.hass || !this.hass.states[selectedEntityId]) {
      return html`<div>请选择有效的国网实体</div>`;
    }
    
    const selectedEntity = this.hass.states[selectedEntityId];
    
    const billingStandard = selectedEntity.attributes?.计费标准?.计费标准;
    const currentLevel = (!billingStandard || billingStandard === '平均单价') ? null : 
      (billingStandard?.includes('年阶梯') || false ? 
        selectedEntity.attributes.计费标准?.当前年阶梯档?.replace('第', '').replace('档', '') :
        selectedEntity.attributes.计费标准?.当前月阶梯档?.replace('第', '').replace('档', '')
      );
    
    const electricityTypes = this.getElectricityType(selectedEntity.attributes?.monthlist || []);
    const prices = currentLevel ? this.getElectricityPrices(billingStandard, currentLevel, electricityTypes) : {};
    
    // 渲染阶梯区域内容
    let ladderContent = '';
    if (selectedEntity.attributes && selectedEntity.attributes.计费标准) {
      if (billingStandard === '平均单价') {
        const averagePrice = selectedEntity.attributes.计费标准?.平均单价;
        ladderContent = html`
          <div class="ladder-section" style="background: ${BgColor2}">
            <div class="ladder-header">
              <span>平均单价</span>
              <span>${averagePrice}元/度</span>
            </div>
          </div>
        `;
      } else {
        const isYearLadder = billingStandard?.includes('年阶梯') || false;
        const ladderType = isYearLadder ? '年' : '月';
        const ladderTitle = isYearLadder ? '年用电阶梯' : '月用电阶梯';
        const currentLevel = selectedEntity.attributes.计费标准?.[`当前${ladderType}阶梯档`]?.replace('第', '').replace('档', '') || '1';
        const secondLevelStart = selectedEntity.attributes.计费标准?.[`${ladderType}阶梯第2档起始电量`];
        const thirdLevelStart = selectedEntity.attributes.计费标准?.[`${ladderType}阶梯第3档起始电量`];
        const totalUsage = selectedEntity.attributes.计费标准?.[`${ladderType}阶梯累计用电量`];
        
        let level1Width = 0, level2Width = 0, level3Width = 0;
        let displayLevel = 1;
        let bubblePosition = 0;
        
        if (totalUsage <= secondLevelStart) {
          level1Width = (totalUsage / secondLevelStart) * 100;
          bubblePosition = (totalUsage / secondLevelStart) * 33.33;
          displayLevel = 1;
        } else if (totalUsage <= thirdLevelStart) {
          level1Width = 100;
          level2Width = ((totalUsage - secondLevelStart) / (thirdLevelStart - secondLevelStart)) * 100;
          bubblePosition = 33.33 + ((totalUsage - secondLevelStart) / (thirdLevelStart - secondLevelStart)) * 33.33;
          displayLevel = 2;
        } else {
          level1Width = 100;
          level2Width = 100;
          level3Width = Math.min(((totalUsage - thirdLevelStart) / thirdLevelStart) * 100, 100);
          bubblePosition = 66.66 + Math.min(((totalUsage - thirdLevelStart) / thirdLevelStart) * 33.33, 33.34);
          displayLevel = 3;
        }
        
        // 限制气泡位置，防止超出边界
        const minPosition = 10; // 最小10%
        const maxPosition = 90; // 最大90%
        const constrainedBubblePosition = Math.max(minPosition, Math.min(maxPosition, bubblePosition));
        
        // 限制箭头位置，防止超出边界
        const minArrowPosition = 1; // 最小1%
        const maxArrowPosition = 99; // 最大99%
        const constrainedArrowPosition = Math.max(minArrowPosition, Math.min(maxArrowPosition, bubblePosition));
        
        const electricityTypes = this.getElectricityType(selectedEntity.attributes.monthlist);
        const prices = this.getElectricityPrices(billingStandard, currentLevel, electricityTypes);
        
        let periodInfo = '';
        if (isYearLadder) {
          periodInfo = `${selectedEntity.attributes.计费标准.当前年阶梯起始日期}-${selectedEntity.attributes.计费标准.当前年阶梯结束日期}`;
        }
        ladderContent = html`
          <div class="ladder-section" style="background: ${BgColor2}; color: ${Color2}; text-shadow: ${Shadow};">
            <div class="ladder-header" >
              <span>${ladderTitle} ${periodInfo ? `：${periodInfo}` : ''}</span>
            </div>
            <div class="ladder-progress">
              <div class="progress-segment level1" style="width: ${level1Width}%"></div>
              <div class="progress-segment level2" style="width: ${level2Width}%"></div>
              <div class="progress-segment level3" style="width: ${level3Width}%"></div>
              <div class="progress-indicator" style="background: ${Color}; left: ${bubblePosition}%"></div>
              <div class="progress-bubble" style="color: ${Color}; text-shadow: ${Shadow}; box-shadow: ${Shadow}; left: ${constrainedBubblePosition}%; background: ${displayLevel === 1 ? '#4CAF50' : displayLevel === 2 ? '#FFC107' : '#FF5722'}; border-top-color: ${displayLevel === 1 ? '#4CAF50' : displayLevel === 2 ? '#FFC107' : '#FF5722'};" data-level="${displayLevel}">第${displayLevel}阶梯  ${totalUsage}度</div>
              <div class="progress-bubble-arrow" style="left: ${constrainedArrowPosition}%; border-top-color: ${displayLevel === 1 ? '#4CAF50' : displayLevel === 2 ? '#FFC107' : '#FF5722'};"></div>
              <div class="progress-labels">
                <span class="progress-label level1-label" style="color: ${Color}; text-shadow: ${Shadow};">第1阶梯</span>
                <span class="progress-label level2-label" style="color: ${Color}; text-shadow: ${Shadow};">第2阶梯</span>
                <span class="progress-label level3-label" style="color: ${Color}; text-shadow: ${Shadow};">第3阶梯</span>
              </div>
            </div>

            <div class="ladder-price-section">
              <div class="price-block level1-price">
                <div class="price-range">0-${secondLevelStart}度</div>
                ${this.renderPriceBlock(prices, 1)}
              </div>
              <div class="price-block level2-price">
                <div class="price-range">${secondLevelStart}-${thirdLevelStart}度</div>
                ${this.renderPriceBlock(prices, 2)}
              </div>
              <div class="price-block level3-price">
                <div class="price-range">${thirdLevelStart}度以上</div>
                ${this.renderPriceBlock(prices, 3)}
              </div>
            </div>
          </div>
        `;
      }
    }
    
    // 渲染价格区域内容
    let priceContent = '';
    if (selectedEntity.attributes && selectedEntity.attributes.计费标准) {
      const billingStandard = selectedEntity.attributes.计费标准.计费标准;
      const currentLevel = (!billingStandard || billingStandard === '平均单价') ? null : 
        (billingStandard?.includes('年阶梯') || false ? 
          selectedEntity.attributes.计费标准?.当前年阶梯档?.replace('第', '').replace('档', '') :
          selectedEntity.attributes.计费标准?.当前月阶梯档?.replace('第', '').replace('档', '')
        );
      
      const electricityTypes = this.getElectricityType(selectedEntity.attributes?.monthlist || []);
      const prices = currentLevel ? this.getElectricityPrices(billingStandard, currentLevel, electricityTypes) : {};
      const currentMonth = this.getCurrentMonth();
      const previousMonth = this.getPreviousMonth();
      const currentYear = new Date().getFullYear();

      const currentDayUsage = selectedEntity.attributes?.daylist?.[0];
      const currentMonthUsage = this.getMonthUsage(selectedEntity.attributes?.monthlist || [], currentMonth);
      const previousMonthUsage = this.getMonthUsage(selectedEntity.attributes?.monthlist || [], previousMonth);
      const yearUsage = this.getYearUsage(selectedEntity.attributes?.yearlist || [], currentYear);
      
      // 渲染价格区域内容
     priceContent = html`
        <div class="usage-grid">
          <div class="usage-section" style="background: ${BgColor2};">
            <div class="usage-title" style="color: ${Color2}; text-shadow: ${Shadow};">
              <ha-icon icon="mdi:flash" style="color: ${Color2}; --mdc-icon-size: 12px; margin: 0 1px; vertical-align: middle;"></ha-icon>
              近日用电
            </div>
            ${currentDayUsage ? html`
              <div class="usage-amount">
                <span class="usage-electricity">${currentDayUsage.dayEleNum}度</span>
                <span class="usage-cost">${currentDayUsage.dayEleCost}元</span>
              </div>
              ${this.renderDayBar(currentDayUsage)}
            ` : html`<div class="usage-amount">暂无数据</div>`}
          </div>
          
          <div class="usage-section" style="background: ${BgColor2}">
            <div class="usage-title" style="color: ${Color2}; text-shadow: ${Shadow};">
              <ha-icon icon="mdi:flash" style="color: ${Color2}; --mdc-icon-size: 12px; margin: 0 1px; vertical-align: middle;"></ha-icon>
              本月用电
            </div>
            ${currentMonthUsage ? html`
              <div class="usage-amount">
                <span class="usage-electricity">${currentMonthUsage.monthEleNum}度</span>
                <span class="usage-cost">${currentMonthUsage.monthEleCost}元</span>
              </div>
              ${this.renderUsageBar(currentMonthUsage)}
            ` : html`<div class="usage-amount">暂无数据</div>`}
          </div>
          
          <div class="usage-section" style="background: ${BgColor2}">
            <div class="usage-title" style="color: ${Color2}; text-shadow: ${Shadow};">
              <ha-icon icon="mdi:flash" style="color: ${Color2}; --mdc-icon-size: 12px; margin: 0 1px; vertical-align: middle;"></ha-icon>
              上月用电
            </div>
            ${previousMonthUsage ? html`
              <div class="usage-amount">
                <span class="usage-electricity">${previousMonthUsage.monthEleNum}度</span>
                <span class="usage-cost">${previousMonthUsage.monthEleCost}元</span>
              </div>
              ${this.renderUsageBar(previousMonthUsage)}
            ` : html`<div class="usage-amount">暂无数据</div>`}
          </div>
          
          <div class="usage-section" style="background: ${BgColor2}">
            <div class="usage-title" style="color: ${Color2}; text-shadow: ${Shadow};">
              <ha-icon icon="mdi:flash" style="color: ${Color2}; --mdc-icon-size: 12px; margin: 0 1px; vertical-align: middle;"></ha-icon>
              本年用电
            </div>
            ${yearUsage ? html`
              <div class="usage-amount">
                <span class="usage-electricity">${yearUsage.yearEleNum}度</span>
                <span class="usage-cost">${yearUsage.yearEleCost}元</span>
              </div>
              ${this.renderYearUsageBar(yearUsage)}
            ` : html`<div class="usage-amount">暂无数据</div>`}
          </div>
        `;
      }
        

    return html`
        <div class="card-main" style="background: ${BgColor}; color: ${Color}">
          <div class="top-section">
            <!-- 左侧：余额信息区域 -->
            <div class="balance-section">
              <div class="top-content">
                <img src=${svgpath} class="balance-icon" alt="国网图标">
                <div class="balance-time">${selectedEntity.attributes?.date || ''}</div>
                
              </div>
              
              <div class="spacer"></div>
              
              <div class="balance-controls-container">
                <div class="balance-info" style="background: ${BgColor2}">
                  ${(() => {
                    // 明细预警优先级最高
                    let isWarning = false;
                    
                    // 获取当前选中实体的预警信息
                    const balanceData = this._balanceData.find(item => item.entity_id === selectedEntityId);
                    
                    // 首先检查明细预警，如果存在且满足条件，直接设为预警状态
                    if (balanceData && balanceData.warning && balanceData.warning.trim() !== '') {
                      isWarning = this._evaluateWarningCondition(balanceData.value, balanceData.warning); 
                    } else {
                      // 只有在没有明细预警时才检查全局预警
                      if (this.config.global_warning && this.config.global_warning.trim() !== '') {
                        isWarning = this._evaluateWarningCondition(selectedEntity.state, this.config.global_warning);
                      }
                    }
                    
                    return html`
                      <div class="balance-amount" style="color: ${isWarning ? '#F44336' : ''}">
                        <span class="currency" style="color: ${isWarning ? '#F44336' : ''}">￥</span>
                        ${selectedEntity.state || '0'}
                        <span class="currency" style="color: ${isWarning ? '#F44336' : ''}">元</span>
                      </div>
                    `;
                  })()}
                  <div class="balance-label">电费余额</div>
                </div>
                
                <div class="days-info" style="background: ${BgColor2}">
                  <div class="days-amount">
                    ${selectedEntity.attributes?.剩余天数 || '0'}
                    <span class="currency">天</span>
                  </div>
                  <div class="days-label">预估使用天数</div>
                </div>
                
                <div class="action-buttons">
                  <div class="action-button ${this.showPanel === 'calendar' ? 'active' : ''}" @click="${() => this.showCalendar()}" style="background: ${BgColor2}; color: ${Color}">日历</div>
                  <div class="action-button ${this.showPanel === 'dayUsage' ? 'active' : ''}" @click="${() => this.showDayUsage()}" style="background: ${BgColor2}; color: ${Color}">日用电</div>
                  <div class="action-button ${this.showPanel === 'monthUsage' ? 'active' : ''}" @click="${() => this.showMonthUsage()}" style="background: ${BgColor2}; color: ${Color}">月用电</div>
                </div>
              </div>
            </div>
            
            <!-- 右侧：价格区块和阶梯区域 -->
            <div class="right-section">
              <!-- 右侧上方：价格区块 -->
              <div class="price-area">
                ${priceContent}
              </div>
              
              <!-- 右侧下方：阶梯区域 -->
              <div class="ladder-area">
                ${ladderContent}
              </div>
            </div>
          </div>
        </div>
    `;
  }  

  /*渲染整个卡片的主方法*/
  render() {
    return html`
      <div class="card-container " style="width: ${this.config.width};">
        ${this.renderHeader()}
        ${this.renderMain()}

        <!-- 显示区域 - 根据showPanel显示不同内容 -->
        ${this.showPanel === 'calendar' ? html`
          <div class="panel-section" >
            ${this.renderCalendar()}
          </div>
        ` : ''}
        
        ${this.showPanel === 'dayUsage' ? html`
          <div class="panel-section" >
            ${this.renderChartDay()}
          </div>
        ` : ''}
        
        ${this.showPanel === 'monthUsage' ? html`
          <div class="panel-section" >
            ${this.renderChartMonth()}
          </div>
        ` : ''}
      </div>
    `;
  }
}
customElements.define('xiaoshi-state-grid-info', StateGridInfo);

window.customCards = window.customCards || [];
window.customCards.push(
  {
    type: 'xiaoshi-state-grid-info',
    name: '消逝国网卡片',
    description: '显示国网电力信息，包括余额、单价、用电阶梯和用电统计'
  }
);
 
