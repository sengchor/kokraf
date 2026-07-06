import * as THREE from 'three';
import { SetMaterialValueCommand } from '../commands/SetMaterialValueCommand.js';
import { SetMaterialColorCommand } from '../commands/SetMaterialColorCommand.js';

export class SidebarMaterial {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.viewportControls = editor.viewportControls;

    this.lastSelectedObject = null;
    this.materialSettingList = document.getElementById('material-properties-content');

    this.optionsPerType = {
      'MeshStandardMaterial': ['type', 'uuid', 'color', 'metalness', 'roughness', 'flatShading'],
      'ImageRefMaterial': ['type', 'uuid', 'side', 'opacity', 'depthTest', 'depthWrite'],
      'Default': ['type', 'uuid']
    }
    this.options = null;

    this.currentMode = this.viewportControls.currentMode;
    if (this.currentMode === 'paint') {
      this.selectObject(this.viewportControls.texturePainter?.object);
    }

    this.setupListeners();
  }

  setupListeners() {
    this.signals.objectSelected.add(selectedObjects => {
      if (this.currentMode !== 'object') return;

      const count = selectedObjects.length;
      const object = (count === 1) ? selectedObjects[0] : null;
      this.selectObject(object);
    });

    this.signals.setPaintObjectPanel.add(object => {
      this.selectObject(object || null);
    });

    this.signals.modeChanged.add(mode => {
      this.currentMode = mode;
    });
  }

  selectObject(object) {
    const inputs = Array.from(document.querySelectorAll('.properties-content .number-input, .properties-content .text-input, .properties-content .color-input'));
    inputs.forEach(input => {
      if (document.activeElement === input) {
        input.blur();
      }
    });

    this.lastSelectedObject = object;

    if (!object) {
      this.materialSettingList.innerHTML = '';
      return;
    }

    this.materialSettingList.innerHTML = '';
    this.options = this.getOptionsFor(object);
    this.fields = {};
    this.options.forEach(option => {
      const element = this.generateSettingOptionHTML(option);
      if (element) this.materialSettingList.appendChild(element);
    });

    this.initUI();
    this.setupSettingInput();

    this.updateFields(object);

    this.signals.objectChanged.add(() => this.updateFields(this.lastSelectedObject));
  }

  getOptionsFor(object) {
    if (!object) return [];
    if (!object.material) return [];

    let type = object.material.type;
    if (object.userData.isImageRef) { 
      type = 'ImageRefMaterial'; 
    }
    return this.optionsPerType[type] || this.optionsPerType['Default'];
  }

  initUI() {
    this.fields = {
      type: document.getElementById('material-type'),
      uuid: document.getElementById('material-uuid'),
      color: document.getElementById('material-color'),
      metalness: document.getElementById('material-metalness'),
      roughness: document.getElementById('material-roughness'),
      flatShading: document.getElementById('material-flatShading'),
      opacity: document.getElementById('material-opacity'),
      side: document.getElementById('material-side'),
      depthTest: document.getElementById('material-depthTest'),
      depthWrite: document.getElementById('material-depthWrite'),
    }
  }

  generateSettingOptionHTML(option) {
    const li = document.createElement('li');
    li.className = 'setting-option';

    switch (option) {
      case 'type': {
        li.innerHTML = `
          <span class="label">Type</span>
          <span class="label-value" id="material-type">Mesh</span>
        `;
        break;
      }
      case 'uuid': {
        li.innerHTML = `
          <span class="label">UUID</span>
          <input class="text-input uuid-input" id="material-uuid" type="text" maxlength="40"
          style="padding: 2px; background-color: transparent;" readonly />
        `;
        break;
      }
      case 'color': {
        li.innerHTML = `
          <span class="label">Color</span>
          <input class="color-input" id="material-color" type="color" />
        `;
        break;
      }
      case 'metalness': {
        li.innerHTML = `
          <span class="label">Metalness</span>
          <input class="number-input" id="material-metalness" type="number" min="0" max="1" step="0.01" value="0" onclick="this.select()" onkeydown="handleEnter(event, this)" />
        `;
        break;
      }
      case 'roughness': {
        li.innerHTML = `
          <span class="label">Roughness</span>
          <input class="number-input" id="material-roughness" type="number" min="0" max="1" step="0.01" value="0" onclick="this.select()" onkeydown="handleEnter(event, this)" />
        `;
        break;
      }
      case 'flatShading': {
        li.innerHTML = `
          <span class="label">Flat Shading</span>
          <input type="checkbox" id="material-flatShading" checked/>
        `;
        break;
      }
      case 'opacity': {
        li.innerHTML = `
          <span class="label">Opacity</span>
          <input class="number-input" id="material-opacity" type="number" min="0" max="1" step="0.01" value="1" onclick="this.select()" onkeydown="handleEnter(event, this)" />
        `;
        break;
      }
      case 'side': {
        li.innerHTML = `
          <span class="label">Side</span>
          <select class="select-input" id="material-side">
            <option value="0">Front</option>
            <option value="1">Back</option>
            <option value="2">Both</option>
          </select>
        `;
        break;
      }
      case 'depthTest': {
        li.innerHTML = `
          <span class="label">Depth Test</span>
          <input type="checkbox" id="material-depthTest" checked/>
        `;
        break;
      }
      case 'depthWrite': {
        li.innerHTML = `
          <span class="label">Depth Write</span>
          <input type="checkbox" id="material-depthWrite" checked/>
        `;
        break;
      }
    }

    return li;
  }

  updateFields(object) {
    if (!object || !object.material) return;

    const material = object.material;
    const f = this.fields;
    const fix = (v, d = 3) => Number(v).toFixed(d);

    for (const option of this.options) {
      switch (option) {
        case 'type':
          if (object.userData.isImageRef) {
            f.type.textContent = 'ImageRefMaterial';
            break;
          }

          f.type.textContent = material.type || 'Unknown';
          break;
        case 'uuid':
          f.uuid.value = material.uuid || '';
          break;
        case 'color':
          f.color.value = `#${material.color.getHexString()}`;
          break;
        case 'metalness':
          f.metalness.value = fix(material.metalness, 2);
          break;
        case 'roughness':
          f.roughness.value = fix(material.roughness, 2);
          break;
        case 'flatShading':
          f.flatShading.checked = !!material.flatShading;
          break;
        case 'opacity':
          f.opacity.value = fix (material.opacity, 2);
          break;
        case 'side':
          f.side.value = material.side;
          break;
        case 'depthTest':
          f.depthTest.checked = !!material.depthTest;
          break;
        case 'depthWrite':
          f.depthWrite.checked = !!material.depthWrite;
          break;
      }
    }
  }

  bindInput(input, getValue, apply) {
    if (!input) return;
    input.addEventListener('change', function() {
      const object = this.lastSelectedObject;
      if (!object) return;
      const value = getValue();
      apply(object, value);
    }.bind(this));
  }

  bindCheckbox(checkbox, key) {
    this.bindInput(checkbox, function() {
      return checkbox.checked;
    }, function(object, value) {
      this.editor.execute(new SetMaterialValueCommand(this.editor, object, key, value));
    }.bind(this));
  }

  setupSettingInput() {
    const f = this.fields;

    for (const option of this.options) {
      switch (option) {
        case 'color':
          this.bindInput(f.color, () => new THREE.Color(f.color.value), (object, value) => {
            const currentHex = object.material.color.getHex();
            const newHex = value.getHex();
            if (currentHex !== newHex) {
              this.editor.execute(new SetMaterialColorCommand(this.editor, object, 'color', newHex));
            }
          });
          break;

        case 'metalness':
          this.bindInput(f.metalness, () => this.clampInput(f.metalness), (object, value) => {
            if (object.material.metalness !== value) {
              this.editor.execute(new SetMaterialValueCommand(this.editor, object, 'metalness', value));
            }
          });
          break;

        case 'roughness':
          this.bindInput(f.roughness, () => this.clampInput(f.roughness), (object, value) => {
            if (object.material.roughness !== value) {
              this.editor.execute(new SetMaterialValueCommand(this.editor, object, 'roughness', value));
            }
          });
          break;

        case 'flatShading':
          this.bindCheckbox(f.flatShading, 'flatShading');
          break;

        case 'opacity':
          this.bindInput(f.opacity, () => this.clampInput(f.opacity), (object, value) => {
            if (object.material.opacity !== value) {
              this.editor.execute(new SetMaterialValueCommand(this.editor, object, 'opacity', value));
            }
          });
          break;

        case 'side':
          this.bindInput(f.side, () => parseFloat(f.side.value), (object, value) => {
            if (object.material.side !== value) {
              this.editor.execute(new SetMaterialValueCommand(this.editor, object, 'side', value));
            }
          });
          break;

        case 'depthTest':
          this.bindCheckbox(f.depthTest, 'depthTest');
          break;

        case 'depthWrite':
          this.bindCheckbox(f.depthWrite, 'depthWrite');
          break;
      }
    }
  }

  clampInput(input) {
    const value = parseFloat(input.value);
    const min = input.min !== '' ? parseFloat(input.min) : -Infinity;
    const max = input.max !== '' ? parseFloat(input.max) : Infinity;
    const clamped = Math.min(Math.max(value, min), max);
    input.value = clamped;
    return clamped;
  }
}