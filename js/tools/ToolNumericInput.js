export class ToolNumericInput {
  constructor({tool, label, getter, setter}) {
    this.tool = tool;
    this.signals = tool.signals;

    this.label = label;
    this.getValue = getter;
    this.setValue = setter;

    this.reset();
  }

  handleKey(event) {
    const key = event.key;

    if (/[0-9.]/.test(key)) {
      if (!this.active) this.begin();
      this.insertChar(key);
      this.applyNumeric();
      return true;
    }

    if (key === 'Backspace') {
      this.deleteChar();
      this.applyNumeric();
      return true;
    }

    if (key === 'ArrowLeft') {
      this.moveCursorLeft();
      this.applyNumeric();
      return true;
    }

    if (key === 'ArrowRight') {
      this.moveCursorRight();
      this.applyNumeric();
      return true;
    }

    return false;
  }

  reset() {
    this.active = false;
    this.buffer = '';
    this.cursor = 0;
  }

  begin() {
    this.buffer = '';
    this.cursor = 0;
    this.active = true;
  }

  insertChar(char) {
    this.buffer = this.buffer.slice(0, this.cursor) +
      char + this.buffer.slice(this.cursor);
    this.cursor += char.length;
  }

  deleteChar() {
    if (this.cursor === 0) return;

    this.buffer = this.buffer.slice(0, this.cursor - 1) +
      this.buffer.slice(this.cursor);

    this.cursor--;
  }

  moveCursorLeft() {
    this.cursor = Math.max(0, this.cursor - 1);
  }

  moveCursorRight() {
    this.cursor = Math.min(this.buffer.length, this.cursor + 1);
  }

  getDisplayBufferWithCaret() {
    return ( this.buffer.slice(0, this.cursor) + '|' +
    this.buffer.slice(this.cursor));
  }

  applyNumeric() {
    const value = parseFloat(this.buffer);

    if (!Number.isNaN(value)) {
      this.setValue(value);
    }

    this.signals.onToolUpdated.dispatch(this.getEditDisplayText());
  }

  getDisplayText() {
    let currentValue = this.getValue();
    if (!currentValue) {
      currentValue = 0;
    }

    return `${this.label}: ${currentValue.toFixed(3)} (${currentValue.toFixed(3)}) m`;
  }

  getEditDisplayText() {
    const raw = this.getDisplayBufferWithCaret();

    let currentValue = this.getValue();
    if (currentValue == null || Number.isNaN(currentValue)) {
      currentValue = 0;
    }

    return `${this.label}: [${raw}] = ${currentValue.toFixed(3)} (${currentValue.toFixed(3)}) m`;
  }
}