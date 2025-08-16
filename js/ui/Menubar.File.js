import * as THREE from 'three';
import { Loader } from '../utils/Loader.js';
import { Exporter } from '../utils/Exporter.js';

export class MenubarFile {
  constructor(editor) {
    this.signals = editor.signals;
    this.sceneManager = editor.sceneManager;
    this.objectFactory = editor.objectFactory;
    this.selection = editor.selection;
    this.toolbar = editor.toolbar;
    this.init(editor);
  }

  init(editor) {
     document.querySelectorAll('[data-new]').forEach(item => {
      item.addEventListener('click', (event) => {
        const sceneType = event.target.getAttribute('data-new');
        this.tryCreateScene(sceneType);
      })
     });

     document.querySelector('.open').addEventListener('click', () => {
      this.openProject(editor);
     });

     document.querySelector('.save').addEventListener('click', () => {
      this.saveProject(editor);
     });

     document.querySelector('.import').addEventListener('click', () => {
      this.importObject(editor);
     });

     document.querySelectorAll('[data-export]').forEach(item => {
      item.addEventListener('click', (event) => {
        const exportFormat = event.target.getAttribute('data-export');
        this.exportObject(editor, exportFormat);
      });
    });
  }

  tryCreateScene(type) {
    const confirmed = window.confirm('Any unsaved data will be lost. Continue?');
    if (confirmed) {
      this.createScene(type);
    }
  }

  createScene(type) {
    this.selection.deselect();

    switch (type) {
      case 'empty':
        this.sceneManager.emptyAllScenes();
        this.signals.sceneGraphChanged.dispatch();
        break;
      case 'cube': {
        this.sceneManager.emptyAllScenes();
        const cube = this.objectFactory.createGeometry('Box');
        this.sceneManager.addObject(cube);
        this.signals.sceneGraphChanged.dispatch();
        break;
      }
      case 'torus': {
        this.sceneManager.emptyAllScenes();
        const cube = this.objectFactory.createGeometry('Torus');
        this.sceneManager.addObject(cube);
        this.signals.sceneGraphChanged.dispatch();
        break;
      }
      case 'camera': {
        this.sceneManager.emptyAllScenes();
        const cube = this.objectFactory.createGeometry('Box');
        this.sceneManager.addObject(cube);
        const camera = this.objectFactory.createCamera('Perspective', this.sceneManager);
        camera.position.set(0, 0, 10);
        this.sceneManager.addObject(camera);
        this.signals.sceneGraphChanged.dispatch();
        break;
      }
    }

    this.toolbar.updateTools();
  }

  openProject(editor) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const json = JSON.parse(text);

        editor.fromJSON(json);

        console.log(`Project loaded: ${file.name}`);
      } catch (e) {
        console.error('Failed to open project:', e);
        alert('Failed to open project.');
      }
    });

    input.click();
  }

  saveProject(editor, filename = 'project.json') {
    try {
      const json = editor.toJSON();
      const blob = new Blob([JSON.stringify(json)], { type: 'application/json' });

      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);

      console.log(`Project saved as ${filename}`);
    } catch (e) {
      console.error('Failed to save project:', e);
      alert('Failed to save project.');
    }
  }

  importObject(editor) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = [
      '.3dm', '.3ds', '3mf', '.amf', '.dae', '.drc', '.fbx',
      '.glb', '.gltf', '.js', '.json', '.kmz', '.ldr', '.mpd',
      '.md2', '.obj', '.pcd', '.ply', '.stl', '.svg', '.usdz', '.vox'
    ].join(',');

    input.addEventListener('change', (event) => {
      const file = event.target.files[0];
      if (!file) return;

      const loader = new Loader(editor);
      loader.load(file);
    });

    input.click();
  }

  exportObject(editor, format) {
    const object = this.selection.selectedObject;
    const exporter = new Exporter(editor);

    if (!object) {
      alert('Please select an object to export.');
      return;
    }
    exporter.export(object, format);
  }
}