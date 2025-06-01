import * as THREE from 'three';

export class MenubarAdd {
  constructor(sceneManager) {
    this.sceneManager = sceneManager;
    this.init();
  }

  init() {
    document.querySelector('[data-group]').addEventListener('click', (event) => {
      const groupType = event.target.getAttribute('data-group');
      const group = this.createGroup(groupType);
      this.sceneManager.addObject(group);
    });

    document.querySelectorAll('[data-geometry]').forEach(item => {
      item.addEventListener('click', (event) => {
        const geometryType = event.target.getAttribute('data-geometry');
        const geometry = this.createGeometry(geometryType);
        this.sceneManager.addGeometry(geometry);
      });
    });

    document.querySelectorAll('[data-light]').forEach(item => {
      item.addEventListener('click', (event) => {
        const lightType = event.target.getAttribute('data-light');
        const light = this.createLight(lightType);
        this.sceneManager.addObject(light);
      });
    });

    document.querySelectorAll('[data-camera]').forEach(item => {
      item.addEventListener('click', (event) => {
        const cameraType = event.target.getAttribute('data-camera');
        const camera = this.createCamera(cameraType);
        this.sceneManager.addObject(camera);
      })
    });
  }

  createGeometry(type) {
    let geometry;

    switch (type) {
      case 'Box':
        geometry = new THREE.BoxGeometry();
        break;
      case 'Capsule':
        geometry = new THREE.CapsuleGeometry(0.5, 0.5);
        break;
      case 'Circle':
        geometry = new THREE.CircleGeometry(0.75);
        break;
      case 'Cylinder':
        geometry = new THREE.CylinderGeometry(0.5, 0.5);
        break;
      case 'Dodecahedron':
        geometry = new THREE.DodecahedronGeometry(0.75);
        break;
      case 'Icosahedron':
        geometry = new THREE.IcosahedronGeometry(0.75);
        break;
      case 'Lathe':
        geometry = new THREE.LatheGeometry([
          new THREE.Vector2(0, -0.75),
          new THREE.Vector2(0.75, 0),
          new THREE.Vector2(0, 0.75)
        ]);
        break;
      case 'Octahedron':
        geometry = new THREE.OctahedronGeometry(0.75);
        break;
      case 'Plane':
        geometry = new THREE.PlaneGeometry(1, 1);
        break;
      case 'Ring':
        geometry = new THREE.RingGeometry(0.4, 0.75);
        break;
      case 'Sphere':
        geometry = new THREE.SphereGeometry(0.75);
        break;
      case 'Tetrahedron':
        geometry = new THREE.TetrahedronGeometry(1);
        break;
      case 'Torus':
        geometry = new THREE.TorusGeometry(0.5, 0.2);
        break;
      case 'TorusKnot':
        geometry = new THREE.TorusKnotGeometry(0.4, 0.16);
        break;
      case 'Tube': {
        const path = new THREE.CatmullRomCurve3([
          new THREE.Vector3(-1, 0, 0),
          new THREE.Vector3(0, 0.5, 0),
          new THREE.Vector3(1, 0, 0)
        ]);
        geometry = new THREE.TubeGeometry(path, 20, 0.2, 8, false);
        break;
      }
      default:
        return null;
    }

    return geometry;
  }

  createLight(type) {
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

      default:
        return null;
    }

    this.addHelper(light, helper);

    return light;
  }

  createCamera(type) {
    let camera, helper;

    switch (type) {
      case 'Perspective': {
        camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2000);
        helper = new THREE.CameraHelper(camera);
        break;
      }
      case 'Orthographic': {
        const aspect = window.innerWidth / window.innerHeight;
        const frustumSize = 2;
        camera = new THREE.OrthographicCamera(
          -frustumSize * aspect / 2, frustumSize * aspect / 2,
          frustumSize / 2, -frustumSize / 2,
          0.1, 2000
        );
        helper = new THREE.CameraHelper(camera);
        break;
      }
      default:
        return null;
    }

    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    const color = new THREE.Color(0xffffff);
    helper.setColors(
      color, color, color, color, color
    );

    this.addHelper(camera, helper);

    return camera;
  }

  createGroup(type) {
    const group = new THREE.Group();
    group.name = type || 'Group';
    group.position.set(0, 0, 0);
    return group;
  }

  addHelper(object, helper) {
    if (!helper) return;

    var geometry = new THREE.SphereGeometry( 1, 4, 2 );
    var material = new THREE.MeshBasicMaterial({ color: 0xff0000, visible: false, wireframe: true });

    const picker = new THREE.Mesh(geometry, material);
    picker.name = 'picker';
    picker.userData.object = object;

    object.userData.helper = helper;
    object.add(picker);

    this.sceneManager.sceneHelpers.add(helper);
  }
}