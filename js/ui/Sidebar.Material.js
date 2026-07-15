import * as THREE from 'three';
import { SetMaterialValueCommand } from '../commands/SetMaterialValueCommand.js';
import { SetMaterialColorCommand } from '../commands/SetMaterialColorCommand.js';
import { SetMaterialMapCommand } from '../commands/SetMaterialMapCommand.js';

export class SidebarMaterial {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.viewportControls = editor.viewportControls;

    this.lastSelectedObject = null;
    this.materialSettingList = document.getElementById('material-properties-content');

    this.optionsPerType = {
      'MeshStandardMaterial': ['type', 'uuid', 'color', 'metalness', 'roughness', 'normal'],
      'ImageRefMaterial': ['type', 'uuid', 'side', 'opacity', 'depthTest', 'depthWrite'],
      'Default': ['type', 'uuid']
    }
    this.options = null;

    this.channelPairs = {
      map: 'color',
      metalnessMap: 'metalness',
      roughnessMap: 'roughness',
      normalMap: 'normal',
    };

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

    const material = this._getMaterial(object);
    if (!material) return [];

    let type = material.type;
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
      opacity: document.getElementById('material-opacity'),
      side: document.getElementById('material-side'),
      depthTest: document.getElementById('material-depthTest'),
      depthWrite: document.getElementById('material-depthWrite'),
    };

    ['map', 'metalnessMap', 'roughnessMap', 'normalMap'].forEach(key => {
      const companion = this.channelPairs[key];
      this.fields[key] = {
        slot: document.getElementById(`material-${key}-slot`),
        preview: document.getElementById(`material-${key}-preview`),
        name: document.getElementById(`material-${key}-name`),
        placeholder: document.getElementById(`material-${key}-placeholder`),
        clear: document.getElementById(`material-${key}-clear`),
        file: document.getElementById(`material-${key}-file`),
        valueContainer: companion ? document.getElementById(`material-${companion}-value`) : null,
      };
    });
  }

  generateSettingOptionHTML(option) {
    switch (option) {
      case 'color':
        return this.createChannelRow('color', 'Base Color', 'map',
          `<input class="color-input" id="material-color" type="color" />`);
      case 'metalness':
        return this.createChannelRow('metalness', 'Metalness', 'metalnessMap',
          `<input class="number-input" id="material-metalness" type="number" min="0" max="1" step="0.01" value="0" onclick="this.select()" onkeydown="handleEnter(event, this)" />`);
      case 'roughness':
        return this.createChannelRow('roughness', 'Roughness', 'roughnessMap',
          `<input class="number-input" id="material-roughness" type="number" min="0" max="1" step="0.01" value="0" onclick="this.select()" onkeydown="handleEnter(event, this)" />`);
      case 'normal':
        return this.createChannelRow('normal', 'Normal', 'normalMap', null);
    }

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

  createChannelRow(key, label, mapKey, valueInputHTML) {
    const wrapper = document.createElement('li');
    wrapper.className = 'setting-option channel-option';
    wrapper.innerHTML = `
      <div class="channel-top">
        <span class="label">${label}</span>
        ${valueInputHTML ? `
        <div class="channel-value" id="material-${key}-value">
          ${valueInputHTML}
        </div>` : ''}
      </div>
      <div class="texture-slot" id="material-${mapKey}-slot">
        <div class="texture-preview" id="material-${mapKey}-preview"></div>
        <span class="texture-placeholder" id="material-${mapKey}-placeholder">Click to add texture</span>
        <span class="texture-name" id="material-${mapKey}-name"></span>
        <button type="button" class="texture-clear" id="material-${mapKey}-clear" title="Remove texture">×</button>
      </div>
      <input type="file" accept="image/*" id="material-${mapKey}-file" style="display:none" />
    `;
    return wrapper;
  }

  updateFields(object) {
    if (!object) return;

    const material = this._getMaterial(object);
    if (!material) return;

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
          this.updateTextureField('map', material.map);
          break;
        case 'metalness':
          f.metalness.value = fix(material.metalness, 2);
          this.updateTextureField('metalnessMap', material.metalnessMap);
          break;
        case 'roughness':
          f.roughness.value = fix(material.roughness, 2);
          this.updateTextureField('roughnessMap', material.roughnessMap);
          break;
        case 'normal':
          this.updateTextureField('normalMap', material.normalMap);
          break;
        case 'opacity':
          f.opacity.value = fix(material.opacity, 2);
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

  updateTextureField(key, texture) {
    const field = this.fields[key];
    if (!field) return;

    const hasTexture = !!texture;
    field.slot.classList.toggle('has-texture', hasTexture);

    if (field.valueContainer) {
      field.valueContainer.style.display = hasTexture ? 'none' : '';
    }

    if (!hasTexture) {
      field.preview.style.backgroundImage = '';
      field.name.textContent = '';
      return;
    }

    field.name.textContent = texture.name || texture.image?.name || 'Texture';

    const src = this.getTexturePreviewSrc(texture);
    field.preview.style.backgroundImage = src ? `url(${src})` : '';
  }

  getTexturePreviewSrc(texture) {
    const image = texture.image;
    if (!image) return null;
    if (image instanceof HTMLCanvasElement) return image.toDataURL();
    if (image.src) return image.src;
    return null;
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
            const material = this._getMaterial(object);
            const currentHex = material.color.getHex();
            const newHex = value.getHex();
            if (currentHex !== newHex) {
              this.editor.execute(new SetMaterialColorCommand(this.editor, object, 'color', newHex));
            }
          });
          this.bindTextureSlot('map');
          break;

        case 'metalness':
          this.bindInput(f.metalness, () => this.clampInput(f.metalness), (object, value) => {
            const material = this._getMaterial(object);
            if (material.metalness !== value) {
              this.editor.execute(new SetMaterialValueCommand(this.editor, object, 'metalness', value));
            }
          });
          this.bindTextureSlot('metalnessMap');
          break;

        case 'roughness':
          this.bindInput(f.roughness, () => this.clampInput(f.roughness), (object, value) => {
            const material = this._getMaterial(object);
            if (material.roughness !== value) {
              this.editor.execute(new SetMaterialValueCommand(this.editor, object, 'roughness', value));
            }
          });
          this.bindTextureSlot('roughnessMap');
          break;

        case 'normal':
          this.bindTextureSlot('normalMap');
          break;

        case 'opacity':
          this.bindInput(f.opacity, () => this.clampInput(f.opacity), (object, value) => {
            const material = this._getMaterial(object);
            if (material.opacity !== value) {
              this.editor.execute(new SetMaterialValueCommand(this.editor, object, 'opacity', value));
            }
          });
          break;

        case 'side':
          this.bindInput(f.side, () => parseFloat(f.side.value), (object, value) => {
            const material = this._getMaterial(object);
            if (material.side !== value) {
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

  bindTextureSlot(key) {
    const field = this.fields[key];
    if (!field) return;

    const isColorMap = key === 'map';
    const companion = this.channelPairs[key];

    if (field.btn) {
      field.btn.addEventListener('click', (e) => {
        e.stopPropagation();
        field.file.click();
      });
    }

    field.slot.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target === field.clear) return;
      field.file.click();
    });

    field.file.addEventListener('change', () => {
      const object = this.lastSelectedObject;
      const file = field.file.files[0];
      if (!object || !file) return;

      const material = this._getMaterial(object);
      const oldTexture = material[key];
      oldTexture?.dispose();

      const reader = new FileReader();
      reader.addEventListener('load', (event) => {
        const base64Url = event.target.result;

        new THREE.TextureLoader().load(base64Url, (texture) => {
          texture.name = file.name;
          texture.colorSpace = isColorMap ? THREE.SRGBColorSpace : THREE.NoColorSpace;
          texture.needsUpdate = true;

          const scalarReset = companion ? 
            { key: companion, newValue: this.neutralValueFor(companion) } : null;
          
          this.editor.execute(new SetMaterialMapCommand(this.editor, object, key, texture, scalarReset));
          this.updateTextureField(key, texture);
        });
      });

      reader.readAsDataURL(file);
      field.file.value = '';
    });

    field.clear.addEventListener('click', (e) => {
      e.stopPropagation();
      const object = this.lastSelectedObject;
      const material = this._getMaterial(object);
      if (!object || !material[key]) return;

      this.editor.execute(new SetMaterialMapCommand(this.editor, object, key, null, null));
      this.updateTextureField(key, null);
    });
  }

  neutralValueFor(scalarKey) {
    switch (scalarKey) {
      case 'color': return new THREE.Color(0xffffff);
      case 'metalness': return 1;
      case 'roughness': return 1;
      default: return null;
    }
  }

  _getMaterial(object) {
    if (!object) return null;
    
    const texturePainter = this.editor.viewportControls?.texturePainter;
    if (texturePainter?.isActive && texturePainter.object === object && texturePainter.originalMaterial) {
      return texturePainter.originalMaterial;
    }
    
    return object.material ?? null;
  }
}