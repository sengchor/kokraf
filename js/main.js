import * as THREE from "three"
import { OrbitControls} from "jsm/controls/OrbitControls.js";
import { createViewHelper, updateViewHelperPosition } from './helpers/view-helper.js';
import { loadComponent } from './utils/loadComponent.js';
import { setupRightPanelResizer, setupOutlinerResizer } from './panel-resizer.js';
import { OutlineEffect } from "jsm/effects/OutlineEffect.js";
import { createGridHelper, updateGridHelperUniforms } from './helpers/grid-helper.js';

// Load UI components
loadComponent('#menu-container', 'components/menu-bar.html');

loadComponent('#right-panel-container', 'components/panel-tabs.html', () => {
  document.querySelectorAll('.tab').forEach((tab, index) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel-content').forEach(c => c.style.display = 'none');

      tab.classList.add('active');
      document.querySelectorAll('.panel-content')[index].style.display = 'block';
    });
  });

  document.querySelectorAll('.outliner-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.outliner-item').forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
    });
  });

  setupOutlinerResizer();
});

loadComponent('#toolbar-container', 'components/toolbar.html', (container) => {
  const buttons = container.querySelectorAll('.toolbar-button');
   buttons.forEach(button => {
    button.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      button.classList.add('active');
    });
  });
});

loadComponent('#viewport-controls-container', 'components/viewport-controls.html');

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x3b3b3b);

// Camera
var _DEFAULT_CAMERA = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
_DEFAULT_CAMERA.name = 'Camera';
_DEFAULT_CAMERA.position.set( 0, 5, 10 );
_DEFAULT_CAMERA.lookAt( new THREE.Vector3() );

// Renderer
const canvas = document.getElementById('three-canvas');
const renderer = new THREE.WebGLRenderer({canvas: canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.autoClear = false;

// Orbit controls
const controls = new OrbitControls(_DEFAULT_CAMERA, renderer.domElement);

// Lights
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
const effect = new OutlineEffect(renderer);
scene.add(ambientLight);

// Create grid helper
const gridHelper = createGridHelper();
scene.add(gridHelper);

// Load matcap texture
const matcapURL = '/assets/textures/matcaps/040full.jpg';
const matcapTexture = new THREE.TextureLoader().load(matcapURL);

// Cube
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(),
  new THREE.MeshMatcapMaterial({ matcap: matcapTexture, color: 0xcccccc, side: THREE.DoubleSide })
);
cube.position.y = 0.5;
scene.add(cube);

// Helper
const { viewHelper, helperRenderer } = createViewHelper(_DEFAULT_CAMERA);
const clock = new THREE.Clock();

function resizeUIComponents() {
  const outliner = document.getElementById('right-panel-container');
  const width = window.innerWidth - (outliner?.offsetWidth || 0);
  const height = window.innerHeight + 30;
  
  renderer.setSize(width, height);
  _DEFAULT_CAMERA.aspect = width / height;
  _DEFAULT_CAMERA.updateProjectionMatrix();

  updateViewHelperPosition(canvas);

  // Resize the outliner list if it's present
  const outlinerList = document.getElementById('outliner-list');
  const sceneTab = document.getElementById('scene-tab');
    if (sceneTab && outlinerList) {
    const sceneTabRect = sceneTab.getBoundingClientRect();
    const maxHeight = window.innerHeight - sceneTabRect.top - 50;
    outlinerList.style.maxHeight = `${maxHeight}px`;
    outlinerList.style.overflowY = 'auto';
  }
}

// Initial canvas size setup
resizeUIComponents();
setupRightPanelResizer(resizeUIComponents);
window.addEventListener('resize', resizeUIComponents);

// Render Loop
function animate() {
  const delta = clock.getDelta();

  requestAnimationFrame(animate);

  updateGridHelperUniforms(gridHelper, _DEFAULT_CAMERA);

  renderer.clear();
  renderer.render(scene, _DEFAULT_CAMERA);
  effect.render(scene, _DEFAULT_CAMERA);

  if (viewHelper.animating === true) {
    viewHelper.update(delta);
  }
  
  viewHelper.render(helperRenderer);
}
animate();