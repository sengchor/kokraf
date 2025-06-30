import * as THREE from 'three';
import { SetPositionCommand } from "../commands/SetPositionCommand.js";
import { SetRotationCommand } from "../commands/SetRotationCommand.js";
import { SetScaleCommand } from '../commands/SetScaleCommand.js';
import { SetValueCommand } from '../commands/SetValueCommand.js';

export class SidebarObject {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.selectionHelper = editor.selectionHelper;
    this.lastSelectedObject = null;
    
    this.typeElement = document.getElementById('object-type');
    this.uuidInput = document.getElementById('object-uuid');
    this.nameInput = document.getElementById('name-input');

    this.positionX = document.getElementById('position-x');
    this.positionY = document.getElementById('position-y');
    this.positionZ = document.getElementById('position-z');

    this.rotationX = document.getElementById('rotation-x');
    this.rotationY = document.getElementById('rotation-y');
    this.rotationZ = document.getElementById('rotation-z');

    this.scaleX = document.getElementById('scale-x');
    this.scaleY = document.getElementById('scale-y');
    this.scaleZ = document.getElementById('scale-z');

    this.castShadowCheckbox = document.getElementById('cast-shadow');
    this.receiveShadowCheckbox = document.getElementById('receive-shadow');

    this.visibleCheckbox = document.getElementById('object-visible');
    this.frustumCullCheckbox = document.getElementById('object-frustum-cull');
    this.renderOrderInput = document.getElementById('object-render-order');

