import { MenubarFile } from './Menubar.File.js';
import { MenubarEdit } from './Menubar.Edit.js';
import { MenubarAdd } from './Menubar.Add.js';
import { MenubarView } from './Menubar.View.js';
import { MenubarHelp } from './Menubar.Help.js';
import { auth } from '../login/AuthService.js';
import { LoginPanel } from '../login/LoginPanel.js';
import { AccountPanel } from '../login/AccountPanel.js';

export default class Menubar {
  constructor(editor) {
    this.uiLoader = editor.uiLoader;
    this.signals = editor.signals;

    this.load(editor);
  }

  load(editor) {
    this.uiLoader.loadComponent('#menu-container', 'components/menu-bar.html', () => {
      // Initialize submenus
      new MenubarFile(editor);
      new MenubarEdit(editor);
      new MenubarAdd(editor);
      new MenubarView(editor);
      new MenubarHelp(editor);

      // Buttons
      this.loginButton = document.querySelector('.login-button');
      this.accountButton = document.querySelector('.account-button');
      this.pricingButton = document.querySelector('.pricing-button');

      this.loginPanel = new LoginPanel();
      this.accountPanel = new AccountPanel();

      this.loginButton.onclick = () => this.loginPanel.open();
      this.accountButton.onclick = () => this.accountPanel.open();

      auth.signals.login.add(() => {
        this.loginButton.classList.add('hidden');
        this.accountButton.classList.remove('hidden');
      });

      auth.signals.logout.add(() => {
        this.accountButton.classList.add('hidden');
        this.loginButton.classList.remove('hidden');
      });

      this.signals.showLoginPanel.add(() => {
        this.loginPanel.open();
      })

      this.signals.showAccountPanel.add(() => {
        this.accountPanel.open();
      })

      this.pricingButton.addEventListener('click', () => {
        window.open('/pricing', '_blank');
      });
    });
  }
}