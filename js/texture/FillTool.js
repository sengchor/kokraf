export class FillTool {
  get usesColor() { return true; }

  get continuous() { return false; }

  fill(imageData, seed, rgba, islandMaskData = null, tolerance = 0.1) {
    const { width, height, data } = imageData;
    const startIdx = (seed.y * width + seed.x) * 4;
    if (seed.x < 0 || seed.x >= width || seed.y < 0 || seed.y >= height) return false;

    if (islandMaskData && islandMaskData[startIdx] === 0) return false;

    const seedColor = [data[startIdx], data[startIdx + 1], data[startIdx + 2], data[startIdx + 3]];
    if (this._colorDistance(seedColor, rgba) < 1 && rgba[3] === seedColor[3]) return false;

    const maxDist = tolerance * 441.67;
    const visited = new Uint8Array(width * height);
    const stack = [seed.x, seed.y];
    let touched = false;

    while (stack.length) {
      const y = stack.pop();
      const x = stack.pop();
      if (x < 0 || x >= width || y < 0 || y >= height) continue;

      const pos = y * width + x;
      if (visited[pos]) continue;
      visited[pos] = 1;

      const idx = pos * 4;

      if (islandMaskData && islandMaskData[idx] === 0) continue;

      const current = [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
      if (this._colorDistance(current, seedColor) > maxDist) continue;

      this._blendTexel(data, idx, rgba);
      touched = true;

      stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }

    return touched;
  }

  _blendTexel(data, idx, [r, g, b, a255]) {
    const srcA = a255 / 255;
    const dstA = data[idx + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);

    if (outA <= 0) {
      data[idx] = data[idx + 1] = data[idx + 2] = data[idx + 3] = 0;
      return;
    }

    data[idx] = (r * srcA + data[idx] * dstA * (1 - srcA)) / outA;
    data[idx + 1] = (g * srcA + data[idx + 1] * dstA * (1 - srcA)) / outA;
    data[idx + 2] = (b * srcA + data[idx + 2] * dstA * (1 - srcA)) / outA;
    data[idx + 3] = outA * 255;
  }

  _colorDistance(a, b) {
    const dr = a[0] -b[0], dg = a[1] - b[1], db = a[2] - b[2], da = a[3] - b[3];
    return Math.sqrt(dr * dr + dg * dg + db * db + da * da);
  }

  _hexToRGB(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }
}