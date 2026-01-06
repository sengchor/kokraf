import { MenubarFile } from './Menubar.File.js';
import { MenubarEdit } from './Menubar.Edit.js';
import { MenubarAdd } from './Menubar.Add.js';
import { MenubarView } from './Menubar.View.js';
import { MenubarHelp } from './Menubar.Help.js';

export default class Menubar {
  constructor( editor ) {
    this.uiLoader = editor.uiLoader;
    this.signals = editor.signals;
    this.load(editor);
  }

  load(editor) {
    this.uiLoader.loadComponent('#menu-container', 'components/menu-bar.html', () => {
      new MenubarFile(editor);
      new MenubarEdit(editor);
      new MenubarAdd(editor);
      new MenubarView(editor);
      new MenubarHelp(editor);

      const loginButton = document.querySelector('.login-button');
      loginButton.addEventListener('click', () => {
        this.signals.showLogin.dispatch();
      });
    });
  }
}