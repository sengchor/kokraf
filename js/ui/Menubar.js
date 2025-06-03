import { MenubarAdd } from './Menubar.Add.js';
import { MenubarView } from './Menubar.View.js';

export default class Menubar {
  constructor( editor ) {
    this.uiLoader = editor.uiLoader;
    this.load(editor);
  }

  load(editor) {
    this.uiLoader.loadComponent('#menu-container', 'components/menu-bar.html', () => {
      new MenubarAdd(editor);
      new MenubarView(editor);
    });
  }
}