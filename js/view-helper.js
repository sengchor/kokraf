import * as THREE from 'three';
import { ViewHelper } from 'jsm/helpers/ViewHelper.js';

let viewHelperContainer, helperRenderer, viewHelper;

export function createViewHelper(camera) {
  viewHelperContainer = document.getElementById('viewHelper');
  helperRenderer = new THREE.WebGLRenderer({ alpha: true });
  helperRenderer.setSize(128, 128);
  viewHelperContainer.appendChild(helperRenderer.domElement);

  viewHelperContainer.style.position = 'relative';
  viewHelperContainer.style.zIndex = '9';

  viewHelper  = new ViewHelper(camera, helperRenderer.domElement);

  setupViewHelperEvents();

  return { viewHelper, helperRenderer };
}

export function updateViewHelperPosition(canvas) {
  if (!viewHelperContainer || !canvas) return;
  const canvasHeight = canvas.clientHeight;
  viewHelperContainer.style.top = `${canvasHeight - 128 * 1.2}px`;
  viewHelperContainer.style.right = '325px';
}

function setupViewHelperEvents() {
  const domElement = helperRenderer.domElement;

  domElement.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
  });

  domElement.addEventListener('pointerup', (event) => {
    event.stopPropagation();
    viewHelper.handleClick(event);
  });
}