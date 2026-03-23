export class ToolNumericInput {
  constructor({tool, label, getter, setter, unit = '', allowNegative = false}) {
    this.tool = tool;
    this.signals = tool.signals;

    this.label = label;
    this.getValue = getter;
    this.setValue = setter;
    this.unit = unit;
    this.allowNegative = allowNegative;

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

    if (key === '-' && this.allowNegative) {
      this.sign *= -1;
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
    this.sign = 1;
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
    const value = parseFloat(this.buffer) * this.sign;

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

    const unitText = this.unit ? ` ${this.unit}` : '';

    return `${this.label}: ${currentValue.toFixed(3)} (${currentValue.toFixed(3)})${unitText}`;
  }

  getEditDisplayText() {
    const raw = this.getDisplayBufferWithCaret();
    const displayValue = this.sign === 1 ? raw : `-(${raw})`;

    let currentValue = this.getValue();
    if (currentValue == null || Number.isNaN(currentValue)) {
      currentValue = 0;
    }

    const unitText = this.unit ? ` ${this.unit}` : '';

    return `${this.label}: [${displayValue}] = ${currentValue.toFixed(3)} (${currentValue.toFixed(3)})${unitText}`;
  }
}