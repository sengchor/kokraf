import * as THREE from 'three';

export class Loader {
  constructor(editor) {
    this.editor = editor;
    this.sceneManager = editor.sceneManager;
    this.manager = new THREE.LoadingManager();
  }

  async load(file) {
    const extension = file.name.split('.').pop().toLowerCase();
    const reader = new FileReader();

    reader.addEventListener('progress', (event) => {
      const size = '(' + parseFloat(Math.floor(event.total / 1000).toFixed(3)) + ' KB)';
      const progress = Math.floor((event.loaded / event.total) * 100) + '%';
      console.log('Loading', file.name, size, progress);
    });

    const handlers = {
			'3dm': () => this.load3dm(file, reader),
			'3ds': () => this.load3ds(file, reader),
			'3mf': () => this.load3mf(file, reader),
			'amf': () => this.loadAmf(file, reader),
			'dae': () => this.loadDae(file, reader),
			'drc': () => this.loadDrc(file, reader),
			'fbx': () => this.loadFbx(file, reader),
			'glb': () => this.loadGlb(file, reader),
			'gltf': () => this.loadGltf(file, reader),
			'js': () => this.loadJson(file, reader),
			'json': () => this.loadJson(file, reader),
			'kmz': () => this.loadKmz(file, reader),
			'ldr': () => this.loadLDraw(file, reader),
			'mpd': () => this.loadLDraw(file, reader),
			'md2': () => this.loadMd2(file, reader),
			'obj': () => this.loadObj(file, reader),
			'pcd': () => this.loadPcd(file, reader),
			'ply': () => this.loadPly(file, reader),
			'stl': () => this.loadStl(file, reader),
			'svg': () => this.loadSvg(file, reader),
			'usdz': () => this.loadUsdz(file, reader),
			'vox': () => this.loadVox(file, reader),
      'vtk': () => this.loadVtk(file, reader),
      'wrl': () => this.loadWrl(file, reader),
      'xyz': () => this.loadXyz(file, reader),
    };

    if (handlers[extension]) {
      handlers[extension]();
    } else {
      alert(`Unsupported file format: .${extension}`);
    }
  }

  async load3dm(file, reader) {
    reader.addEventListener('load', async (event) => {
      const contents = event.target.result;
      const { Rhino3dmLoader } = await import('jsm/loaders/3DMLoader.js');

      const loader = new Rhino3dmLoader();
      loader.setLibraryPath('jsm/libs/rhino3dm/');
      loader.parse(contents, (object) => {
        object.name = file.name;

        this.sceneManager.addObject(object);
      });
    });
    reader.readAsArrayBuffer(file);
  }

  async load3ds(file, reader) {
    reader.addEventListener('load', async (event) => {
      const { TDSLoader } = await import('jsm/loaders/TDSLoader.js');

      const loader = new TDSLoader();
      const object = loader.parse(event.target.result);

      this.sceneManager.addObject(object);
    });
    reader.readAsArrayBuffer(file);
  }

  async load3mf(file, reader) {
    reader.addEventListener('load', async (event) => {
        const { ThreeMFLoader } = await import('jsm/loaders/3MFLoader.js');

        const loader = new ThreeMFLoader();
        const object = loader.parse(event.target.result);

        this.sceneManager.addObject(object);
    });
    reader.readAsArrayBuffer(file);
  }

  async loadAmf(file, reader) {
    reader.addEventListener('load', async (event) => {
      	const { AMFLoader } = await import('jsm/loaders/AMFLoader.js');

				const loader = new AMFLoader();
				const amfobject = loader.parse(event.target.result);

        this.sceneManager.addObject(amfobject);
    });
    reader.readAsArrayBuffer(file);
  }

  async loadDae(file, reader) {
    reader.addEventListener('load', async (event) => {
      const contents = event.target.result;

      const { ColladaLoader } = await import('jsm/loaders/ColladaLoader.js');
      const loader = new ColladaLoader(this.manager);
      const collada = loader.parse(contents);

      collada.scene.name = file.name;

      this.sceneManager.addObject(collada.scene);
    });

    reader.readAsText(file);
  }

  async loadDrc(file, reader) {
    reader.addEventListener('load', async (event) => {
      const contents = event.target.result;

      const { DRACOLoader } = await import('jsm/loaders/DRACOLoader.js');
      const loader = new DRACOLoader(this.manager);

      loader.setDecoderPath('jsm/libs/draco/');

      loader.parse(contents, (geometry) => {
        let object;

        if (geometry.index !== null) {
          const material = new THREE.MeshStandardMaterial();
          object = new THREE.Mesh(geometry, material);
        } else {
          const material = new THREE.PointsMaterial({ size: 0.01 });
          material.vertexColors = geometry.hasAttribute('color');
          object = new THREE.Points(geometry, material);
        }

        object.name = file.name;

        loader.dispose();
        this.sceneManager.addObject(object);
      });
    });

    reader.readAsArrayBuffer(file);
  }

