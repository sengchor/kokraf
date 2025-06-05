import {createGroup, createGeometry, createLight, createCamera} from '../utils/ObjectFactory.js'

export class MenubarAdd {
  constructor(editor) {
    this.sceneManager = editor.sceneManager;
    this.init();
  }

  init() {
    document.querySelector('[data-group]').addEventListener('click', (event) => {
      const groupType = event.target.getAttribute('data-group');
      const group = createGroup(groupType);
      this.sceneManager.addObject(group);
    });

    document.querySelectorAll('[data-geometry]').forEach(item => {
      item.addEventListener('click', (event) => {
        const geometryType = event.target.getAttribute('data-geometry');
        const geometry = createGeometry(geometryType);
        this.sceneManager.addGeometry(geometry);
      });
    });

    document.querySelectorAll('[data-light]').forEach(item => {
      item.addEventListener('click', (event) => {
        const lightType = event.target.getAttribute('data-light');
        const light = createLight(lightType, this.sceneManager);
        this.sceneManager.addObject(light);
      });
    });

    document.querySelectorAll('[data-camera]').forEach(item => {
      item.addEventListener('click', (event) => {
        const cameraType = event.target.getAttribute('data-camera');
        const camera = createCamera(cameraType, this.sceneManager);
        this.sceneManager.addObject(camera);
      })
    });
  }
}