    this.setupListeners();
    this.update();
  }

  setupListeners() {
    this.signals.objectSelected.add(object => {
      const inputs = Array.from(document.querySelectorAll('.properties-content .number-input, .properties-content .text-input'));
      inputs.forEach(input => {
        if (document.activeElement === input) {
          input.blur();
        }
      });

      if (object) {
        this.lastSelectedObject = object;
      }
      this.update();
    });

    this.signals.objectChanged.add(() => this.update());

    this.setupNameInput();
    this.setupPositionInput();
    this.setupRotationInput();
    this.setupScaleInput();
    this.setupShadowInputs();
    this.setupVisibleToggle();
    this.setupFrustumCullToggle();
    this.setupRenderOrderInput();
  }

  update() {
    const object = this.selectionHelper.selectedObject;

    if (!object) {
      this.typeElement.textContent = '';
      this.uuidInput.value = '';
      this.nameInput.value = '';

      this.positionX.value = '0.000';
      this.positionY.value = '0.000';
      this.positionZ.value = '0.000';

      this.rotationX.value = '0.000';
      this.rotationY.value = '0.000';
      this.rotationZ.value = '0.000';

      this.scaleX.value = '1.000';
      this.scaleY.value = '1.000';
      this.scaleZ.value = '1.000';

      this.castShadowCheckbox.checked = false;
      this.receiveShadowCheckbox.checked = false;

      this.visibleCheckbox.checked = true;
      this.frustumCullCheckbox.checked = true;
      this.renderOrderInput.value = '0';

      this.lastSelectedObject = null;
      return;
    }

    this.typeElement.textContent = object.type || 'Unknown';
    this.uuidInput.value = object.uuid || '';
    this.nameInput.value = object.name || '';

    this.positionX.value = object.position.z.toFixed(3);
    this.positionY.value = object.position.x.toFixed(3);
    this.positionZ.value = object.position.y.toFixed(3);

    this.rotationX.value = THREE.MathUtils.radToDeg(object.rotation.z).toFixed(2);
    this.rotationY.value = THREE.MathUtils.radToDeg(object.rotation.x).toFixed(2);
    this.rotationZ.value = THREE.MathUtils.radToDeg(object.rotation.y).toFixed(2);

    this.scaleX.value = object.scale.z.toFixed(3);
    this.scaleY.value = object.scale.x.toFixed(3);
    this.scaleZ.value = object.scale.y.toFixed(3);

    this.castShadowCheckbox.checked = !!object.castShadow;
    this.receiveShadowCheckbox.checked = !!object.receiveShadow;

    this.visibleCheckbox.checked = !!object.visible;
    this.frustumCullCheckbox.checked = !!object.frustumCulled;
    this.renderOrderInput.value = object.renderOrder;
  }

  setupNameInput() {
    this.nameInput.addEventListener('blur', () => {
      const object = this.lastSelectedObject;
      if (!object) return;
      const newName = this.nameInput.value.trim() || 'Object';

      if (object.name !== newName) {
        this.editor.execute(new SetValueCommand(this.editor, object, 'name', newName));
      }
    });
    this.nameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        this.nameInput.blur();
      }
    });
  }

  setupPositionInput() {
    [this.positionX, this.positionY, this.positionZ].forEach(input => {
      input.addEventListener('blur', () => {
        const object = this.lastSelectedObject;
        if (!object) return;

        const x = parseFloat(this.positionX.value) || 0;
        const y = parseFloat(this.positionY.value) || 0;
        const z = parseFloat(this.positionZ.value) || 0;

        const newPosition = new THREE.Vector3(y, z, x);
        const oldPosition = object.position.clone();

        if (!oldPosition.equals(newPosition)) {
          this.editor.execute(new SetPositionCommand(this.editor, object, newPosition, oldPosition));
          this.signals.objectChanged.dispatch();
        }
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
      });
    });
  }

  setupRotationInput() {
    [this.rotationX, this.rotationY, this.rotationZ].forEach(input => {
      input.addEventListener('blur', () => {
        const object = this.lastSelectedObject;
        if (!object) return;

        const x = THREE.MathUtils.degToRad(parseFloat(this.rotationX.value) || 0);
        const y = THREE.MathUtils.degToRad(parseFloat(this.rotationY.value) || 0);
        const z = THREE.MathUtils.degToRad(parseFloat(this.rotationZ.value) || 0);

        const newRotation = new THREE.Euler(y, z, x);
        const oldRotation = object.rotation.clone();

        if (!oldRotation.equals(newRotation)) {
          this.editor.execute(new SetRotationCommand(this.editor, object, newRotation, oldRotation));
          this.signals.objectChanged.dispatch();
        }
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
      });
    });
  }

  setupScaleInput() {
    [this.scaleX, this.scaleY, this.scaleZ].forEach(input => {
      input.addEventListener('blur', () => {
        const object = this.lastSelectedObject;
        if (!object) return;

        const x = parseFloat(this.scaleX.value) || 1;
        const y = parseFloat(this.scaleY.value) || 1;
        const z = parseFloat(this.scaleZ.value) || 1;

        const newScale = new THREE.Vector3(y, z, x);
        const oldScale = object.scale.clone();

        if (!oldScale.equals(newScale)) {
          this.editor.execute(new SetScaleCommand(this.editor, object, newScale, oldScale));
          this.signals.objectChanged.dispatch();
        }
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
      });
    });
  }

  setupShadowInputs() {
    this.castShadowCheckbox.addEventListener('change', () => {
      const object = this.lastSelectedObject;
      if (object) {
        const newValue = this.castShadowCheckbox.checked;
        this.editor.execute(new SetValueCommand(this.editor, object, 'castShadow', newValue));
      }
    });

    this.receiveShadowCheckbox.addEventListener('change', () => {
      const object = this.lastSelectedObject;
      if (object) {
        const newValue = this.receiveShadowCheckbox.checked;
        this.editor.execute(new SetValueCommand(this.editor, object, 'receiveShadow', newValue));
      }
    });
  }

  setupVisibleToggle() {
    this.visibleCheckbox.addEventListener('change', () => {
      const object = this.lastSelectedObject;
      if (!object) return;

      const newValue = this.visibleCheckbox.checked;
      this.editor.execute(new SetValueCommand(this.editor, object, 'visible', newValue));
    });
  }

  setupFrustumCullToggle() {
    this.frustumCullCheckbox.addEventListener('change', () => {
      const object = this.lastSelectedObject;
      if (!object) return;

      const newValue = this.frustumCullCheckbox.checked;
      this.editor.execute(new SetValueCommand(this.editor, object, 'frustumCulled', newValue));
    });
  }

  setupRenderOrderInput() {
    this.renderOrderInput.addEventListener('blur', () => {
      const object = this.lastSelectedObject;
      if (!object) return;

      const value = parseInt(this.renderOrderInput.value);
      const newValue = isNaN(value) ? 0 : value;

      if (object.renderOrder !== newValue) {
        this.editor.execute(new SetValueCommand(this.editor, object, 'renderOrder', newValue));
      }
    });

    this.renderOrderInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.renderOrderInput.blur();
    });
  }
}