export class MenubarFile {
  constructor(editor) {
    this.sceneManager = editor.sceneManager;
    this.objectFactory = editor.objectFactory;
    this.init(editor);
  }

  init(editor) {
     document.querySelectorAll('[data-new]').forEach(item => {
      item.addEventListener('click', (event) => {
        const sceneType = event.target.getAttribute('data-new');
        this.createScene(sceneType);
      })
     });

     document.querySelector('.open').addEventListener('click', () => {
      this.openProject(editor);
     });

     document.querySelector('.save').addEventListener('click', () => {
      this.saveProject(editor);
     });
  }

  createScene(type) {
    switch (type) {
      case 'empty':
        this.sceneManager.emptyAllScenes();
        break;
      case 'cube': {
        this.sceneManager.emptyAllScenes();
        const cube = this.objectFactory.createGeometry('Box');
        this.sceneManager.addGeometry(cube);
        break;
      }
      case 'camera': {
        this.sceneManager.emptyAllScenes();
        const cube = this.objectFactory.createGeometry('Box');
        this.sceneManager.addGeometry(cube);
        const camera = this.objectFactory.createCamera('Perspective', this.sceneManager);
        camera.position.set(0, 0, 10);
        this.sceneManager.addObject(camera);
        break;
      }
    }
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
}