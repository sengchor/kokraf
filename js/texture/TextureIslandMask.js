export class TextureIslandMask {
  static async apply(blob, geometry, {dilation = 2} = {}) {
    const bm = await createImageBitmap(blob);
    const W = bm.width;
    const H = bm.height;

    const src = new OffscreenCanvas(W, H);
    const sCtx = src.getContext('2d');
    sCtx.drawImage(bm, 0, 0);
    const imageData = sCtx.getImageData(0, 0, W, H);

    // Build island mask
    let mask = this.#rasteriseMask(geometry, W, H);
    if (dilation > 0) mask = this.#dilate(mask, W, H, dilation);

    // Zero-out texels outside islands
    const { data } = imageData;
    for (let i = 0; i < W * H; i++) {
      if (!mask[i]) {
        data[i * 4] = 0;
        data[i * 4 + 1] = 0;
        data[i * 4 + 2] = 0;
      }
    }

    const out = new OffscreenCanvas(W, H);
    const oCtx = out.getContext('2d');
    oCtx.putImageData(imageData, 0, 0);
    return out.convertToBlob({ type: 'image/png' });
  }

  static #rasteriseMask(geometry, W, H) {
    const uvAttr = geometry.attributes.uv;
    const index  = geometry.index;
 
    if (!uvAttr) throw new Error('[TextureIslandMask] geometry has no UV attribute');
 
    const cvs = new OffscreenCanvas(W, H);
    const ctx = cvs.getContext('2d');
 
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
 
    const count = index ? index.count : uvAttr.count;
 
    for (let i = 0; i < count; i += 3) {
      const ai = index ? index.getX(i)     : i;
      const bi = index ? index.getX(i + 1) : i + 1;
      const ci = index ? index.getX(i + 2) : i + 2;
 
      // UV → pixel coords (Y is flipped: UV origin is bottom-left)
      const ax = uvAttr.getX(ai) * W,   ay = (1 - uvAttr.getY(ai)) * H;
      const bx = uvAttr.getX(bi) * W,   by = (1 - uvAttr.getY(bi)) * H;
      const cx = uvAttr.getX(ci) * W,   cy = (1 - uvAttr.getY(ci)) * H;
 
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.lineTo(cx, cy);
      ctx.closePath();
      ctx.fill();
    }
 
    // Extract as a flat Uint8 array (1 bit per pixel, stored as byte)
    const raw  = ctx.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      mask[i] = raw[i * 4] > 127 ? 1 : 0;
    }
    return mask;
  }

  static #dilate(mask, W, H, radius) {
    const tmp = new Uint8Array(W * H);
    const out = new Uint8Array(W * H);
 
    // Horizontal pass
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let val = 0;
        const xMin = Math.max(0, x - radius);
        const xMax = Math.min(W - 1, x + radius);
        for (let nx = xMin; nx <= xMax && !val; nx++) {
          val = mask[y * W + nx];
        }
        tmp[y * W + x] = val;
      }
    }
 
    // Vertical pass
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        let val = 0;
        const yMin = Math.max(0, y - radius);
        const yMax = Math.min(H - 1, y + radius);
        for (let ny = yMin; ny <= yMax && !val; ny++) {
          val = tmp[ny * W + x];
        }
        out[y * W + x] = val;
      }
    }
 
    return out;
  }
}