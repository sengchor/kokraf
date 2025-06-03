import * as THREE from 'three';
import { ViewHelper } from './ViewHelper.js';

export class ViewHelperUI {
  constructor(editor) {
    this.camera = editor.cameraManager.camera;
    this.orbitControls = editor.controlsManager.instance;
    this.viewHelperContainer = document.getElementById('viewHelper');

    if (!this.viewHelperContainer) {
      throw new Error("Element with ID 'viewHelper' not found.");
    }

    this.helperRenderer = new THREE.WebGLRenderer({ alpha: true });
    this.helperRenderer.setSize(128, 128);
    this.viewHelperContainer.appendChild(this.helperRenderer.domElement);

    this.viewHelperContainer.style.position = 'relative';
    this.viewHelperContainer.style.zIndex = '9';

    this.viewHelper = new ViewHelper(this.camera, this.helperRenderer.domElement, this.orbitControls);

    this._setupEvents();
  }

  updatePosition(canvas) {
    if (!this.viewHelperContainer || !canvas) return;

    const canvasHeight = canvas.clientHeight;
    this.viewHelperContainer.style.top = `${canvasHeight - 128 * 1.2}px`;
    this.viewHelperContainer.style.right = '325px';
  }

  render() {
    this.viewHelper.render(this.helperRenderer);
  }

  _setupEvents() {
    const domElement = this.helperRenderer.domElement;

    domElement.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
    });

    domElement.addEventListener('pointerup', (event) => {
      event.stopPropagation();
      this.viewHelper.handleClick(event);
    });
  }

  dispose() {
    this.helperRenderer.dispose();
    this.viewHelperContainer.removeChild(this.helperRenderer.domElement);
    this.viewHelper = null;
    this.helperRenderer = null;
  }
}
