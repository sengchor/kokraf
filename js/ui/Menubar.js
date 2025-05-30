import { MenubarAdd } from './Menubar.Add.js';

export default class Menubar {
  constructor( editor ) {
    this.uiLoader = editor.uiLoader;
    this.sceneManager = editor.sceneManager;
    this.load();
  }

  load() {
    this.uiLoader.loadComponent('#menu-container', 'components/menu-bar.html', () => {
      new MenubarAdd(this.sceneManager);
    });
  }
}