import { AddObjectCommand } from "../commands/AddObjectCommand.js";
import { PropertiesPanel } from "../panels/PropertiesPanel.js";

export class MenubarAdd {
  constructor(editor) {
    this.editor = editor;
    this.sceneManager = editor.sceneManager;
    this.objectFactory = editor.objectFactory;

    const propertiesPanelContainer = document.getElementById('properties-panel-container');
    this.propertiesPanel = new PropertiesPanel(editor, propertiesPanelContainer);
    this.init();
  }

  init() {
    document.querySelectorAll('[data-group]').forEach(item => {
      item.addEventListener('click', (event) => {
        const groupType = event.target.getAttribute('data-group');
        const group = this.objectFactory.createGroup(groupType);
        this.editor.execute(new AddObjectCommand(this.editor, group));
      });
    });

    document.querySelectorAll('[data-geometry]').forEach(item => {
      item.addEventListener('click', (event) => {
        const geometryType = event.target.getAttribute('data-geometry');
        const object = this.objectFactory.createGeometry(geometryType);

        const command = new AddObjectCommand(this.editor, object);
        this.editor.execute(command);

        const params = this.objectFactory.getDefaultParams(geometryType);
        this.propertiesPanel.setSelected(command, geometryType, params);
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
      });
    });

    document.querySelectorAll('[data-image]').forEach(item => {
      item.addEventListener('click', (event) => {
        const imageType = event.target.getAttribute('data-image');

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.png, .jpg, .jpeg, .webp';
        input.multiple = false;

        input.addEventListener('change', async (changeEvent) => {
          const file = changeEvent.target.files[0];
          if (!file) return;

          const imageRef = await this.objectFactory.createImageRef(imageType, file);
          this.editor.execute(new AddObjectCommand(this.editor, imageRef));
        });

        input.click();
      });
    });
  }
}