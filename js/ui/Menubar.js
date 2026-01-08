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
    this.setupListener();
  }

  load(editor) {
    this.uiLoader.loadComponent('#menu-container', 'components/menu-bar.html', () => {
      new MenubarFile(editor);
      new MenubarEdit(editor);
      new MenubarAdd(editor);
      new MenubarView(editor);
      new MenubarHelp(editor);

      this.loginButton = document.querySelector('.login-button');
      this.accountButton = document.querySelector('.account-button');
      this.pricingButton = document.querySelector('.pricing-button');

      this.loginButton.addEventListener('click', () => {
        this.signals.showLogin.dispatch();
      });

      this.accountButton.addEventListener('click', () => {
        this.signals.showAccount.dispatch();
      });

      this.pricingButton.addEventListener('click', () => {
        this.signals.showPricing.dispatch();
      });
    });
  }

  setupListener() {
    this.signals.userLoggedIn.add(() => {
      this.loginButton.classList.add('hidden');
      this.accountButton.classList.remove('hidden');
    });

    this.signals.userLoggedOut.add(() => {
      this.accountButton.classList.add('hidden');
      this.loginButton.classList.remove('hidden');
    });
  }
}