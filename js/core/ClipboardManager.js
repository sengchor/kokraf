import * as THREE from 'three';
import { ShadingUtils } from '../utils/ShadingUtils.js';
import { MeshData } from './MeshData.js';
import { AddObjectCommand } from "../commands/AddObjectCommand.js";
import { SequentialMultiCommand } from '../commands/SequentialMultiCommand.js';

export class ClipboardManager {
  static STORAGE_KEY = "kokraf.clipboard";

  constructor(editor) {
    this.editor = editor;
    this.sceneManager = editor.sceneManager;
    this.memoryPayload = null;
  }

  buildBaseClipboardItem(obj) {
    return {
      id: obj.uuid,
      parentId: obj.parent && !obj.parent.isScene
        ? obj.parent.uuid : null,
      name: obj.name || '',
      transform: {
        position: obj.position.toArray(),
        rotation: obj.quaternion.toArray(),
        scale: obj.scale.toArray(),
      },
    };
  }

  buildMeshClipboardItem(obj) {
    return {
      ...this.buildBaseClipboardItem(obj),
      type: 'mesh',
      meshData: obj.userData.meshData.toJSON(),
      materialData: obj.material?.toJSON(),
      shading: obj.userData.shading || 'flat',
    };
  }

  buildLightClipboardItem(obj) {
    const clone = obj.clone(false);
    clone.children.length = 0;

    return {
      ...this.buildBaseClipboardItem(obj),
      type: 'light',
      lightData: clone.toJSON(),
    }
  }

  buildCameraClipboardItem(obj) {
    const clone = obj.clone(false);
    clone.children.length = 0;

    return {
      ...this.buildBaseClipboardItem(obj),
      type: 'camera',
      cameraData: clone.toJSON(),
    };
  }

  buildGroupClipboardItem(obj) {
    return {
      ...this.buildBaseClipboardItem(obj),
      type: 'group',
    };
  }

  applyTransform(obj, transform) {
    obj.position.fromArray(transform.position);
    obj.quaternion.fromArray(transform.rotation);
    obj.scale.fromArray(transform.scale);
  }

  pasteMesh(item) {
    let meshData = structuredClone(item.meshData);
    if (!(meshData instanceof MeshData)) {
      meshData = MeshData.getRehydratedMeshData(meshData);
    }

    const material = item.materialData
      ? new THREE.MaterialLoader().parse(item.materialData)
      : new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        metalness: 0.5,
        roughness: 0.2,
        side: THREE.DoubleSide,
      });

    const geometry = ShadingUtils.createGeometryWithShading(meshData, item.shading);

    const obj = new THREE.Mesh(geometry, material);
    obj.userData.meshData = meshData;
    obj.userData.shading = item.shading;

    return obj;
  }

  pasteLight(item) {
    return new THREE.ObjectLoader().parse(item.lightData);
  }

  pasteCamera(item) {
    return new THREE.ObjectLoader().parse(item.cameraData);
  }

  pasteGroup(item) {
    return new THREE.Group();
  }

  copyObjects(objects) {
    if (!objects || objects.length === 0) return;

    const data = [];

    const allObjects = this.collectWithParents(objects);
    for (const obj of allObjects) {
      if (obj.isMesh && obj.userData?.meshData) {
        data.push(this.buildMeshClipboardItem(obj));
      } else if (obj.isLight) {
        data.push(this.buildLightClipboardItem(obj));
      } else if (obj.isCamera) {
        data.push(this.buildCameraClipboardItem(obj));
      } else if (obj.isGroup) {
        data.push(this.buildGroupClipboardItem(obj));
      }
    }

    if (data.length === 0) return;

    const payload = {
      app: "kokraf",
      version: 1,
      type: "object",
      timestamp: Date.now(),
      data,
    };

    this.memeoryPayload = payload;
    this._saveToStorage(payload);
  }

  pasteObjects() {
    const payload = this._getPayload();
    if (!payload || payload.type !== "object") return [];

    const objectMap = new Map();
    const createdObjects = [];
    const reservedNames = new Set();

    for (const item of payload.data) {
      let obj = null;

      switch (item.type) {
        case 'mesh': obj = this.pasteMesh(item); break;
        case 'light': obj = this.pasteLight(item); break;
        case 'camera': obj = this.pasteCamera(item); break;
        case 'group': obj = this.pasteGroup(item); break;
        default: continue;
      }

      this.applyTransform(obj, item.transform);
      
      const baseName = this.editor.nameManager.getBaseName(item.name || '');
      const uniqueName = this.editor.nameManager.generateUniqueNameWithReserved(baseName, reservedNames);
      obj.name = uniqueName;
      reservedNames.add(uniqueName);

      obj.uuid = THREE.MathUtils.generateUUID();

      objectMap.set(item.id, obj);
      createdObjects.push(obj);
    }

    // hierarchy reconstruction
    for (const item of payload.data) {
      const obj = objectMap.get(item.id);
      if (!obj) continue;

      if (item.parentId) {
        const parent = objectMap.get(item.parentId);
        if (parent) parent.add(obj);
      }
    }

    // find root objects
    const roots = [];
    for (const item of payload.data) {
      if (!item.parentId) {
        const root = objectMap.get(item.id);
        if (root) roots.push(root);
      }
    }

    const multi = new SequentialMultiCommand(this.editor, 'Paste Objects');
    for (const root of roots) {
      multi.add(() => new AddObjectCommand(this.editor, root));
    }

    this.editor.execute(multi);
    this.editor.selection.select(createdObjects);
    this.editor.toolbar.updateTools();

    return createdObjects;
  }

  _saveToStorage(payload) {
    try {
      localStorage.setItem(
        this.STORAGE_KEY,
        JSON.stringify(payload)
      );
    } catch (e) {
      console.error('Failed to save to storage: ', e);
    }
  }

  _loadFromStorage() {
    try {
      const raw = localStorage.getItem(this.STORAGE_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (parsed?.app !== "kokraf") return null;
      if (parsed?.version !== 1) return null;

      return parsed;
    } catch (e) {
      console.error('Failed to load from storage: ', e);
    }
  }

  _getPayload() {
    if (this.memoryPayload) return this.memeoryPayload;

    const stored = this._loadFromStorage();
    this.memeoryPayload = stored;
    return stored;
  }

  collectWithParents(objects) {
    const result = new Set();

    for (const obj of objects) {
      let current = obj;
      while (current) {
        result.add(current);
        current = current.parent && !current.parent.isScene
          ? current.parent : null;
      }
    }

    return Array.from(result);
  }
}