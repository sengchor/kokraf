import { supabase } from '../login/supabase.js';

export class AccountPanel {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.uiLoader = editor.uiLoader;
    
    this.load();
    this.setupListeners();
  }

  load() {
    this.uiLoader.loadComponent('#overlay-root-account', 'components/account-panel.html', () => {
      this.overlay = document.getElementById('account-overlay');
      this.logoutBtn = document.getElementById('account-logout');
      this.emailDisplay = document.getElementById('account-email');

      document
        .getElementById('account-close')
        .addEventListener('click', () => this.close());

      this.logoutBtn.addEventListener('click', () => this.logout());
    });
  }

  setupListeners() {
    this.signals.showAccount.add(() => this.open());
  }

  async open() {
    const { data: { session }, error } = await supabase.auth.getSession();

    if (session && session.user) {
      this.emailDisplay.textContent = session.user.email;
    } else {
      this.emailDisplay.textContent = 'Not signed in';
    }

    this.overlay.classList.remove('hidden');
  }

  close() {
    this.overlay.classList.add('hidden');
  }

  async logout() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Logout error:', error);
    } else {
      this.close();
      this.signals.userLoggedOut.dispatch();
    }
  }
}