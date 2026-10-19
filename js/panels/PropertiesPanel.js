import { MeshDataBuilders } from '../utils/MeshDataBuilders.js';
import { MeshRendererAdapter } from '../geometry/MeshRendererAdapter.js';
import { AddObjectCommand } from '../commands/AddObjectCommand.js';

const PARAM_LABELS = {
  width: 'Width',
  height: 'Height',
  depth: 'Depth',
  radius: 'Radius',
  height: 'Height',
  radialSegments: 'Radial Segments',
  tubularSegments: 'Tubular Segments',
  tube: 'Tube Radius',
  widthSegments: 'Width Segments',
  heightSegments: 'Height Segments',
  depthSegments: 'Depth Segments',
  segments: 'Segments',
};

export class PropertiesPanel {
  constructor(editor, containerElement) {
    this.editor = editor;
    this.container = containerElement;
    this.command = null;
    this.selectedType = null;
    this.params = null;

    this.setupListener();
  }

  get selectedObject() {
    return this.command?.object ?? null;
  }

  isActive() {
    return !!this.command && this.editor.history.undos.at(-1) === this.command;
  }

  setupListener() {
    document.addEventListener('pointerdown', (e) => {
      if (!this.command) return;
      if (e.button === 1) return;

      if (this.container.contains(e.target)) return;

      this.clear();
    }, true);

    document.addEventListener('keydown', (e) => {
      if (!this.command) return;

      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      this.clear();
    }, true);
  }

  setSelected(command, geometryType, params) {
    this.command = command;
    this.selectedType = geometryType;
    this.params = { ...params };
    this.render();
  }

  clear() {
    this.command = null;
    this.selectedType = null;
    this.params = null;
    this.container.style.display = 'none';
    this.container.innerHTML = '';
  }

  render() {
    this.container.style.display = 'block';
    this.container.innerHTML = '';

    if (!this.selectedObject || !this.selectedType || !this.params) {
      this.container.innerHTML = '<p>No editable object selected.</p>';
      return;
    }

    const title = document.createElement('h3');
    title.textContent = `${this.selectedType} Properties`;
    this.container.appendChild(title);

    for (const [key, value] of Object.entries(this.params)) {
      this.createInputRow(key, value);
    }
  }

  createInputRow(key, currentValue) {
    const row = document.createElement('div');
    row.classList.add('property-row');

    const label = document.createElement('label');
    label.textContent = this.getDisplayName(key);

    const input = document.createElement('input');
    input.type = 'number';
    input.value = currentValue;
    
    if (key.toLowerCase().includes('segments')) {
      input.step = 1;
      input.min = 3;
    } else {
      input.step = 0.1;
      input.min = 0.01;
    }

    input.addEventListener('input', (e) => {
      const newValue = parseFloat(e.target.value);

      if (Number.isNaN(newValue)) return;

      if (key.toLowerCase().includes('segments')) {
        if (newValue <= 2) return;
      } else {
        if (newValue <= 0) return;
      }
      this.updateMeshGeometry(key, newValue);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      }
    });

    row.appendChild(label);
    row.appendChild(input);
    this.container.appendChild(row);
  }

  updateMeshGeometry(paramKey, newValue) {
    if (!this.isActive()) { this.clear(); return; }
    const object = this.selectedObject;

    this.params[paramKey] = newValue;

    const type = this.selectedType;
    let newMeshData;

    switch (type) {
      case 'Plane':
        newMeshData = MeshDataBuilders.createPlaneMeshData(this.params);
        break;
      case 'Cube':
        newMeshData = MeshDataBuilders.createCubeMeshData(this.params);
        break;
      case 'Circle':
        newMeshData = MeshDataBuilders.createCircleMeshData(this.params);
        break;
      case 'Sphere':
        newMeshData = MeshDataBuilders.createSphereMeshData(this.params);
        break;
      case 'Cylinder':
        newMeshData = MeshDataBuilders.createCylinderMeshData(this.params);
        break;
      case 'Cone':
        newMeshData = MeshDataBuilders.createConeMeshData(this.params);
        break;
      case 'Torus':
        newMeshData = MeshDataBuilders.createTorusMeshData(this.params);
        break;
    }

    const { geometry, renderBuffer } = MeshRendererAdapter.toBufferGeometry(newMeshData, { mode: object.userData.shading || "flat" });

    const oldGeometry = object.geometry;
    object.geometry = geometry;
    oldGeometry.dispose();

    object.userData.meshData = newMeshData;
    object.userData.renderBuffer = renderBuffer;

    this.editor.signals.sceneGraphChanged.dispatch();
    this.editor.signals.historyChanged.dispatch();
  }

  getDisplayName(key) {
    return (
      PARAM_LABELS[key] ??
      key
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (c) => c.toUpperCase())
    );
  }
}