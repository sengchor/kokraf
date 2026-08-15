export class OperatorPanel {
  constructor(editor, containerElement) {
    this.editor = editor;
    this.container = containerElement;
    this.active = null;
    this.setupListener();
  }

  setupListener() {
    document.addEventListener('pointerdown', (e) => {
      if (!this.active || e.button === 1 || this.container.contains(e.target)) return;
      this.commit();
    }, true);
    document.addEventListener('keydown', (e) => {
      if (!this.active || e.target.tagName === 'INPUT') return;
      if (e.key === 'Escape') this.cancel();
      else this.commit();
    }, true);
  }

  open({ title, params, schema, onUpdate, onCommit, onCancel }) {
    this.active = { title, params: { ...params }, schema, onUpdate, onCommit, onCancel };
    this.render();
  }

  commit() { this.active?.onCommit?.(this.active.params); this.close(); }
  cancel() { this.active?.onCancel?.(); this.close(); }
  close() { this.active = null; this.container.style.display = 'none'; this.container.innerHTML = ''; }

  render() {
    this.container.style.display = 'block';
    this.container.innerHTML = '';
    const title = document.createElement('h3');
    title.textContent = this.active.title;
    this.container.appendChild(title);
    for (const field of this.active.schema) this.createInputRow(field);
  }

  createInputRow({ key, label, min = 0, max = Infinity, step = 1 }) {
    const row = document.createElement('div');
    row.classList.add('property-row');
    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.value = this.active.params[key];
    input.min = min; input.max = max; input.step = step;
    input.addEventListener('input', (e) => {
      const value = parseFloat(e.target.value);
      if (Number.isNaN(value) || value < min || value > max) return;
      this.active.params[key] = value;
      this.active.onUpdate(this.active.params);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    row.append(labelEl, input);
    this.container.appendChild(row);
  }
}