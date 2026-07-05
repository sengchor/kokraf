export class EraseTool {
  constructor(getbaseCanvas) {
    this._getbaseCanvas = getbaseCanvas;
  }

  get usesColor() { return false; }

  applyTexel(data, idx, alpha) {
    const base = this._getbaseCanvas();
    if (!base) return;

    const b = base.data;
    data[idx] = data[idx] * (1 - alpha) + b[idx] * alpha;
    data[idx + 1] = data[idx + 1] * (1 - alpha) + b[idx + 1] * alpha;
    data[idx + 2] = data[idx + 2] * (1 - alpha) + b[idx + 2] * alpha;
    data[idx + 3] = data[idx + 3] * (1 - alpha) + b[idx + 3] * alpha;
  }
}