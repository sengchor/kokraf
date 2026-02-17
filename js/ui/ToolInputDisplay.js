export class ToolInputDisplay {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.container = document.getElementById('tool-input-display');

    this.setupListeners();
  }

  setupListeners() {
    this.signals.onToolStarted.add((text) => this.onToolStarted(text));
    this.signals.onToolEnded.add(() => this.onToolEnded());
    this.signals.onToolUpdated.add((text) => this.onToolUpdated(text));
  }

  onToolStarted(text) {
    this.show(text);
  }

  onToolUpdated(text) {
    this.update(text);
  }

  onToolEnded() {
    this.hide();
  }

  show(text) {
    if (!this.container) return;

    if (text !== undefined) {
      this.container.textContent = text;
    }

    this.container.classList.add('active');
  }

  hide() {
    if (!this.container) return;
    this.container.classList.remove('active');
  }

  update(text) {
    if (!this.container) return;
    this.container.textContent = text;
  }
}