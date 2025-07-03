import * as THREE from 'three';
import { SetPositionCommand } from "../commands/SetPositionCommand.js";
import { SetRotationCommand } from "../commands/SetRotationCommand.js";
import { SetScaleCommand } from '../commands/SetScaleCommand.js';
import { SetValueCommand } from '../commands/SetValueCommand.js';
import { SetShadowValueCommand } from '../commands/SetShadowValueCommand.js';

export class SidebarObject {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.lastSelectedObject = null;

    this.emptyMessage = document.getElementById('object-empty-message');
    this.objectSettingList = document.getElementById('object-properties-content');

    this.optionsPerType = {
      'Mesh': ['type', 'uuid', 'name', 'position', 'rotation', 'scale', 'shadow', 'visible', 'frustumCull', 'renderOrder'],
      'AmbientLight': ['type', 'uuid', 'name', 'position', 'intensity', 'color', 'visible', 'frustumCull', 'renderOrder'],
      'DirectionalLight': ['type', 'uuid', 'name', 'position', 'intensity', 'color', 'shadow', 'shadowIntensity', 'shadowBias', 'shadowNormalBias', 'shadowRadius','visible', 'frustumCull', 'renderOrder'],
      'HemisphereLight': ['type', 'uuid', 'name', 'position', 'intensity', 'color', 'groundColor', 'visible', 'frustumCull', 'renderOrder'],
      'PointLight': ['type', 'uuid', 'name', 'position', 'intensity', 'color', 'distance', 'decay', 'shadow', 'shadowIntensity', 'shadowBias', 'shadowNormalBias', 'shadowRadius', 'visible', 'frustumCull', 'renderOrder'],
      'SpotLight': ['type', 'uuid', 'name', 'position', 'intensity', 'color', 'distance', 'angle', 'penumbra', 'decay', 'shadow', 'shadowIntensity', 'shadowBias', 'shadowNormalBias', 'shadowRadius', 'visible', 'frustumCull', 'renderOrder'],
      'OrthographicCamera': ['type', 'uuid', 'name', 'position', 'rotation', 'scale', 'left', 'right', 'top', 'bottom', 'near', 'far', 'shadow', 'visible', 'frustumCull', 'renderOrder'],
      'PerspectiveCamera': ['type', 'uuid', 'name', 'position', 'rotation', 'scale', 'fov', 'near', 'far', 'shadow', 'visible', 'frustumCull', 'renderOrder'],
      'Default': ['type', 'uuid', 'name', 'position', 'rotation', 'scale', 'shadow', 'visible', 'frustumCull', 'renderOrder']
    }
    this.options = null;

