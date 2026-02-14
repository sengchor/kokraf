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

  copyObjects(objects) {
    if (!objects || objects.length === 0) return;

    const data = [];

    for (const obj of objects) {
      const meshData = obj?.userData?.meshData;
      if (!meshData) continue;

      data.push({
        type: 'mesh',
        name: obj.name || '',
        transform: {
          position: obj.position.toArray(),
          rotation: obj.quaternion.toArray(),
          scale: obj.scale.toArray(),
        },
        meshData: meshData.toJSON(),
        materialData: obj.material?.toJSON(),
        shading: obj.userData.shading,
      });

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
  }

  pasteObjects() {
    const payload = this._getPayload();
    if (!payload || payload.type !== "object") return [];

    const createdObjects = [];

    for (const item of payload.data) {
      let meshData = structuredClone(item.meshData);
      if (!(meshData instanceof MeshData)) {
        meshData = MeshData.getRehydratedMeshData(meshData);
      }

      let material;
      if (item.materialData) {
        material = new THREE.MaterialLoader().parse(item.materialData);
      } else {
        material = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.5, roughness: 0.2, side: THREE.DoubleSide });
      }
      
      const geometry = ShadingUtils.createGeometryWithShading(meshData, item.shading);
      const obj = new THREE.Mesh(geometry, material);

      obj.position.fromArray(item.transform.position);
      obj.quaternion.fromArray(item.transform.rotation);
      obj.scale.fromArray(item.transform.scale);

      obj.userData.meshData = meshData;
      obj.userData.shading = item.shading;

      obj.uuid = THREE.MathUtils.generateUUID();
      obj.name = item.name || 'object';

      createdObjects.push(obj);
    }

    const multi = new SequentialMultiCommand(this.editor, 'Add Objects');
    for (const object of createdObjects) {
      multi.add(() => new AddObjectCommand(this.editor, object));
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
}