import * as THREE from "three"
import { OrbitControls} from "jsm/controls/OrbitControls.js";
import { loadComponent } from './utils/loadComponent.js';
import { setupRightPanelResizer, setupOutlinerResizer } from './panel-resizer.js';

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

// Camera
var _DEFAULT_CAMERA = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
_DEFAULT_CAMERA.name = 'Camera';
_DEFAULT_CAMERA.position.set( 0, 5, 10 );
_DEFAULT_CAMERA.lookAt( new THREE.Vector3() );

// Renderer
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('three-canvas'), antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);

// Orbit controls
const controls = new OrbitControls(_DEFAULT_CAMERA, renderer.domElement);

// Lights
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(5, 5, 5);
scene.add(light);
scene.add(new THREE.AmbientLight(0x404040));

// Ground
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(10, 10),
  new THREE.MeshStandardMaterial({ color: 'gray' })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// Cube
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(),
  new THREE.MeshStandardMaterial({ color: 'orange' })
);
cube.position.y = 0.5;
scene.add(cube);

function resizeUIComponents() {
  const outliner = document.getElementById('right-panel-container');
  const width = window.innerWidth - (outliner?.offsetWidth || 0);
  const height = window.innerHeight + 30;
  
  renderer.setSize(width, height);
  _DEFAULT_CAMERA.aspect = width / height;
  _DEFAULT_CAMERA.updateProjectionMatrix();

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
  requestAnimationFrame(animate);
  renderer.render(scene, _DEFAULT_CAMERA);
}
animate();