export class ToolInputDisplay {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.container = document.getElementById('tool-input-display');

    this.textEl = null;
    this.buttonsEl = null;
    this.buildStructure();

    this.setupListeners();
  }

  buildStructure() {
    if (!this.container) return;

    this.container.innerHTML = '';

    this.textEl = document.createElement('div');
    this.textEl.className = 'tool-input-display__text';
    this.container.appendChild(this.textEl);

    this.buttonsEl = document.createElement('div');
    this.buttonsEl.className = 'tool-input-display__buttons';
    this.container.appendChild(this.buttonsEl);
  }

  setupListeners() {
    this.signals.onToolStarted.add((payload) => this.show(payload));
    this.signals.onToolEnded.add(() => this.hide());
    this.signals.onToolUpdated.add((payload) => this.render(payload));
  }

  show(payload) {
    if (!this.container) return;
    if (payload !== undefined) this.render(payload);
    this.container.classList.add('active');
  }

  hide() {
    if (!this.container) return;
    this.container.classList.remove('active');
    this.clearButtons();
  }

  render(payload) {
    if (!this.container) return;

    const { text = '', buttons = [] } =
      typeof payload === 'string' ? { text: payload } : (payload || {});

    this.textEl.textContent = text;
    this.textEl.style.display = text ? '' : 'none';

    this.renderButtons(buttons);
  }

  renderButtons(buttons) {
    this.clearButtons();

    if (!buttons.length) {
      this.buttonsEl.style.display = 'none';
      return;
    }

    this.buttonsEl.style.display = 'flex';

    buttons.forEach(({ label, onClick, variant }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `tool-input-btn${variant ? ` tool-input-btn--${variant}` : ''}`;
      btn.textContent = label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick?.();
      });
      this.buttonsEl.appendChild(btn);
    });
  }

  clearButtons() {
    if (this.buttonsEl) this.buttonsEl.innerHTML = '';
  }
}