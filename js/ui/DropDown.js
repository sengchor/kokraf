const CHEVRON = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export class Dropdown {
  /**
   * @param {HTMLElement} container
   * @param {{
   *   options: Array<{ value: string, label: string, icon?: string, desc?: string }>,
   *   value?: string,
   *   placeholder?: string,
   *   onChange?: (value: string) => void,
   * }} config
   */
  constructor(container, { options = [], value = null, placeholder = 'Select...', onChange } = {}) {
    this.container   = container;
    this.options     = options;
    this.onChange    = onChange;
    this.placeholder = placeholder;
    this._value      = value;
    this._onOutsideClick = () => this._close();
    this._render();
    this._set(value ?? options[0]?.value, false);
  }

  get value() {
    return this._value;
  }

  set value(v) {
    this._set(v, false);
  }

  _render() {
    const optionsHTML = this.options.map(({ value, label, icon = '', desc = '' }) => `
      <div class="dropdown-option" data-value="${value}">
        ${icon ? `<span class="dropdown-option-icon">${icon}</span>` : ''}
        <div class="dropdown-option-body">
          <span class="dropdown-option-label">${label}</span>
          ${desc ? `<span class="dropdown-option-desc">${desc}</span>` : ''}
        </div>
        <span class="dropdown-option-check">${CHEVRON}</span>
      </div>
    `).join('');

    this.container.innerHTML = `
      <div class="dropdown-wrap">
        <button type="button" class="dropdown-trigger">
          <span class="dropdown-trigger-icon"></span>
          <span class="dropdown-trigger-label"></span>
          <span class="dropdown-trigger-chevron">${CHEVRON}</span>
        </button>
        <div class="dropdown-menu hidden">
          ${optionsHTML}
        </div>
      </div>
    `;

    this._trigger  = this.container.querySelector('.dropdown-trigger');
    this._menu     = this.container.querySelector('.dropdown-menu');
    this._iconEl   = this.container.querySelector('.dropdown-trigger-icon');
    this._labelEl  = this.container.querySelector('.dropdown-trigger-label');

    this._trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      this._menu.classList.contains('hidden') ? this._open() : this._close();
    });

    this._menu.querySelectorAll('.dropdown-option').forEach(el => {
      el.addEventListener('click', () => this._set(el.dataset.value, true));
    });
  }

  _set(value, emit) {
    const option = this.options.find(o => o.value === value);
    if (!option) return;

    this._value = value;
    this._iconEl.innerHTML = option.icon ?? '';
    this._iconEl.style.display = option.icon ? '' : 'none';
    this._labelEl.textContent = option.label;

    this._menu.querySelectorAll('.dropdown-option').forEach(el => {
      el.classList.toggle('selected', el.dataset.value === value);
    });

    this._close();
    if (emit) this.onChange?.(value, option);
  }

  _open() {
    this._menu.classList.remove('hidden');
    this._trigger.classList.add('open');
    document.addEventListener('click', this._onOutsideClick);
  }

  _close() {
    this._menu.classList.add('hidden');
    this._trigger.classList.remove('open');
    document.removeEventListener('click', this._onOutsideClick);
  }

  destroy() {
    this._close();
    this.container.innerHTML = '';
  }
}