import * as THREE from 'three';
import { MeshData } from '../core/MeshData.js';

export class ObjectFactory {
  constructor(editor) {
    this.editor = editor;
  }

  createGeometry(type) {
    let geometry;
    let meshData;
    let vertexIndexMap;

    switch (type) {
      case 'Box': 
        meshData = new MeshData();

        const v0 = meshData.addVertex({ x: -0.5, y: -0.5, z: -0.5 });
        const v1 = meshData.addVertex({ x:  0.5, y: -0.5, z: -0.5 });
        const v2 = meshData.addVertex({ x:  0.5, y:  0.5, z: -0.5 });
        const v3 = meshData.addVertex({ x: -0.5, y:  0.5, z: -0.5 });

        const v4 = meshData.addVertex({ x: -0.5, y: -0.5, z:  0.5 });
        const v5 = meshData.addVertex({ x:  0.5, y: -0.5, z:  0.5 });
        const v6 = meshData.addVertex({ x:  0.5, y:  0.5, z:  0.5 });
        const v7 = meshData.addVertex({ x: -0.5, y:  0.5, z:  0.5 });

        meshData.addFace([v3, v2, v1, v0]);
        meshData.addFace([v4, v5, v6, v7]);
        meshData.addFace([v0, v4, v7, v3]);
        meshData.addFace([v2, v6, v5, v1]);
        meshData.addFace([v3, v7, v6, v2]);
        meshData.addFace([v1, v5, v4, v0]);

        ({ geometry, vertexIndexMap } = meshData.toBufferGeometry());
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
      default: return null;
    }

    console.log("Indexed:", geometry.index !== null);
    console.log("Vertex count:", geometry.attributes.position.count);
    console.log("Index count:", geometry.index.count);

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