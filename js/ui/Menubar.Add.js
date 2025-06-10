import { AddObjectCommand } from "../commands/AddObjectCommand.js";

export class MenubarAdd {
  constructor(editor) {
    this.editor = editor;
    this.sceneManager = editor.sceneManager;
    this.objectFactory = editor.objectFactory;
    this.init();
  }

  init() {
    document.querySelector('[data-group]').addEventListener('click', (event) => {
      const groupType = event.target.getAttribute('data-group');
      const group = this.objectFactory.createGroup(groupType);
      this.editor.execute(new AddObjectCommand(this.editor, group));
    });

    document.querySelectorAll('[data-geometry]').forEach(item => {
      item.addEventListener('click', (event) => {
        const geometryType = event.target.getAttribute('data-geometry');
        const geometry = this.objectFactory.createGeometry(geometryType);
        this.editor.execute(new AddObjectCommand(this.editor, geometry));
      });
    });

    document.querySelectorAll('[data-light]').forEach(item => {
      item.addEventListener('click', (event) => {
        const lightType = event.target.getAttribute('data-light');
        const light = this.objectFactory.createLight(lightType);
        this.editor.execute(new AddObjectCommand(this.editor, light));
      });
    });

    document.querySelectorAll('[data-camera]').forEach(item => {
      item.addEventListener('click', (event) => {
        const cameraType = event.target.getAttribute('data-camera');
        const camera = this.objectFactory.createCamera(cameraType);
        this.editor.execute(new AddObjectCommand(this.editor, camera));
      })
    });
  }
}