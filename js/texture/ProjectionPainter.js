import * as THREE from 'three';

export class ProjectionPainter {
  constructor() {
    this.meshData = null;
    this.canvas = null;
    this.ctx = null;
    this.imageData = null;
    this.object = null;
    this._ndcTmp = new THREE.Vector3();
  }

  attach(object, canvas, bakeMesh) {
    const meshChanged = this.bakeMesh !== bakeMesh;
    const canvasChanged = this.canvas !== canvas;
    const objectChanged = this.object !== object;

    this.object = object;
    this.bakeMesh = bakeMesh;

    this.setPaintCanvas(canvas);

    if (meshChanged || objectChanged) {
      this._buildTriangleCache();
    }
  }

  setPaintCanvas(canvas) {
    if (this.canvas === canvas) return;

    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.imageData = this.ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  _buildTriangleCache() {
    this.triangles = [];
    if (!this.bakeMesh) return;

    const mesh = this.bakeMesh;
    mesh.matrixWorld.copy(this.object.matrixWorld);
    const matrixWorld = mesh.matrixWorld;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrixWorld);

    const geom = mesh.geometry;
    const posAttr = geom.getAttribute('position');
    const uvAttr = geom.getAttribute('uv');
    const index = geom.getIndex();

    if (!posAttr || !uvAttr) {
      this._buildSpatialHash();
      return;
    }

    const idx = i => (index ? index.getX(i) : i);
    const triCount = (index ? index.count : posAttr.count) / 3;

    const localA = new THREE.Vector3();
    const localB = new THREE.Vector3();
    const localC = new THREE.Vector3();

    for (let t = 0; t < triCount; t++) {
      const ia = idx(t * 3);
      const ib = idx(t * 3 + 1);
      const ic = idx(t * 3 + 2);

      localA.fromBufferAttribute(posAttr, ia);
      localB.fromBufferAttribute(posAttr, ib);
      localC.fromBufferAttribute(posAttr, ic);

      const p0 = localA.clone().applyMatrix4(matrixWorld);
      const p1 = localB.clone().applyMatrix4(matrixWorld);
      const p2 = localC.clone().applyMatrix4(matrixWorld);

      const uv0 = { u: uvAttr.getX(ia), v: uvAttr.getY(ia) };
      const uv1 = { u: uvAttr.getX(ib), v: uvAttr.getY(ib) };
      const uv2 = { u: uvAttr.getX(ic), v: uvAttr.getY(ic) };

      const localNormal = new THREE.Triangle(localA, localB, localC).getNormal(new THREE.Vector3());
      const worldNormal = localNormal.applyMatrix3(normalMatrix).normalize();

      const center = new THREE.Vector3().add(p0).add(p1).add(p2).multiplyScalar(1 / 3);
      const radius = Math.max(center.distanceTo(p0), center.distanceTo(p1), center.distanceTo(p2));

      this.triangles.push({ p0, p1, p2, uv0, uv1, uv2, center, radius, normal: worldNormal });
    }

    this._buildSpatialHash();
  }

  rebuild(bakeMesh) {
    if (bakeMesh) this.bakeMesh = bakeMesh;
    this._buildTriangleCache();
  }