  async loadFbx(file, reader) {
    reader.addEventListener('load', async (event) => {
      const contents = event.target.result;

      const { FBXLoader } = await import('jsm/loaders/FBXLoader.js');

      const loader = new FBXLoader(this.manager);
      const object = loader.parse(contents);

      object.name = file.name;

      this.sceneManager.addObject(object);
    });

    reader.readAsArrayBuffer(file);
  }

  async loadGlb(file, reader) {
    reader.addEventListener('load', async (event) => {
      const contents = event.target.result;

      const loader = await createGLTFLoader();

      loader.parse(contents, '', (result) => {
        const scene = result.scene;
        scene.name = file.name;
        scene.animations.push(...result.animations);

        this.sceneManager.addObject(scene);

        if (loader.dracoLoader) loader.dracoLoader.dispose();
        if (loader.ktx2Loader) loader.ktx2Loader.dispose();
      });
    });

    reader.readAsArrayBuffer(file);
  }

  async loadGltf(file, reader) {
    reader.addEventListener('load', async (event) => {
      const contents = event.target.result;

      const loader = await createGLTFLoader(this.manager);

      loader.parse(contents, '', (result) => {
        const scene = result.scene;
        scene.name = file.name;

        scene.animations.push(...result.animations);

        this.sceneManager.addObject(scene);

        if (loader.dracoLoader) loader.dracoLoader.dispose();
        if (loader.ktx2Loader) loader.ktx2Loader.dispose();
      });
    });

    reader.readAsArrayBuffer(file);
  }

  loadJson(file, reader) {
    reader.addEventListener('load', (event) => {
      const contents = event.target.result;

      if (contents.includes('postMessage')) {
        const blob = new Blob([contents], { type: 'text/javascript' });
        const url = URL.createObjectURL(blob);

        const worker = new Worker(url);
        worker.onmessage = (event) => {
          event.data.metadata = { version: 2 };
          this.handleJSON(event.data);
        };

        worker.postMessage(Date.now());
        return;
      }

      let data;
      try {
        data = JSON.parse(contents);
      } catch (error) {
        alert(`Error parsing JSON: ${error.message}`);
        return;
      }

      this.handleJSON(data);
    });

    reader.readAsText(file);
  }

  async loadKmz(file, reader) {
    reader.addEventListener('load', async (event) => {
      const { KMZLoader } = await import('jsm/loaders/KMZLoader.js');

      const loader = new KMZLoader();
      const collada = loader.parse(event.target.result);

      collada.scene.name = file.name;

      this.sceneManager.addObject(collada.scene);
    });

    reader.readAsArrayBuffer(file);
  }

  async loadLDraw(file, reader) {
    reader.addEventListener('load', async (event) => {
      const contents = event.target.result;

      const { LDrawLoader } = await import('jsm/loaders/LDrawLoader.js');

      const loader = new LDrawLoader();
      loader.setPath('ldrawLib/');

      loader.parse(contents, (group) => {
        group.name = file.name;
        group.rotation.x = Math.PI;

        this.sceneManager.addObject(group);
      });
    });

    reader.readAsText(file);
  }

  async loadMd2(file, reader) {
    reader.addEventListener('load', async (event) => {
      const contents = event.target.result;

      const { MD2Loader } = await import('jsm/loaders/MD2Loader.js');

      const loader = new MD2Loader();
      const geometry = loader.parse(contents);
      const material = new THREE.MeshStandardMaterial();

      const mesh = new THREE.Mesh(geometry, material);
      mesh.mixer = new THREE.AnimationMixer(mesh);
      mesh.name = file.name;

      mesh.animations.push(...geometry.animations);

      this.sceneManager.addObject(mesh);
    });

    reader.readAsArrayBuffer(file);
  }

  async loadObj(file, reader) {
    reader.addEventListener('load', async (event) => {
      const { OBJLoader } = await import('jsm/loaders/OBJLoader.js');

      const object = new OBJLoader().parse(event.target.result);
      object.name = file.name;
      this.sceneManager.addObject(object);
    });
    reader.readAsText(file);
  }