    this.setupListeners();
  }

  setupListeners() {
    this.emptyMessage.style.display = this.lastSelectedObject ? 'none' : 'block';
    this.objectSettingList.style.display = this.lastSelectedObject ? 'block' : 'none';

    this.signals.objectSelected.add(object => {
      const inputs = Array.from(document.querySelectorAll('.properties-content .number-input, .properties-content .text-input, .properties-content .color-input'));
      inputs.forEach(input => {
        if (document.activeElement === input) {
          input.blur();
        }
      });

      this.lastSelectedObject = object;

      this.emptyMessage.style.display = object ? 'none' : 'block';
      this.objectSettingList.style.display = object ? 'block' : 'none';

      this.objectSettingList.innerHTML = '';
      this.options = this.getOptionsFor(object);
      this.fields = {};
      this.options.forEach(option => {
        const element = this.generateSettingOptionHTML(option);
        if (element) this.objectSettingList.appendChild(element);
      });

      this.initUI();
      this.setupSettingInput();

      this.updateFields(object);
    });

    this.signals.objectChanged.add(() => this.updateFields(this.lastSelectedObject));
  }

  getOptionsFor(object) {
    if (!object) return [];

    const type = object.type;
    return this.optionsPerType[type] || this.optionsPerType['Default'];
  }

  initUI() {
    this.fields = {
      type: document.getElementById('setting-type'),
      uuid: document.getElementById('setting-uuid'),
      name: document.getElementById('setting-name'),

      positionX: document.getElementById('setting-position-x'),
      positionY: document.getElementById('setting-position-y'),
      positionZ: document.getElementById('setting-position-z'),

      rotationX: document.getElementById('setting-rotation-x'),
      rotationY: document.getElementById('setting-rotation-y'),
      rotationZ: document.getElementById('setting-rotation-z'),

      scaleX: document.getElementById('setting-scale-x'),
      scaleY: document.getElementById('setting-scale-y'),
      scaleZ: document.getElementById('setting-scale-z'),

      shadowCast: document.getElementById('setting-shadow-cast'),
      shadowReceive: document.getElementById('setting-shadow-receive'),

      visible: document.getElementById('setting-visible'),
      frustumCull: document.getElementById('setting-frustum-cull'),
      renderOrder: document.getElementById('setting-render-order'),

      intensity: document.getElementById('setting-intensity'),
      color: document.getElementById('setting-color'),
      shadowIntensity: document.getElementById('setting-shadowIntensity'),
      shadowBias: document.getElementById('setting-shadowBias'),
      shadowNormalBias: document.getElementById('setting-shadowNormalBias'),
      shadowRadius: document.getElementById('setting-shadowRadius'),
      groundColor: document.getElementById('setting-groundColor'),
      distance: document.getElementById('setting-distance'),
      decay: document.getElementById('setting-decay'),
      angle: document.getElementById('setting-angle'),
      penumbra: document.getElementById('setting-penumbra'),

      left: document.getElementById('setting-left'),
      right: document.getElementById('setting-right'),
      top: document.getElementById('setting-top'),
      bottom: document.getElementById('setting-bottom'),
      near: document.getElementById('setting-near'),
      far: document.getElementById('setting-far'),
      fov: document.getElementById('setting-fov'),
    };
  }

  generateSettingOptionHTML(option) {
    const li = document.createElement('li');
    li.className = 'setting-option';

    switch (option) {
      case 'type': {
        li.innerHTML = `
          <span class="label">Type</span>
          <span class="label-value" id="setting-type">Mesh</span>
        `;
        break;
      }
      case 'uuid': {
        li.innerHTML = `
          <span class="label">UUID</span>
          <input class="text-input uuid-input" id="setting-uuid" type="text" maxlength="40"
          style="padding: 2px; background-color: transparent;" readonly />
        `;
        break;
      }
      case 'name': {
        li.innerHTML = `
          <span class="label">Name</span>
          <input class="text-input" id="setting-name" type="text" maxlength="20" />
        `;
        break;
      }
      case 'position': {
        li.innerHTML = `
          <span class="label">Position</span>
          <input class="number-input" id="setting-position-x" type="number" min="1" max="10000" step="1" value="0.000" onclick="this.select()" onkeydown="handleEnter(event, this)" />
          <input class="number-input" id="setting-position-y" type="number" min="1" max="10000" step="1" value="0.000" onclick="this.select()" onkeydown="handleEnter(event, this)" />
          <input class="number-input" id="setting-position-z" type="number" min="1" max="10000" step="1" value="0.000" onclick="this.select()" onkeydown="handleEnter(event, this)" />
        `;
        break;
      }
      case 'rotation': {
        li.innerHTML = `
          <span class="label">Rotation</span>
          <input class="number-input" id="setting-rotation-x" type="number" min="1" max="10000" step="1" value="0.000" onclick="this.select()" onkeydown="handleEnter(event, this)" />
          <input class="number-input" id="setting-rotation-y" type="number" min="1" max="10000" step="1" value="0.000" onclick="this.select()" onkeydown="handleEnter(event, this)" />
          <input class="number-input" id="setting-rotation-z" type="number" min="1" max="10000" step="1" value="0.000" onclick="this.select()" onkeydown="handleEnter(event, this)" />
        `;
        break;
      }
      case 'scale': {
        li.innerHTML = `
          <span class="label">Scale</span>
          <input class="number-input" id="setting-scale-x" type="number" min="1" max="10000" step="1" value="1.000" onclick="this.select()" onkeydown="handleEnter(event, this)" />
          <input class="number-input" id="setting-scale-y" type="number" min="1" max="10000" step="1" value="1.000" onclick="this.select()" onkeydown="handleEnter(event, this)" />
          <input class="number-input" id="setting-scale-z" type="number" min="1" max="10000" step="1" value="1.000" onclick="this.select()" onkeydown="handleEnter(event, this)" />
        `;
        break;
      }
      case 'shadow': {
        li.innerHTML = `
          <span class="label">Shadow</span>
          <input type="checkbox" id="setting-shadow-cast" />
          <span style="padding: 0 4px;">cast</span>
          <input type="checkbox" id="setting-shadow-receive" />
          <span style="padding: 0 4px;">receive</span>
        `;
        break;
      }
      case 'visible': {
        li.innerHTML = `
          <span class="label">Visible</span>
          <input type="checkbox" id="setting-visible" checked/>
        `;
        break;
      }
      case 'frustumCull': {
        li.innerHTML = `
          <span class="label">Frustum Cull</span>
          <input type="checkbox" id="setting-frustum-cull" checked/>
        `;
        break;
      }
      case 'renderOrder': {
        li.innerHTML = `
          <span class="label">Render Order</span>
          <input class="number-input" id="setting-render-order" type="number" min="1" max="10000" step="1" value="0" onclick="this.select()" onkeydown="handleEnter(event, this)" />
        `;
        break;
      }
      case 'intensity': {
        li.innerHTML = `
          <span class="label">Intensity</span>
          <input class="number-input" id="setting-intensity" type="number" min="1" max="10000" step="0.01" value="0" onclick="this.select()" onkeydown="handleEnter(event, this)" />
        `;
        break;
      }
      case 'color': {
        li.innerHTML = `
          <span class="label">Color</span>
          <input class="color-input" id="setting-color" type="color" />
        `;
        break;
      }
      case 'shadowIntensity': {
        li.innerHTML = `
          <span class="label">Shadow Intensity</span>
          <input class="number-input" id="setting-shadowIntensity" type="number" min="0" max="1" step="0.01" value="1" onclick="this.select()" onkeydown="handleEnter(event, this)" />
        `;
        break;
      }
      case 'shadowBias': {
        li.innerHTML = `
          <span class="label">Shadow Bias</span>
          <input class="number-input" id="setting-shadowBias" type="number" min="-100" max="100" step="0.0001" value="1" onclick="this.select()" onkeydown="handleEnter(event, this)" />
        `;
        break;
      }
      case 'shadowNormalBias': {
        li.innerHTML = `
          <span class="label">Shadow Normal Bias</span>
          <input class="number-input" id="setting-shadowNormalBias" type="number" min="-10000" max="10000" step="0.01" value="1" onclick="this.select()" onkeydown="handleEnter(event, this)" />
        `;
        break;
      }
      case 'shadowRadius': {
        li.innerHTML = `
          <span class="label">Shadow Radius</span>
          <input class="number-input" id="setting-shadowRadius" type="number" min="-10000" max="10000" step="0.01" value="1" onclick="this.select()" onkeydown="handleEnter(event, this)" />
        `;
        break;
      }
      case 'groundColor': {
        li.innerHTML = `
          <span class="label">Ground Color</span>
          <input class="color-input" id="setting-groundColor" type="color" />
        `;
        break;
      }
      case 'distance': {
        li.innerHTML = `
          <span class="label">Distance</span>
          <input class="number-input" id="setting-distance" type="number" min="1" max="10000" step="0.01" value="0" onclick="this.select()" onkeydown="handleEnter(event, this)" />
        `;
        break;
      }
      case 'decay': {
        li.innerHTML = `
          <span class="label">Decay</span>
          <input class="number-input" id="setting-decay" type="number" min="1" max="10000" step="0.01" value="0" onclick="this.select()" onkeydown="handleEnter(event, this)" />
        `;
        break;
      }
      case 'angle': {
        li.innerHTML = `
          <span class="label">Angle</span>
          <input class="number-input" id="setting-angle" type="number" min="1" max="10000" step="0.01" value="0" onclick="this.select()" onkeydown="handleEnter(event, this)" />
        `;
        break;
      }
      case 'penumbra': {
        li.innerHTML = `
          <span class="label">Penumbra</span>
          <input class="number-input" id="setting-penumbra" type="number" min="1" max="10000" step="0.01" value="0" onclick="this.select()" onkeydown="handleEnter(event, this)" />
        `;
        break;
      }
      case 'left': {
        li.innerHTML = `
          <span class="label">Left</span>
          <input class="number-input" id="setting-left" type="number" step="0.1" value="0" onclick="this.select()" onkeydown="handleEnter(event, this)" />
        `;
        break;
      }
      case 'right': {
        li.innerHTML = `
          <span class="label">Right</span>
          <input class="number-input" id="setting-right" type="number" step="0.1" value="0" onclick="this.select()" onkeydown="handleEnter(event, this)" />
        `;
        break;
      }
      case 'top': {
        li.innerHTML = `
          <span class="label">Top</span>
          <input class="number-input" id="setting-top" type="number" step="0.1" value="0" onclick="this.select()" onkeydown="handleEnter(event, this)" />
        `;
        break;
      }
      case 'bottom': {
        li.innerHTML = `
          <span class="label">Bottom</span>
          <input class="number-input" id="setting-bottom" type="number" step="0.1" value="0" onclick="this.select()" onkeydown="handleEnter(event, this)" />
        `;
        break;
      }
      case 'near': {
        li.innerHTML = `
          <span class="label">Near</span>
          <input class="number-input" id="setting-near" type="number" min="0.01" max="1000" step="0.01" value="0.1" onclick="this.select()" onkeydown="handleEnter(event, this)" />
        `;
        break;
      }
      case 'far': {
        li.innerHTML = `
          <span class="label">Far</span>
          <input class="number-input" id="setting-far" type="number" min="1" max="10000" step="1" value="2000" onclick="this.select()" onkeydown="handleEnter(event, this)" />
        `;
        break;
      }
      case 'fov': {
        li.innerHTML = `
          <span class="label">Fov</span>
          <input class="number-input" id="setting-fov" type="number" min="1" max="179" step="1" value="50" onclick="this.select()" onkeydown="handleEnter(event, this)" />
        `;
        break;
      }
      default:
        return null;
    }

    return li;
  }

  updateFields(object) {
    if (!object) return;
    const f = this.fields;
    const fix = (v, d = 3) => Number(v).toFixed(d);
    const deg = THREE.MathUtils.radToDeg;

    for (const option of this.options) {
      switch (option) {
        case 'type':
          f.type.textContent = object.type || 'Unknown';
          break;
        case 'uuid':
          f.uuid.value = object.uuid || '';
          break;
        case 'name':
          f.name.value = object.name || '';
          break;
        case 'position':
          f.positionX.value = fix(object.position.z, 3);
          f.positionY.value = fix(object.position.x, 3);
          f.positionZ.value = fix(object.position.y, 3);
          break;
        case 'rotation':
          f.rotationX.value = fix(deg(object.rotation.z), 2);
          f.rotationY.value = fix(deg(object.rotation.x), 2);
          f.rotationZ.value = fix(deg(object.rotation.y), 2);
          break;
        case 'scale':
          f.scaleX.value = fix(object.scale.z, 3);
          f.scaleY.value = fix(object.scale.x, 3);
          f.scaleZ.value = fix(object.scale.y, 3);
          break;
        case 'shadow':
          f.shadowCast.checked = !!object.castShadow;
          f.shadowReceive.checked = !!object.receiveShadow;
          break;
        case 'visible':
          f.visible.checked = !!object.visible;
          break;
        case 'frustumCull':
          f.frustumCull.checked = !!object.frustumCulled;
          break;
        case 'renderOrder':
          f.renderOrder.value = object.renderOrder;
          break;
        case 'intensity':
          f.intensity.value = fix(object.intensity, 2);
          break;
        case 'color':
          f.color.value = `#${object.color.getHexString()}`;
          break;
        case 'shadowIntensity':
          f.shadowIntensity.value = fix(object.shadow.intensity, 2);
          break;
        case 'shadowBias':
          f.shadowBias.value = fix(object.shadow.bias, 5);
          break;
        case 'shadowNormalBias':
          f.shadowNormalBias.value = fix(object.shadow.normalBias, 2);
          break;
        case 'shadowRadius':
          f.shadowRadius.value = fix(object.shadow.radius, 2);
          break;
        case 'groundColor':
          f.groundColor.value = `#${object.groundColor.getHexString()}`;
          break;
        case 'distance':
          f.distance.value = fix(object.distance, 2);
          break;
        case 'decay':
          f.decay.value = fix(object.decay, 2);
          break;
        case 'angle':
          f.angle.value = fix(object.angle, 2);
          break;
        case 'penumbra':
          f.penumbra.value = fix(object.penumbra, 2);
          break;
        case 'left':
          f.left.value = fix(object.left);
          break;
        case 'right':
          f.right.value = fix(object.right);
          break;
        case 'top':
          f.top.value = fix(object.top);
          break;
        case 'bottom':
          f.bottom.value = fix(object.bottom);
          break;
        case 'near':
          f.near.value = fix(object.near, 3);
          break;
        case 'far':
          f.far.value = fix(object.far, 3);
          break;
        case 'fov':
          f.fov.value = fix(object.fov, 2);
          break;
      }
    }
  }

  bindInput(input, getValue, apply) {
    if (!input) return;
    input.addEventListener('blur', function() {
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
      this.editor.execute(new SetValueCommand(this.editor, object, key, value));
    }.bind(this));
  }

  bindVectorInputs(inputs, getNewValue, getOldValue, CommandClass) {
    inputs.forEach(input => {
      input.addEventListener('blur', () => {
        const object = this.lastSelectedObject;
        if (!object) return;

        const newValue = getNewValue();
        const oldValue = getOldValue(object);

        if (!oldValue.equals(newValue)) {
          this.editor.execute(new CommandClass(this.editor, object, newValue, oldValue));
          this.signals.objectChanged.dispatch();
        }
      });

      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') input.blur();
      });
    });
  }

  setupSettingInput() {
    const f = this.fields;

    for (const option of this.options) {
      switch (option) {
        case 'name':
          this.bindInput(f.name, () => f.name.value, (object, value) => {
            this.editor.execute(new SetValueCommand(this.editor, object, 'name', value));
          });
          break;

        case 'position':
          this.bindVectorInputs(
            [f.positionX, f.positionY, f.positionZ],
            () => new THREE.Vector3(
              parseFloat(f.positionY.value) || 0,
              parseFloat(f.positionZ.value) || 0,
              parseFloat(f.positionX.value) || 0
            ),
            object => object.position.clone(),
            SetPositionCommand
          );
          break;

        case 'rotation':
          this.bindVectorInputs(
            [f.rotationX, f.rotationY, f.rotationZ],
            () => new THREE.Euler(
              THREE.MathUtils.degToRad(parseFloat(f.rotationY.value) || 0),
              THREE.MathUtils.degToRad(parseFloat(f.rotationZ.value) || 0),
              THREE.MathUtils.degToRad(parseFloat(f.rotationX.value) || 0),
              'XYZ'
            ),
            object => object.rotation.clone(),
            SetRotationCommand
          );
          break;

        case 'scale':
          this.bindVectorInputs(
            [f.scaleX, f.scaleY, f.scaleZ],
            () => new THREE.Vector3(
              parseFloat(f.scaleY.value) || 1,
              parseFloat(f.scaleZ.value) || 1,
              parseFloat(f.scaleX.value) || 1
            ),
            object => object.scale.clone(),
            SetScaleCommand
          );
          break;

        case 'shadow':
          this.bindCheckbox(f.shadowCast, 'castShadow');
          this.bindCheckbox(f.shadowReceive, 'receiveShadow');
          break;

        case 'visible':
          this.bindCheckbox(f.visible, 'visible');
          break;

        case 'frustumCull':
          this.bindCheckbox(f.frustumCull, 'frustumCulled');
          break;

        case 'renderOrder':
          this.bindInput(f.renderOrder, () => parseInt(f.renderOrder.value), (object, value) => {
            if (object.renderOrder !== value) {
              this.editor.execute(new SetValueCommand(this.editor, object, 'renderOrder', value));
            }
          });
          break;

        case 'intensity':
          this.bindInput(f.intensity, () => parseFloat(f.intensity.value), (object, value) => {
            if (object.intensity !== value) {
              this.editor.execute(new SetValueCommand(this.editor, object, 'intensity', value));
            }
          });
          break;

        case 'color':
          this.bindInput(f.color, () => new THREE.Color(f.color.value), (object, value) => {
            if (object.color !== value) {
              this.editor.execute(new SetValueCommand(this.editor, object, 'color', value));
            }
          });
          break;

        case 'shadowIntensity':
          this.bindInput(f.shadowIntensity, () => parseFloat(f.shadowIntensity.value), (object, value) => {
            this.editor.execute(new SetShadowValueCommand(this.editor, object, 'intensity', value));
          });
          break;

        case 'shadowBias':
          this.bindInput(f.shadowBias, () => parseFloat(f.shadowBias.value), (object, value) => {
            this.editor.execute(new SetShadowValueCommand(this.editor, object, 'bias', value));
          });
          break;

        case 'shadowNormalBias':
          this.bindInput(f.shadowNormalBias, () =>parseFloat(f.shadowNormalBias.value), (object, value) => {
            this.editor.execute(new SetShadowValueCommand(this.editor, object, 'normalBias', value));
          });
          break;

        case 'shadowRadius':
          this.bindInput(f.shadowRadius, () => parseFloat(f.shadowRadius.value), (object, value) => {
            this.editor.execute(new SetShadowValueCommand(this.editor, object, 'radius', value));
          });
          break;

        case 'groundColor':
          this.bindInput(f.groundColor, () => new THREE.Color(f.groundColor.value), (object, value) => {
            if (object.groundColor !== value) {
              this.editor.execute(new SetValueCommand(this.editor, object, 'groundColor', value));
            }
          });
          break;

        case 'distance':
          this.bindInput(f.distance, () => parseFloat(f.distance.value), (object, value) => {
            if (object.distance !== value) {
              this.editor.execute(new SetValueCommand(this.editor, object, 'distance', value));
            }
          });
          break;

        case 'decay':
          this.bindInput(f.decay, () => parseFloat(f.decay.value), (object, value) => {
            if (object.decay !== value) {
              this.editor.execute(new SetValueCommand(this.editor, object, 'decay', value));
            }
          });
          break;

        case 'angle':
          this.bindInput(f.angle, () => parseFloat(f.angle.value), (object, value) => {
            if (object.angle !== value) {
              this.editor.execute(new SetValueCommand(this.editor, object, 'angle', value));
            }
          });
          break;

        case 'penumbra':
          this.bindInput(f.penumbra, () => parseFloat(f.penumbra.value), (object, value) => {
            if (object.penumbra !== value) {
              this.editor.execute(new SetValueCommand(this.editor, object, 'penumbra', value));
            }
          });
          break;

        case 'left':
          this.bindInput(f.left, () => parseFloat(f.left.value), (object, value) => {
            this.editor.execute(new SetValueCommand(this.editor, object, 'left', value));
            object.updateProjectionMatrix();
          });
          break;

        case 'right':
          this.bindInput(f.right, () => parseFloat(f.right.value), (object, value) => {
            this.editor.execute(new SetValueCommand(this.editor, object, 'right', value));
            object.updateProjectionMatrix();
          });
          break;

        case 'top':
          this.bindInput(f.top, () => parseFloat(f.top.value), (object, value) => {
            this.editor.execute(new SetValueCommand(this.editor, object, 'top', value));
            object.updateProjectionMatrix();
          });
          break;

        case 'bottom':
          this.bindInput(f.bottom, () => parseFloat(f.bottom.value), (object, value) => {
            this.editor.execute(new SetValueCommand(this.editor, object, 'bottom', value));
            object.updateProjectionMatrix();
          });
          break;

        case 'near':
          this.bindInput(f.near, () => parseFloat(f.near.value), (object, value) => {
            this.editor.execute(new SetValueCommand(this.editor, object, 'near', value));
            object.updateProjectionMatrix();
          });
          break;

        case 'far':
          this.bindInput(f.far, () => parseFloat(f.far.value), (object, value) => {
            this.editor.execute(new SetValueCommand(this.editor, object, 'far', value));
            object.updateProjectionMatrix();
          });
          break;

        case 'fov':
          this.bindInput(f.fov, () => parseFloat(f.fov.value), (object, value) => {
            this.editor.execute(new SetValueCommand(this.editor, object, 'fov', value));
            object.updateProjectionMatrix();
          });
          break;
      }
    }
  }
}