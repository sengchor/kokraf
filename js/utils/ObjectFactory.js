import * as THREE from 'three';
import { MeshDataBuilders } from './MeshDataBuilders.js';

export class ObjectFactory {
  constructor(editor) {
    this.editor = editor;
  }

  createGeometry(type) {
    let geometry;
    let meshData;
    let vertexIndexMap;

    switch (type) {
      case 'Plane':
        meshData = MeshDataBuilders.createPlaneMeshData();
        break;
      case 'Cube':
        meshData = MeshDataBuilders.createCubeMeshData();
        break;
      case 'Circle':
        meshData = MeshDataBuilders.createCircleMeshData();
        break;
      case 'Sphere':
        meshData = MeshDataBuilders.createSphereMeshData();
        break;
      case 'Cylinder':
        meshData = MeshDataBuilders.createCylinderMeshData();
        break;
      case 'Cone':
        meshData = MeshDataBuilders.createConeMeshData();
        break;
      case 'Torus':
        meshData = MeshDataBuilders.createTorusMeshData();
        break;
      default: return null;
    }

    ({ geometry, vertexIndexMap } = meshData.toBufferGeometry());
    
    const material = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.5, roughness: 0.2, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.meshData = meshData;
    mesh.userData.vertexIndexMap = vertexIndexMap;
    mesh.position.set(0, 0, 0);
    mesh.name = type;
    return mesh;
  }

  createLight(type) {
    let light;

    switch (type) {
      case 'Ambient':
        light = new THREE.AmbientLight(0xffffff, 5);
        break;

      case 'Directional':
        light = new THREE.DirectionalLight(0xffffff, 10);
        light.position.set(5, 5, 5);
        break;

      case 'Hemisphere':
        light = new THREE.HemisphereLight(0xffffff, 0x444444, 10);
        break;

      case 'Point':
        light = new THREE.PointLight(0xffffff, 10, 10);
        light.position.set(0, 0, 0);
        break;

      case 'Spot':
        light = new THREE.SpotLight(0xffffff, 100);
        light.position.set(5, 5, 5);
        light.angle = Math.PI * 0.1;
        light.penumbra = 0;
        light.distance = 20;
        break;

      default: return null;
    }
    light.name = type;
    return light;
  }

  createCamera(type) {
    let camera;

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
    camera.name = type;

    return camera;
  }

  createGroup(type = 'Group') {
    const group = new THREE.Group();
    group.name = type;
    group.position.set(0, 0, 0);
    return group;
  }

  createHelper(object) {
    let helper = null;

    if (object.isCamera) {
      helper = new THREE.CameraHelper(object);
      helper.setColors?.(
        new THREE.Color(0xffffff),
        new THREE.Color(0xffffff),
        new THREE.Color(0xffffff),
        new THREE.Color(0xffffff),
        new THREE.Color(0xffffff)
      );
    } else if (object.isPointLight) {
      helper = new THREE.PointLightHelper(object, 0.3);
    } else if (object.isDirectionalLight) {
      helper = new THREE.DirectionalLightHelper(object, 0.5);
    } else if (object.isSpotLight) {
      helper = new THREE.SpotLightHelper(object);
    } else if (object.isHemisphereLight) {
      helper = new THREE.HemisphereLightHelper(object, 0.5);
    } else if (object.isSkinnedMesh) {
      helper = new THREE.SkeletonHelper(object.skeleton.bones[ 0 ]);
    } else if (object.isBone === true && object.parent && object.parent.isBone !== true) {
      helper = new THREE.SkeletonHelper(object);
    } else {
      return;
    }

    const geometry = new THREE.SphereGeometry(1, 4, 2);
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000, visible: false, wireframe: true });
    const picker = new THREE.Mesh(geometry, material);

    picker.name = 'picker';
    picker.userData.object = object;

    helper.add(picker);

    return helper;
  }
}