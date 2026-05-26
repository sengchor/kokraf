export class TexturePatchFill {

  // ── WGSL ───────────────────────────────────────────────────────────────────

  static #COMMON = /* wgsl */`
struct Params {
  W             : u32,   // image width
  H             : u32,   // image height
  R             : u32,   // patch radius
  K             : u32,   // known-pixel count
  seed          : u32,   // per-pass RNG seed
  dir           : i32,   // propagation direction: +1 fwd, -1 bwd
  spatialWeight : f32,   // Penalty weight for distance
  _pad          : u32,
}

@group(0) @binding(0) var<storage, read_write> img  : array<u32>;   // packed RGBA8
@group(0) @binding(1) var<storage, read_write> nnf  : array<vec2i>; // best-match coords per pixel
@group(0) @binding(2) var<storage, read_write> dst  : array<f32>;   // patch distance per pixel
@group(0) @binding(3) var<storage, read>       hole : array<u32>;   // 1 = hole, 0 = known
@group(0) @binding(4) var<storage, read>       kn   : array<u32>;   // indices of known pixels
@group(0) @binding(5) var<uniform>             p    : Params;

// ── Pixel helpers ─────────────────────────────────────────────────────────

fn readPx(i: u32) -> vec3f {
  let c = img[i];
  return vec3f(f32(c & 0xffu), f32((c >> 8u) & 0xffu), f32((c >> 16u) & 0xffu));
}

fn writePx(i: u32, c: vec3f) {
  img[i] = u32(clamp(c.x, 0., 255.))
         | (u32(clamp(c.y, 0., 255.)) << 8u)
         | (u32(clamp(c.z, 0., 255.)) << 16u)
         | (255u << 24u);
}

// ── Patch distance ────────────────────────────────────────────────────────

fn patchDist(ax: i32, ay: i32, bx: i32, by: i32) -> f32 {
  var s = 0.0;
  var n = 0u;
  let W = i32(p.W);
  let H = i32(p.H);
  let r = i32(p.R);
  for (var dy = -r; dy <= r; dy++) {
    for (var dx = -r; dx <= r; dx++) {
      let ax2 = ax + dx; let ay2 = ay + dy;
      let bx2 = bx + dx; let by2 = by + dy;
      if (ax2 < 0 || ax2 >= W || ay2 < 0 || ay2 >= H) { continue; }
      if (bx2 < 0 || bx2 >= W || by2 < 0 || by2 >= H) { continue; }
      let d = readPx(u32(ay2 * W + ax2)) - readPx(u32(by2 * W + bx2));
      s += dot(d, d);
      n++;
    }
  }
  
  let colorScore = select(1e30, s / f32(n), n > 0u);
  
  let dx = f32(ax - bx);
  let dy = f32(ay - by);
  let spatialScore = dx * dx + dy * dy;
  
  return colorScore + (p.spatialWeight * spatialScore);
}

// ── PCG-based RNG ─────────────────────────────────────────────────────────

fn pcg(st: ptr<function, u32>) -> f32 {
  *st = *st * 747796405u + 2891336453u;
  var w = ((*st >> ((*st >> 28u) + 4u)) ^ *st) * 277803737u;
  w = (w >> 22u) ^ w;
  return f32(w) / 4294967295.0;
}
`;

  // Initialise NNF: known pixels point to themselves; holes get a random known pixel.
  static #INIT = /* wgsl */`
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= p.W || g.y >= p.H) { return; }
  let i = g.y * p.W + g.x;

  if (hole[i] == 0u) {
    nnf[i] = vec2i(i32(g.x), i32(g.y));
    dst[i] = 0.0;
    return;
  }

  var st = p.seed ^ (i * 2654435761u);
  let ki  = min(u32(pcg(&st) * f32(p.K)), p.K - 1u);
  let si  = kn[ki];
  nnf[i] = vec2i(i32(si % p.W), i32(si / p.W));
  dst[i] = 1e30;
  writePx(i, readPx(si));
}
`;

  // Recompute patch distances for all hole pixels using current NNF.
  static #DIST = /* wgsl */`
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= p.W * p.H || hole[i] == 0u) { return; }
  dst[i] = patchDist(i32(i % p.W), i32(i / p.W), nnf[i].x, nnf[i].y);
}
`;

  // Propagation: each hole pixel tries its axis-aligned neighbour's NNF + dir.
  static #PROP = /* wgsl */`
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= p.W || g.y >= p.H) { return; }
  let x = i32(g.x);
  let y = i32(g.y);
  let i = g.y * p.W + g.x;
  if (hole[i] == 0u) { return; }

  let d = p.dir;
  let W = i32(p.W);
  let H = i32(p.H);
  var bx = nnf[i].x;
  var by = nnf[i].y;
  var bd = dst[i];

  for (var k = 0; k < 2; k++) {
    let nx = x + select(0, -d, k == 0);
    let ny = y + select(-d, 0, k == 0);
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) { continue; }

    let ni = u32(ny) * p.W + u32(nx);
    let cx = nnf[ni].x + d;
    let cy = nnf[ni].y + d;
    if (cx < 0 || cx >= W || cy < 0 || cy >= H) { continue; }
    if (hole[u32(cy) * p.W + u32(cx)] != 0u) { continue; }

    let dd = patchDist(x, y, cx, cy);
    if (dd < bd) { bx = cx; by = cy; bd = dd; }
  }
  nnf[i] = vec2i(bx, by);
  dst[i] = bd;
}
`;

  // Random search: exponentially shrinking radius around current best match.
  static #RAND = /* wgsl */`
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= p.W || g.y >= p.H) { return; }
  let x = i32(g.x);
  let y = i32(g.y);
  let i = g.y * p.W + g.x;
  if (hole[i] == 0u) { return; }

  let W = i32(p.W);
  let H = i32(p.H);
  var st  = p.seed ^ (i * 2654435761u);
  var bx  = nnf[i].x;
  var by  = nnf[i].y;
  var bd  = dst[i];
  var rad = i32(max(p.W, p.H));

  while (rad >= 1) {
    let cx = clamp(bx + i32((pcg(&st) * 2.0 - 1.0) * f32(rad)), 0, W - 1);
    let cy = clamp(by + i32((pcg(&st) * 2.0 - 1.0) * f32(rad)), 0, H - 1);
    if (hole[u32(cy) * p.W + u32(cx)] == 0u) {
      let dd = patchDist(x, y, cx, cy);
      if (dd < bd) { bx = cx; by = cy; bd = dd; }
    }
    rad /= 2;
  }
  nnf[i] = vec2i(bx, by);
  dst[i] = bd;
}
`;

  // Reconstruction: write NNF target colour into each hole pixel.
  static #RECON = /* wgsl */`
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= p.W || g.y >= p.H) { return; }
  let i = g.y * p.W + g.x;
  if (hole[i] == 0u) { return; }
  writePx(i, readPx(u32(nnf[i].y) * p.W + u32(nnf[i].x)));
}
`;

  // ── Device singleton + pipeline cache ──────────────────────────────────────

  static #devP  = null;
  static #cache = new WeakMap();

  static async #getDevice() {
    return (this.#devP ??=
      navigator.gpu?.requestAdapter()
        .then(a => a?.requestDevice({ label: 'TexturePatchFill' }) ?? null)
      ?? Promise.resolve(null)
    );
  }

  static #getPipelines(dev) {
    if (this.#cache.has(dev)) return this.#cache.get(dev);

    const bgl = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    const layout = dev.createPipelineLayout({ bindGroupLayouts: [bgl] });

    const mk = (src, label) => dev.createComputePipeline({
      label, layout,
      compute: {
        module: dev.createShaderModule({ code: TexturePatchFill.#COMMON + src }),
        entryPoint: 'main',
      },
    });

    const entry = {
      bgl,
      init:  mk(TexturePatchFill.#INIT,  'tpf-init'),
      dist:  mk(TexturePatchFill.#DIST,  'tpf-dist'),
      prop:  mk(TexturePatchFill.#PROP,  'tpf-prop'),
      rand:  mk(TexturePatchFill.#RAND,  'tpf-rand'),
      recon: mk(TexturePatchFill.#RECON, 'tpf-recon'),
    };
    this.#cache.set(dev, entry);
    return entry;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  static async fill(blob, opts = {}) {
    const dev = await this.#getDevice().catch(() => null);
    try {
      return dev
        ? await this.#fillGPU(dev, blob, opts)
        : await this.#fillCPU(blob, opts);
    } catch (err) {
      console.warn('[TexturePatchFill] GPU path failed, falling back to CPU:', err);
      return this.#fillCPU(blob, opts);
    }
  }

  // ── GPU implementation ─────────────────────────────────────────────────────

  static async #fillGPU(dev, blob, { patchRadius = 4, iterations = 8, spatialWeight = 0.5 } = {}) {
    const imgData = await TexturePatchFill.#toImageData(blob);
    const { width: W, height: H, data } = imgData;
    const N = W * H;

    const imgU32  = new Uint32Array(N);
    const holeArr = new Uint32Array(N);
    const knownList = [];

    for (let i = 0; i < N; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
      imgU32[i] = r | (g << 8) | (b << 16) | (0xFF << 24);
      if (a < 128 || (r === 0 && g === 0 && b === 0)) {
        holeArr[i] = 1;
      } else {
        knownList.push(i);
      }
    }

    if (!knownList.length || !holeArr.some(Boolean)) return blob;
    const knownArr = new Uint32Array(knownList);

    const SU = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    const UU = GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST;

    const mkBuf = (size, usage, initData) => {
      const buf = dev.createBuffer({ size: Math.max(size, 4), usage });
      if (initData) dev.queue.writeBuffer(buf, 0, initData);
      return buf;
    };

    const imgBuf   = mkBuf(N * 4,                SU, imgU32);
    const nnfBuf   = mkBuf(N * 8,                SU);
    const dstBuf   = mkBuf(N * 4,                SU);
    const holeBuf  = mkBuf(N * 4,                SU, holeArr);
    const knownBuf = mkBuf(knownArr.byteLength,   SU, knownArr);
    const paramBuf = mkBuf(32,                    UU);

    const { bgl, init, dist, prop, rand, recon } = TexturePatchFill.#getPipelines(dev);
    const bg = dev.createBindGroup({
      layout: bgl,
      entries: [
        { binding: 0, resource: { buffer: imgBuf   } },
        { binding: 1, resource: { buffer: nnfBuf   } },
        { binding: 2, resource: { buffer: dstBuf   } },
        { binding: 3, resource: { buffer: holeBuf  } },
        { binding: 4, resource: { buffer: knownBuf } },
        { binding: 5, resource: { buffer: paramBuf } },
      ],
    });

    const WG2D = [Math.ceil(W / 16), Math.ceil(H / 16), 1];
    const WG1D = [Math.ceil(N / 256), 1, 1];

    const writeParams = (seed, dir) => {
      const ab  = new ArrayBuffer(32);
      const u32 = new Uint32Array(ab);
      const i32 = new Int32Array(ab);
      const f32 = new Float32Array(ab);
      u32[0] = W; u32[1] = H; u32[2] = patchRadius; u32[3] = knownArr.length;
      u32[4] = seed >>> 0;
      i32[5] = dir;
      f32[6] = spatialWeight;
      dev.queue.writeBuffer(paramBuf, 0, ab);
    };

    const dispatch = (pipeline, wg) => {
      const enc  = dev.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(...wg);
      pass.end();
      dev.queue.submit([enc.finish()]);
    };

    writeParams(Math.random() * 0xFFFFFFFF >>> 0, 1);
    dispatch(init, WG2D);

    for (let it = 0; it < iterations; it++) {
      const s = (it * 1664525 + 1013904223) >>> 0;

      writeParams(s, 1);            dispatch(dist,  WG1D);
      writeParams(s, 1);            dispatch(prop,  WG2D);
      writeParams(s ^ 0xF00D, 1);   dispatch(rand,  WG2D);
      writeParams(s, -1);           dispatch(prop,  WG2D);
      writeParams(s ^ 0xBEEF, -1);  dispatch(rand,  WG2D);
                                    dispatch(recon, WG2D);
    }

    const readBuf = dev.createBuffer({
      size: N * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const enc = dev.createCommandEncoder();
    enc.copyBufferToBuffer(imgBuf, 0, readBuf, 0, N * 4);
    dev.queue.submit([enc.finish()]);

    await readBuf.mapAsync(GPUMapMode.READ);
    const out = new Uint32Array(readBuf.getMappedRange().slice(0));
    readBuf.unmap();

    for (let i = 0; i < N; i++) {
      const c = out[i];
      data[i * 4]     = c & 0xFF;
      data[i * 4 + 1] = (c >> 8)  & 0xFF;
      data[i * 4 + 2] = (c >> 16) & 0xFF;
      data[i * 4 + 3] = 0xFF;
    }

    [imgBuf, nnfBuf, dstBuf, holeBuf, knownBuf, paramBuf, readBuf].forEach(b => b.destroy());
    return TexturePatchFill.#toBlob(new ImageData(data, W, H));
  }

  // ── CPU fallback (original algorithm) ─────────────────────────────────────

  static async #fillCPU(blob, { patchRadius = 4, iterations = 8, spatialWeight = 0.5 } = {}) {
    const imageData = await TexturePatchFill.#toImageData(blob);
    const { width, height, data } = imageData;

    const isHole     = new Uint8Array(width * height);
    const knownPixels = [];
    const holeIndices = [];

    for (let i = 0; i < width * height; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
      if (a < 128 || (r === 0 && g === 0 && b === 0)) {
        isHole[i] = 1; holeIndices.push(i);
      } else {
        knownPixels.push(i);
      }
    }

    if (!knownPixels.length || !holeIndices.length) return blob;

    const nnfX  = new Int16Array(width * height);
    const nnfY  = new Int16Array(width * height);
    const nnfDst = new Float32Array(width * height).fill(Infinity);
    const rng   = TexturePatchFill.#lcg();

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (!isHole[idx]) {
          nnfX[idx] = x; nnfY[idx] = y; nnfDst[idx] = 0;
        } else {
          const src = knownPixels[Math.floor(rng() * knownPixels.length)];
          nnfX[idx] = src % width;
          nnfY[idx] = Math.floor(src / width);
          const di = idx * 4, si = src * 4;
          data[di] = data[si]; data[di+1] = data[si+1];
          data[di+2] = data[si+2]; data[di+3] = 255;
        }
      }
    }

    for (let iter = 0; iter < iterations; iter++) {
      for (const idx of holeIndices) {
        nnfDst[idx] = TexturePatchFill.#cpuPatchDist(
          data, width, height, idx % width, Math.floor(idx / width),
          nnfX[idx], nnfY[idx], patchRadius, spatialWeight
        );
      }
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          if (!isHole[idx]) continue;
          TexturePatchFill.#cpuPropagate(data, width, height, isHole, nnfX, nnfY, nnfDst, x, y, patchRadius, +1, spatialWeight);
          TexturePatchFill.#cpuRandomSearch(data, width, height, isHole, nnfX, nnfY, nnfDst, x, y, patchRadius, rng, spatialWeight);
        }
      }
      for (let y = height - 1; y >= 0; y--) {
        for (let x = width - 1; x >= 0; x--) {
          const idx = y * width + x;
          if (!isHole[idx]) continue;
          TexturePatchFill.#cpuPropagate(data, width, height, isHole, nnfX, nnfY, nnfDst, x, y, patchRadius, -1, spatialWeight);
          TexturePatchFill.#cpuRandomSearch(data, width, height, isHole, nnfX, nnfY, nnfDst, x, y, patchRadius, rng, spatialWeight);
        }
      }
      for (const idx of holeIndices) {
        const si = (nnfY[idx] * width + nnfX[idx]) * 4, di = idx * 4;
        data[di] = data[si]; data[di+1] = data[si+1];
        data[di+2] = data[si+2]; data[di+3] = 255;
      }
    }

    return TexturePatchFill.#toBlob(new ImageData(data, width, height));
  }

  static #cpuPropagate(data, W, H, isHole, nnfX, nnfY, nnfDst, x, y, r, dir, spatialWeight) {
    const idx = y * W + x;
    for (const { nx, ny } of [{ nx: x - dir, ny: y }, { nx: x, ny: y - dir }]) {
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const cx = nnfX[ny * W + nx] + dir, cy = nnfY[ny * W + nx] + dir;
      if (cx < 0 || cx >= W || cy < 0 || cy >= H || isHole[cy * W + cx]) continue;
      const d = TexturePatchFill.#cpuPatchDist(data, W, H, x, y, cx, cy, r, spatialWeight);
      if (d < nnfDst[idx]) { nnfX[idx] = cx; nnfY[idx] = cy; nnfDst[idx] = d; }
    }
  }

  static #cpuRandomSearch(data, W, H, isHole, nnfX, nnfY, nnfDst, x, y, r, rng, spatialWeight) {
    const idx = y * W + x;
    let radius = Math.max(W, H);
    while (radius >= 1) {
      const cx = Math.max(0, Math.min(W - 1, Math.round(nnfX[idx] + (rng() * 2 - 1) * radius)));
      const cy = Math.max(0, Math.min(H - 1, Math.round(nnfY[idx] + (rng() * 2 - 1) * radius)));
      if (!isHole[cy * W + cx]) {
        const d = TexturePatchFill.#cpuPatchDist(data, W, H, x, y, cx, cy, r, spatialWeight);
        if (d < nnfDst[idx]) { nnfX[idx] = cx; nnfY[idx] = cy; nnfDst[idx] = d; }
      }
      radius = Math.floor(radius / 2);
    }
  }

  static #cpuPatchDist(data, W, H, ax, ay, bx, by, r, spatialWeight) {
    let sum = 0, count = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const ax2 = ax+dx, ay2 = ay+dy, bx2 = bx+dx, by2 = by+dy;
        if (ax2<0||ax2>=W||ay2<0||ay2>=H||bx2<0||bx2>=W||by2<0||by2>=H) continue;
        const ao = (ay2*W+ax2)*4, bo = (by2*W+bx2)*4;
        const dr = data[ao]-data[bo], dg = data[ao+1]-data[bo+1], db = data[ao+2]-data[bo+2];
        sum += dr*dr + dg*dg + db*db; count++;
      }
    }
    const colorScore = count > 0 ? sum / count : Infinity;
    const dx = ax - bx;
    const dy = ay - by;
    return colorScore + (spatialWeight * (dx * dx + dy * dy));
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  static async #toImageData(blob) {
    const bm  = await createImageBitmap(blob);
    const cvs = new OffscreenCanvas(bm.width, bm.height);
    const ctx = cvs.getContext('2d');
    ctx.drawImage(bm, 0, 0);
    return ctx.getImageData(0, 0, bm.width, bm.height);
  }

  static async #toBlob(imageData) {
    const cvs = new OffscreenCanvas(imageData.width, imageData.height);
    const ctx = cvs.getContext('2d');
    ctx.putImageData(imageData, 0, 0);
    return cvs.convertToBlob({ type: 'image/png' });
  }

  static #lcg() {
    let s = (Math.random() * 0xFFFFFFFF) >>> 0;
    return () => { 
      s = Math.imul(1664525, s) + 1013904223 >>> 0; 
      return s / 0x100000000; 
    };
  }
}