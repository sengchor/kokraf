import * as THREE from 'three';
import { MeshData } from '../core/MeshData.js';
import { MeshRendererAdapter } from '../geometry/MeshRendererAdapter.js';
import { ApplyMirrorCommand } from '../commands/ApplyMirrorCommand.js';
import { MeshDataRegion } from '../core/MeshDataRegion.js';

const AXES = ['x', 'y', 'z'];
const DATA_AXIS = { x: 'x', y: 'z', z: 'y' };
const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
const _box = new THREE.Box3();

const _inv = new THREE.Matrix4();
const _local = new THREE.Vector3();

export const DEFAULT_MIRROR_SETTINGS = {
  enabled: false,
  axes: { x: true, y: false, z: false },
  clipping: false,
  merge: true,
  mergeDistance: 0.001,
};

export default class MirrorManager {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.sceneManager = editor.sceneManager;

    this.previewRoot = null;
    this.previews = new Map(); // object.uuid -> { object, mesh }
    this.dirty = new Set();
    this._needsRescan = false;
    this._frame = null;
    this._clip = null;

    this.signals.objectAdded.add(() => this._scheduleRescan());
    this.signals.objectRemoved.add(() => this._scheduleRescan());
    this.signals.emptyScene.add(() => this.clearAll());
    this.signals.objectChanged.add(() => this._scheduleRescan());
    this.signals.vertexPositionsUpdated.add(() => this._scheduleRescan());
  }

  // ---------- Settings ----------

  getSettings(object) {
    if (!object?.userData?.meshData) return null;
    object.userData.mirror ??= structuredClone(DEFAULT_MIRROR_SETTINGS);
    return object.userData.mirror;
  }

  isEnabled(object) {
    return !!object?.userData?.mirror?.enabled;
  }

  setSettings(object, patch) {
    const s = this.getSettings(object);
    if (!s) return;

    Object.assign(s, patch, { axes: { ...s.axes, ...patch.axes } });

    this.markDirty(object);
    this.signals.mirrorChanged?.dispatch(object);
  }

  resolveSettings(object, patch) {
    const current = object?.userData?.mirror ?? DEFAULT_MIRROR_SETTINGS;
    return {
      ...structuredClone(current),
      ...patch,
      axes: { ...current.axes, ...patch.axes },
    };
  }

  getActiveAxes(s) {
    return AXES.filter(a => s.axes[a]).map(a => DATA_AXIS[a]);
  }

  // ---------- Scheduling (at most one rebuild per object per frame) ----------

  markDirty(object) {
    if (!object) return;
    this.dirty.add(object);
    this._schedule();
  }

  _scheduleRescan() {
    this._needsRescan = true;
    this._schedule();
  }

  _schedule() {
    if (this._frame) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = null;
      if (this._needsRescan) this._rescan();
      for (const object of this.dirty) this.updatePreview(object);
      this.dirty.clear();
    });
  }

  _rescan() {
    this._needsRescan = false;

    for (const { object } of [...this.previews.values()]) {
      if (!this._isInScene(object)) this.removePreview(object);
    }

    this.sceneManager.mainScene.traverse((obj) => {
      if (!obj.userData?.isEditorOnly && obj.userData?.mirror?.enabled) {
        this.dirty.add(obj);
      }
    });
  }

  _isInScene(object) {
    let o = object;
    while (o.parent) o = o.parent;
    return o === this.sceneManager.mainScene;
  }

  // ---------- Preview ----------

  updatePreview(object) {
    const s = object.userData?.mirror;
    const meshData = object.userData?.meshData;

    if (!s?.enabled || !meshData || this.getActiveAxes(s).length === 0 || !this._isInScene(object)) {
      this.removePreview(object);
      return;
    }

    const originalFaceIdLimit = meshData.nextFaceId;
    const evaluated = this.buildMirroredMeshData(meshData, s);

    const rb = object.userData.renderBuffer;
    const { geometry, renderBuffer } = MeshRendererAdapter.toBufferGeometry(evaluated, {
      mode: rb?.normalMode ?? 'auto',
      angle: rb?.normalAngle ?? 60,
    });

    // Keep only the mirrored faces; the original object draws its own half
    const src = geometry.index.array;
    const indices = [];
    for (const [faceId, offset] of renderBuffer.faceTriangleOffset) {
      if (faceId < originalFaceIdLimit) continue;
      const count = renderBuffer.faceTriangleCount.get(faceId);
      for (let i = 0; i < count; i++) indices.push(src[offset + i]);
    }
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));

    const localBox = new THREE.Box3();
    for (const v of evaluated.vertices.values()) localBox.expandByPoint(v.position);
    geometry.boundingBox = localBox;
    geometry.boundingSphere = localBox.getBoundingSphere(new THREE.Sphere());

    let entry = this.previews.get(object.uuid);

    if (entry) {
      entry.mesh.geometry.dispose();
      entry.mesh.geometry = geometry;
    } else {
      entry = { object, mesh: this._createPreviewMesh(object, geometry) };
      this.previews.set(object.uuid, entry);
    }

    entry.mesh.material = object.material;
    entry.mesh.castShadow = object.castShadow;
    entry.mesh.receiveShadow = object.receiveShadow;
  }

  _createPreviewMesh(object, geometry) {
    const mesh = new THREE.Mesh(geometry, object.material);
    mesh.name = '__MirrorPreview';
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.userData.isEditorOnly = true;
    mesh.userData.object = object;

    mesh.raycast = (raycaster, intersects) => {
      if (!object.visible || !object.parent) return;
      mesh.matrixWorld.copy(object.matrixWorld);
      THREE.Mesh.prototype.raycast.call(mesh, raycaster, intersects);
    };

    // Follow the original's world matrix (hidden or removed: draw nothing)
    const sync = () => {
      const visible = object.visible && object.parent;
      mesh.matrixWorld.copy(visible ? object.matrixWorld : ZERO_MATRIX);
    };
    mesh.onBeforeRender = sync;
    mesh.onBeforeShadow = sync;

    if (!this.previewRoot) {
      this.previewRoot = new THREE.Group();
      this.previewRoot.name = '__MirrorPreviews';
      this.previewRoot.userData.isEditorOnly = true;
    }
    const scene = this.sceneManager.mainScene;
    if (this.previewRoot.parent !== scene) scene.add(this.previewRoot);

    this.previewRoot.add(mesh);
    return mesh;
  }

  removePreview(object) {
    const entry = this.previews.get(object.uuid);
    if (!entry) return;

    entry.mesh.geometry.dispose();
    entry.mesh.removeFromParent();
    this.previews.delete(object.uuid);
  }

  getPreviewMesh(object) {
    return this.previews.get(object.uuid)?.mesh ?? null;
  }

  expandWorldBox(object, box) {
    const mesh = this.getPreviewMesh(object);
    const local = mesh?.geometry.boundingBox;
    if (!local || local.isEmpty() || !object.visible || !object.parent) return box;

    _box.copy(local).applyMatrix4(object.matrixWorld);
    return box.union(_box);
  }

  clearAll() {
    for (const { object } of [...this.previews.values()]) this.removePreview(object);
    this.previewRoot?.removeFromParent();
    this.dirty.clear();

    if (this._frame) cancelAnimationFrame(this._frame);
    this._frame = null;
    this._needsRescan = false;
  }

  // Wrap scene serialization so previews never get saved
  withoutPreviews(fn) {
    const parent = this.previewRoot?.parent;
    parent?.remove(this.previewRoot);
    try {
      return fn();
    } finally {
      parent?.add(this.previewRoot);
    }
  }

  // ---------- Clipping (edit mode transforms) ----------
  createClip(object, vertexIds) {
    const s = object?.userData?.mirror;
    const meshData = object?.userData?.meshData;
    if (!s?.enabled || !s.clipping || !meshData) return null;

    const axes = this.getActiveAxes(s);
    if (!axes.length) return null;

    // Starting side per vertex per axis: 0 = on the plane (locked), ±1 = side it may not cross
    const sides = vertexIds.map(id => {
      const p = meshData.getVertex(id)?.position;
      return p && axes.map(a => (Math.abs(p[a]) <= s.mergeDistance ? 0 : Math.sign(p[a])));
    });

    // Clamps world positions in place (index-aligned with vertexIds)
    return (worldPositions) => {
      _inv.copy(object.matrixWorld).invert();

      worldPositions.forEach((wp, i) => {
        const side = sides[i];
        if (!side) return;

        _local.copy(wp).applyMatrix4(_inv);
        let hit = false;

        axes.forEach((a, j) => {
          if (_local[a] * side[j] <= 0) { _local[a] = 0; hit = true; }
        });

        if (hit) wp.copy(_local).applyMatrix4(object.matrixWorld);
      });
    }
  }

  // ---------- Build / Apply ----------
  buildMirroredMeshData(meshData, s, seams = null) {
    // toJSON() copies positions; existing UV arrays are only read, never mutated
    const result = MeshData.getRehydratedMeshData(meshData.toJSON());
    for (const axis of this.getActiveAxes(s)) {
      this._mirrorAxis(result, axis, s, seams);
    }
    return result;
  }

  _mirrorAxis(mesh, axis, s, seams = null) {
    const vertices = [...mesh.vertices.values()];
    const faces = [...mesh.faces.values()];
    const looseEdges = [...mesh.edges.values()].filter(e => e.faceIds.size === 0);

    // Vertices within merge range of their reflection weld onto the plane
    const map = new Map();
    for (const v of vertices) {
      if (s.merge && Math.abs(v.position[axis]) * 2 <= s.mergeDistance) {
        v.position[axis] = 0;
        map.set(v.id, v);
      } else {
        const p = v.position.clone();
        p[axis] = -p[axis];
        map.set(v.id, mesh.addVertex(p));
      }
    }

    // Reversed corner order keeps the mirrored winding outward
    for (const f of faces) {
      const idBefore = mesh.nextFaceId;
      const newFace = mesh.addFace(f.vertexIds.map(id => map.get(id)).reverse());

      // Faces lying on the plane dedupe to themselves; only new faces get UVs
      if (newFace.id < idBefore) continue;

      const faceUVs = mesh.uvs.get(f.id);
      if (faceUVs) {
        mesh.uvs.set(newFace.id, [...faceUVs].reverse().map(c => ({ u: c.u, v: c.v })));
      }
    }

    for (const e of looseEdges) {
      mesh.addEdge(map.get(e.v1Id), map.get(e.v2Id));
    }

    if (seams) {
      for (const id of [...seams]) {
        const e = mesh.edges.get(id);
        if (!e) continue;
        const mirrored = mesh.getEdge(map.get(e.v1Id).id, map.get(e.v2Id).id);
        if (mirrored) seams.add(mirrored.id);
      }
    }
  }

  applyMirror(object) {
    const s = object?.userData?.mirror;
    const meshData = object?.userData?.meshData;
    if (!s?.enabled || !meshData || this.getActiveAxes(s).length === 0) return;

    const beforeDelta = MeshDataRegion.snapshot(meshData, {
      vertexIds: [...meshData.vertices.keys()],
      edgeIds: [...meshData.edges.keys()],
      faceIds: [...meshData.faces.keys()],
    });

    const startElements = {
      startVertexId: meshData.nextVertexId,
      startEdgeId: meshData.nextEdgeId,
      startFaceId: meshData.nextFaceId,
    };

    const seams = new Set(object.userData.seam ?? []);
    const evaluated = this.buildMirroredMeshData(meshData, s, seams);

    MeshDataRegion.captureNewElements(evaluated, startElements, beforeDelta);
    const afterDelta = MeshDataRegion.snapshot(evaluated, MeshDataRegion.idsOf(beforeDelta));

    const seamsAfter = [...seams].filter(id => evaluated.edges.has(id));

    this.editor.execute(new ApplyMirrorCommand(this.editor, object, beforeDelta, afterDelta, s, seamsAfter));
  }
}