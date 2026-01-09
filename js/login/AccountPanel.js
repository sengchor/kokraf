import { supabase } from '../login/supabase.js';

export class AccountPanel {
  constructor({ rootSelector = 'body' } = {}) {
    this.root = document.querySelector(rootSelector);

    this.load();
  }

  load() {
    const template = `
      <div id="account-overlay" class="account-overlay hidden">
        <div class="account-panel">
          <button id="account-close" class="account-close"aria-label="Close">✕</button>

          <h3 class="account-title">Account</h3>

          <div class="account-section">
            <div class="account-label">Signed in as</div>
            <div id="account-email" class="account-email">user@email.com</div>
          </div>

          <div class="account-actions">
            <button id="account-logout">Log Out</button>
          </div>
        </div>
      </div>
    `;

    this.root.insertAdjacentHTML('beforeend', template);

    this.overlay = document.getElementById('account-overlay');
    this.emailDisplay = document.getElementById('account-email');
    this.logoutBtn = document.getElementById('account-logout');

    document
      .getElementById('account-close')
      .addEventListener('click', () => this.close());

    this.logoutBtn.addEventListener('click', () => this.logout());
  }

  async open() {
    const { data: { session } } = await supabase.auth.getSession();

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
      return;
    }

    this.close();
  }
}