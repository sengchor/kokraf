export class PaintTool {
  constructor() {
    this._rgb = [255, 255, 255];
  }

  get usesColor() { return true; }

  onDabStart({ brush }) {
    this._rgb = this._hexToRGB(brush.color);
  }

  applyTexel(data, idx, alpha) {
    const [r, g, b] = this._rgb;

    const dstA = data[idx + 3] / 255;
    const srcA = alpha;
    const outA = srcA + dstA * (1 - srcA);

    if (outA <= 0) {
      data[idx] = data[idx + 1] = data[idx + 2] = data[idx + 3] = 0;
      return;
    }

    data[idx]     = (r * srcA + data[idx]     * dstA * (1 - srcA)) / outA;
    data[idx + 1] = (g * srcA + data[idx + 1] * dstA * (1 - srcA)) / outA;
    data[idx + 2] = (b * srcA + data[idx + 2] * dstA * (1 - srcA)) / outA;
    data[idx + 3] = outA * 255;
  }

  _hexToRGB(hex) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }
}