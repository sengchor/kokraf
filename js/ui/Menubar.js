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
      this.starIcon = this.loginButton.querySelector('.star');

      this.loginButton.addEventListener('click', () => {
        this.signals.showLogin.dispatch();
      });
    });
  }

  setupListener() {
    this.signals.userLoggedIn.add(() => {
      this.setAccountState();
    });
  }

  setAccountState() {
    this.loginButton.textContent = ' Account';

    // Re-attach star (since textContent removes children)
    const star = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    star.setAttribute('viewBox', '0 0 24 24');
    star.setAttribute('width', '16');
    star.setAttribute('height', '16');
    star.classList.add('star');

    star.innerHTML = `
      <path d="M12 17.27L18.18 21 16.54 13.97
              22 9.24l-7.19-.62L12 2
              9.19 8.62 2 9.24l5.46 4.73
              L5.82 21z"/>
    `;

    star.style.fill = '#f5c542';
    star.style.stroke = '#888';

    this.loginButton.prepend(star);
  }
}