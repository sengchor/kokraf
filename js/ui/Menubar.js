import { MenubarAdd } from './Menubar.Add.js';
import { MenubarView } from './Menubar.View.js';
import { MenubarHelp } from './Menubar.Help.js';
import { MenubarFile } from './Menubar.File.js';

export default class Menubar {
  constructor( editor ) {
    this.uiLoader = editor.uiLoader;
    this.load(editor);
  }

  load(editor) {
    this.uiLoader.loadComponent('#menu-container', 'components/menu-bar.html', () => {
      new MenubarAdd(editor);
      new MenubarView(editor);
      new MenubarHelp(editor);
      new MenubarFile(editor);
    });
  }
}