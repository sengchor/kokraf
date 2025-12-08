import * as THREE from 'three';
import { SetMaterialValueCommand } from '../commands/SetMaterialValueCommand.js';
import { SetMaterialColorCommand } from '../commands/SetMaterialColorCommand.js';

export class SidebarMaterial {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.lastSelectedObject = null;
    this.materialSettingList = document.getElementById('material-properties-content');

    this.optionsPerType = {
      'MeshStandardMaterial': ['type', 'uuid', 'color', 'metalness', 'roughness', 'flatShading'],
      'Default': ['type', 'uuid']
    }
    this.options = null;

    this.setupListeners();
  }

  setupListeners() {
    this.signals.objectSelected.add(selectedObjects => {
      const inputs = Array.from(document.querySelectorAll('.properties-content .number-input, .properties-content .text-input, .properties-content .color-input'));
      inputs.forEach(input => {
        if (document.activeElement === input) {
          input.blur();
        }
      });

      const count = selectedObjects.length;
      const object = (count === 1) ? selectedObjects[0] : null;
      this.lastSelectedObject = object;

      if (count !== 1) {
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
    });

    this.signals.objectChanged.add(() => this.updateFields(this.lastSelectedObject));
  }

  getOptionsFor(object) {
    if (!object) return [];
    if (!object.material) return [];

    const type = object.material.type;
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
        case 'roughness':
          f.roughness.value = fix(material.roughness, 2);
        case 'flatShading':
          f.flatShading.checked = !!material.flatShading;
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
          this.bindInput(f.metalness, () => parseFloat(f.metalness.value), (object, value) => {
            if (object.material.metalness !== value) {
              this.editor.execute(new SetMaterialValueCommand(this.editor, object, 'metalness', value));
            }
          });
          break;

        case 'roughness':
          this.bindInput(f.roughness, () => parseFloat(f.roughness.value), (object, value) => {
            if (object.material.roughness !== value) {
              this.editor.execute(new SetMaterialValueCommand(this.editor, object, 'roughness', value));
            }
          });
          break;

        case 'flatShading':
          this.bindCheckbox(f.flatShading, 'flatShading');
          break;
      }
    }
  }
}