  async loadPcd(file, reader) {
    reader.addEventListener('load', async (event) => {
      const contents = event.target.result;

      const { PCDLoader } = await import('jsm/loaders/PCDLoader.js');

      const loader = new PCDLoader();
      const points = loader.parse(contents);
      points.name = file.name;

      this.sceneManager.addObject(points);
    });

    reader.readAsArrayBuffer(file);
  }

  async loadPly(file, reader) {
    reader.addEventListener('load', async (event) => {
      const contents = event.target.result;

      const { PLYLoader } = await import('jsm/loaders/PLYLoader.js');

      const loader = new PLYLoader();
      const geometry = loader.parse(contents);
      let object;

      if (geometry.index !== null) {
        const material = new THREE.MeshStandardMaterial();
        object = new THREE.Mesh(geometry, material);
      } else {
        const material = new THREE.PointsMaterial({ size: 0.01 });
        material.vertexColors = geometry.hasAttribute('color');
        object = new THREE.Points(geometry, material);
      }

      object.name = file.name;
      this.sceneManager.addObject(object);
    });

    reader.readAsArrayBuffer(file);
  }

  async loadStl(file, reader) {
    reader.addEventListener('load', async (event) => {
      const contents = event.target.result;

      const { STLLoader } = await import('jsm/loaders/STLLoader.js');

      const loader = new STLLoader();
      const geometry = loader.parse(contents);
      const material = new THREE.MeshStandardMaterial();

      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = file.name;

      this.sceneManager.addObject(mesh);
    });

    if (reader.readAsBinaryString !== undefined) {
      reader.readAsBinaryString(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
  }

  async loadSvg(file, reader) {
    reader.addEventListener('load', async (event) => {
      const contents = event.target.result;

      const { SVGLoader } = await import('jsm/loaders/SVGLoader.js');

      const loader = new SVGLoader();
      const paths = loader.parse(contents).paths;

      const group = new THREE.Group();
      group.name = file.name;
      group.scale.multiplyScalar(0.1);
      group.scale.y *= -1;

      for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        const material = new THREE.MeshBasicMaterial({
          color: path.color,
          depthWrite: false,
        });

        const shapes = SVGLoader.createShapes(path);

        for (let j = 0; j < shapes.length; j++) {
          const shape = shapes[j];
          const geometry = new THREE.ShapeGeometry(shape);
          const mesh = new THREE.Mesh(geometry, material);
          group.add(mesh);
        }
      }

      this.sceneManager.addObject(group);
    });

    reader.readAsText(file);
  }

  async loadUsdz(file, reader) {
    reader.addEventListener('load', async (event) => {
      const contents = event.target.result;

      const { USDZLoader } = await import('jsm/loaders/USDZLoader.js');

      const group = new USDZLoader().parse(contents);
      group.name = file.name;

      this.sceneManager.addObject(group);
    });

    reader.readAsArrayBuffer(file);
  }

  async loadVox(file, reader) {
    reader.addEventListener('load', async (event) => {
      const contents = event.target.result;

      const { VOXLoader, VOXMesh } = await import('jsm/loaders/VOXLoader.js');

      const chunks = new VOXLoader().parse(contents);

      const group = new THREE.Group();
      group.name = file.name;

      chunks.forEach(chunk => {
        const mesh = new VOXMesh(chunk);
        group.add(mesh);
      });

      this.sceneManager.addObject(group);
    });

    reader.readAsArrayBuffer(file);
  }

  async loadVtk(file, reader) {
    reader.addEventListener('load', async (event) => {
      const contents = event.target.result;

      const { VTKLoader } = await import('jsm/loaders/VTKLoader.js');

      const geometry = new VTKLoader().parse(contents);
      const material = new THREE.MeshStandardMaterial();

      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = file.name;

      this.sceneManager.addObject(mesh);
    });

    reader.readAsArrayBuffer(file);
  }

  async loadWrl(file, reader) {
    reader.addEventListener('load', async (event) => {
      const contents = event.target.result;

      const { VRMLLoader } = await import('jsm/loaders/VRMLLoader.js');

      const result = new VRMLLoader().parse(contents);

      this.sceneManager.addObject(result);
    });

    reader.readAsText(file);
  }

  async loadXyz(file, reader) {
    reader.addEventListener('load', async (event) => {
      const contents = event.target.result;

      const { XYZLoader } = await import('jsm/loaders/XYZLoader.js');

      const geometry = new XYZLoader().parse(contents);

      const material = new THREE.PointsMaterial();
      material.vertexColors = geometry.hasAttribute('color');

      const points = new THREE.Points(geometry, material);
      points.name = file.name;

      this.sceneManager.addObject(points);
    });

    reader.readAsText(file);
  }
}
