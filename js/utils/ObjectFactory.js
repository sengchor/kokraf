import * as THREE from 'three';

export function createGeometry(type) {
  switch (type) {
    case 'Box': return new THREE.BoxGeometry();
    case 'Capsule': return new THREE.CapsuleGeometry(0.5, 0.5);
    case 'Circle': return new THREE.CircleGeometry(0.75);
    case 'Cylinder': return new THREE.CylinderGeometry(0.5, 0.5);
    case 'Dodecahedron': return new THREE.DodecahedronGeometry(0.75);
    case 'Icosahedron': return new THREE.IcosahedronGeometry(0.75);
    case 'Lathe':
      return new THREE.LatheGeometry([
        new THREE.Vector2(0, -0.75),
        new THREE.Vector2(0.75, 0),
        new THREE.Vector2(0, 0.75)
      ]);
    case 'Octahedron': return new THREE.OctahedronGeometry(0.75);
    case 'Plane': return new THREE.PlaneGeometry(1, 1);
    case 'Ring': return new THREE.RingGeometry(0.4, 0.75);
    case 'Sphere': return new THREE.SphereGeometry(0.75);
    case 'Tetrahedron': return new THREE.TetrahedronGeometry(1);
    case 'Torus': return new THREE.TorusGeometry(0.5, 0.2);
    case 'TorusKnot': return new THREE.TorusKnotGeometry(0.4, 0.16);
    case 'Tube': {
      const path = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-1, 0, 0),
        new THREE.Vector3(0, 0.5, 0),
        new THREE.Vector3(1, 0, 0)
      ]);
      return new THREE.TubeGeometry(path, 20, 0.2, 8, false);
    }
    default: return null;
  }
}

export function createLight(type, sceneManager) {
  let light, helper;

  switch (type) {
    case 'Ambient':
      light = new THREE.AmbientLight(0xffffff, 0.5);
      break;

    case 'Directional':
      light = new THREE.DirectionalLight(0xffffff, 1);
      light.position.set(5, 5, 5);
      helper = new THREE.DirectionalLightHelper(light, 0.5);
      break;

    case 'Hemisphere':
      light = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
      helper = new THREE.HemisphereLightHelper(light, 0.5);
      break;

    case 'Point':
      light = new THREE.PointLight(0xffffff, 1, 10);
      light.position.set(0, 0, 0);
      helper = new THREE.PointLightHelper(light, 0.3);
      break;

    case 'Spot':
      light = new THREE.SpotLight(0xffffff, 1);
      light.position.set(5, 5, 5);
      light.angle = Math.PI * 0.1;
      light.penumbra = 0;
      light.distance = 20;
      helper = new THREE.SpotLightHelper(light);
      break;

    default: return null;
  }

  if (helper && sceneManager) addHelper(light, helper, sceneManager);
  return light;
}

export function createCamera(type, sceneManager) {
  let camera, helper;

  switch (type) {
    case 'Perspective':
      camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2000);
      break;

    case 'Orthographic': {
      const aspect = window.innerWidth / window.innerHeight;
      const frustumSize = 2;
      camera = new THREE.OrthographicCamera(
        -frustumSize * aspect / 2, frustumSize * aspect / 2,
        frustumSize / 2, -frustumSize / 2,
        0.1, 2000
      );
      break;
    }
    default: return null;
  }

  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);

  helper = new THREE.CameraHelper(camera);
  helper.setColors?.(
    new THREE.Color(0xffffff),
    new THREE.Color(0xffffff),
    new THREE.Color(0xffffff),
    new THREE.Color(0xffffff),
    new THREE.Color(0xffffff)
  );

  if (sceneManager) addHelper(camera, helper, sceneManager);
  return camera;
}

export function createGroup(type = 'Group') {
  const group = new THREE.Group();
  group.name = type;
  group.position.set(0, 0, 0);
  return group;
}

export function addHelper(object, helper, sceneManager) {
  if (!helper || !sceneManager) return;

  const geometry = new THREE.SphereGeometry(1, 4, 2);
  const material = new THREE.MeshBasicMaterial({ color: 0xff0000, visible: false, wireframe: true });
  const picker = new THREE.Mesh(geometry, material);

  picker.name = 'picker';
  picker.userData.object = object;

  object.userData.helper = helper;
  helper.add(picker);

  sceneManager.sceneHelpers.add(helper);
}