  _buildSpatialHash(cellSize = 0.5) {
    this.cellSize = cellSize;
    this.grid = new Map();
    
    for (const tri of this.triangles) {
      // Calculate the bounding box of the triangle's sphere in grid space
      const minX = Math.floor((tri.center.x - tri.radius) / cellSize);
      const maxX = Math.floor((tri.center.x + tri.radius) / cellSize);
      const minY = Math.floor((tri.center.y - tri.radius) / cellSize);
      const maxY = Math.floor((tri.center.y + tri.radius) / cellSize);
      const minZ = Math.floor((tri.center.z - tri.radius) / cellSize);
      const maxZ = Math.floor((tri.center.z + tri.radius) / cellSize);

      // Register the triangle in every cell its volume touches
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          for (let z = minZ; z <= maxZ; z++) {
            const key = `${x},${y},${z}`;
            if (!this.grid.has(key)) this.grid.set(key, []);
            this.grid.get(key).push(tri);
          }
        }
      }
    }
  }

  _cellKey(v) {
    return `${Math.floor(v.x / this.cellSize)},${Math.floor(v.y / this.cellSize)},${Math.floor(v.z / this.cellSize)}`;
  }

  _queryCandidates(center, radius) {
    const result = new Set();
    const r = Math.ceil(radius / this.cellSize) + 1;
    const [cx, cy, cz] = [center.x, center.y, center.z].map(c => Math.floor(c / this.cellSize));
    
    for (let x = -r; x <= r; x++) {
      for (let y = -r; y <= r; y++) {
        for (let z = -r; z <= r; z++) {
          const bucket = this.grid.get(`${cx + x},${cy + y},${cz + z}`);
          if (bucket) {
            for (const tri of bucket) {
              result.add(tri);
            }
          }
        }
      }
    }
    
    return result;
  }

  _getPaintParams(context) {
    const {
      stroke: { current, previous },
      brush: { radius, opacity, hardness },
      tool,
      projection: { camera, viewDir, depthReader, worldQueryRadius },
    } = context;

    return {
      camera, viewDir, depthReader, worldQueryRadius,
      radius, opacity, hardness,
      tool,
      rect: current.rect,
      screenPos: current.screen,
      prevScreenPos: previous?.screen ?? null,
      worldCenter: current.point,
      prevWorldCenter: previous?.point ?? null,
    };
  }

  paintDab(context) {
    const p = this._getPaintParams(context);
    context.tool.onDabStart?.(context);

    const sweep = p.prevWorldCenter ? p.prevWorldCenter.distanceTo(p.worldCenter) : 0;
    const candidates = this._queryCandidates(p.worldCenter, (p.worldQueryRadius + sweep) * 1.5);

    const { width, height } = this.canvas;
    const data = this.imageData.data;

    const bary = new THREE.Vector3();
    const worldPos = new THREE.Vector3();
    const camLocal = new THREE.Vector3();
    const screenWorld = new THREE.Vector2();
    let touched = false;

    for (const tri of candidates) {
      if (p.viewDir && tri.normal.dot(p.viewDir) > -0.05) continue;

      const minU = Math.min(tri.uv0.u, tri.uv1.u, tri.uv2.u);
      const maxU = Math.max(tri.uv0.u, tri.uv1.u, tri.uv2.u);
      const minV = Math.min(tri.uv0.v, tri.uv1.v, tri.uv2.v);
      const maxV = Math.max(tri.uv0.v, tri.uv1.v, tri.uv2.v);

      const px0 = Math.max(0, Math.floor(minU * width));
      const px1 = Math.min(width - 1, Math.ceil(maxU * width));
      const py0 = Math.max(0, Math.floor((1 - maxV) * height));
      const py1 = Math.min(height - 1, Math.ceil((1 - minV) * height));

      for (let py = py0; py <= py1; py++) {
        const v = 1 - (py + 0.5) / height;
        for (let px = px0; px <= px1; px++) {
          const u = (px + 0.5) / width;
          if (!this._barycentricUV(u, v, tri, bary)) continue;

          worldPos.copy(tri.p0).multiplyScalar(bary.x)
            .addScaledVector(tri.p1, bary.y)
            .addScaledVector(tri.p2, bary.z);

          camLocal.copy(worldPos).applyMatrix4(p.camera.matrixWorldInverse);
          if (camLocal.z > 0) continue;

          this._projectToScreen(worldPos, p.camera, p.rect, screenWorld);

          const d = p.prevScreenPos
            ? this._distancePointToSegment2D(screenWorld, p.prevScreenPos, p.screenPos)
            : this._dist2D(screenWorld, p.screenPos);
          if (d > p.radius) continue;

          if (p.depthReader && !p.depthReader.isPointVisible(worldPos, p.camera)) continue;

          const a = this._falloff(d / p.radius, p.hardness) * p.opacity;
          if (a <= 0) continue;

          const idx = (py * width + px) * 4;
          p.tool.applyTexel(data, idx, a, { px, py, width, height });
          touched = true;
        }
      }
    }

    if (touched) this.ctx.putImageData(this.imageData, 0, 0);
    return touched;
  }

  _projectToScreen(worldPos, camera, rect, out) {
    const ndc = this._ndcTmp.copy(worldPos).project(camera);
    out.x = (ndc.x * 0.5 + 0.5) * rect.width;
    out.y = (-ndc.y * 0.5 + 0.5) * rect.height;
    return out;
  }

  _dist2D(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  _distancePointToSegment2D(p, a, b) {
    const abx = b.x - a.x, aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    if (len2 < 1e-8) return this._dist2D(p, a);
    let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
    t = THREE.MathUtils.clamp(t, 0, 1);
    return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
  }

  _barycentricUV(u, v, tri, out) {
    const { uv0, uv1, uv2 } = tri;
    const v0u = uv1.u - uv0.u, v0v = uv1.v - uv0.v;
    const v1u = uv2.u - uv0.u, v1v = uv2.v - uv0.v;
    const v2u = u - uv0.u, v2v = v - uv0.v;

    const den = v0u * v1v - v1u * v0v;
    if (Math.abs(den) < 1e-12) return false;

    const b = (v2u * v1v - v1u * v2v) / den;
    const c = (v0u * v2v - v2u * v0v) / den;
    const a = 1 - b - c;

    if (a < -1e-4 || b < -1e-4 || c < -1e-4) return false;
    out.set(a, b, c);
    return true;
  }

  _falloff(t, hardness) {
    if (t >= 1) return 0;
    if (t <= hardness) return 1;
    const s = (t - hardness) / (1 - hardness);
    return 1 - s * s * (3 - 2 * s);
  }
}