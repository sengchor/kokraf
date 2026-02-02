import { MenubarFile } from './Menubar.File.js';
import { MenubarEdit } from './Menubar.Edit.js';
import { MenubarAdd } from './Menubar.Add.js';
import { MenubarView } from './Menubar.View.js';
import { MenubarHelp } from './Menubar.Help.js';
import { auth } from '/supabase/AuthService.js';
import { LoginPanel } from '../login/LoginPanel.js';
import { AccountPanel } from '../login/AccountPanel.js';

export default class Menubar {
  constructor(editor) {
    this.uiLoader = editor.uiLoader;
    this.signals = editor.signals;

    this.ready = this.load(editor);
  }

  async load(editor) {
    await this.uiLoader.loadComponent('#menu-container', 'components/menu-bar.html');

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

    this.initMenuBar();
  }

  initMenuBar() {
    function closeAllMenus() {
      document
        .querySelectorAll('.menu-item.active')
        .forEach(m => m.classList.remove('active'));

      // temporarily kill hover
      document.body.classList.add('menu-closing');

      requestAnimationFrame(() => {
        document.body.classList.remove('menu-closing');
      });
    }

    const menuItems = document.querySelectorAll('.menu-item');

    menuItems.forEach(item => {
      item.addEventListener('click', e => {

        // ignore submenu clicks here
        if (e.target.closest('.submenu')) return;

        menuItems.forEach(i => {
          if (i !== item) i.classList.remove('active');
        });

        item.classList.toggle('active');

        e.stopPropagation();
      });
    });

    document.addEventListener('click', e => {
      if (e.target.closest('.submenu li')) {
        closeAllMenus();
      }
    });

    // Close menu when hovering outside
    let closeTimeout = null;

    document.addEventListener('mousemove', e => {
      const activeMenu = document.querySelector('.menu-item.active');
      if (!activeMenu) return;

      const submenu = activeMenu.querySelector('.submenu');

      if (activeMenu.contains(e.target) ||
          (submenu && submenu.contains(e.target))) {
        clearTimeout(closeTimeout);
        return;
      }

      closeTimeout = setTimeout(() => {
        activeMenu.classList.remove('active');
      }, 300);
    });
  }
}