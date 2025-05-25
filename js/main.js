import * as THREE from "three"
import { createViewHelper, updateViewHelperPosition } from './helpers/view-helper-ui.js';
import { loadUIComponents  } from './utils/loadComponent.js';
import { setupRightPanelResizer } from './panel-resizer.js';
import { OutlineEffect } from "jsm/effects/OutlineEffect.js";
import { createGridHelper, updateGridHelperUniforms } from './helpers/grid-helper.js';
import { QuaternionOrbitControls } from './control/QuaternionOrbitControls.js';

// Load UI components
loadUIComponents();

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x3b3b3b);
const sceneGridHelper = new THREE.Scene();
sceneGridHelper.background = null;
const sceneHelpers = new THREE.Scene();
sceneHelpers.background = null;

// Camera
var camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.name = 'Camera';
camera.position.set( 3, 2, 5 );
camera.lookAt( new THREE.Vector3() );

// Renderer
const canvas = document.getElementById('three-canvas');
const renderer = new THREE.WebGLRenderer({canvas: canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.autoClear = false;

// Orbit controls
const controls = new QuaternionOrbitControls(camera, renderer.domElement);

// Lights
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
const effect = new OutlineEffect(renderer);
scene.add(ambientLight);

// Create grid helper
const gridHelper = createGridHelper();
sceneGridHelper.add(gridHelper);

// Load matcap texture
const matcapURL = '/assets/textures/matcaps/040full.jpg';
const matcapTexture = new THREE.TextureLoader().load(matcapURL);

// Cube
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(),
  new THREE.MeshMatcapMaterial({ matcap: matcapTexture, color: 0xcccccc, side: THREE.DoubleSide })
);
cube.position.y = 0.0;
scene.add(cube);

// Torus
const torus = new THREE.Mesh(
  new THREE.TorusGeometry(0.5, 0.2, 16, 100),
  new THREE.MeshMatcapMaterial({ matcap: matcapTexture, color: 0xcccccc, side: THREE.DoubleSide })
);
torus.position.set(1.5, 0, 0);
scene.add(torus);

// Helper
const { viewHelper, helperRenderer } = createViewHelper(camera);
const clock = new THREE.Clock();

function resizeUIComponents() {
  const outliner = document.getElementById('right-panel-container');
  const width = window.innerWidth - (outliner?.offsetWidth || 0);
  const height = window.innerHeight + 30;
  
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();

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
  
  updateGridHelperUniforms(gridHelper, camera);

  renderer.clear();
  renderer.render(scene, camera);
  effect.render(scene, camera);
  renderer.render(sceneGridHelper, camera);
  renderer.render(sceneHelpers, camera);
  
  if (viewHelper.animating === true) {
    controls.enabled = false;
    viewHelper.update(delta);
  } else {
    controls.enabled = true;
  }
  viewHelper.render(helperRenderer);
}
animate();