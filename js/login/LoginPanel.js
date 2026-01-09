import { supabase } from '../login/supabase.js';

export class LoginPanel {
  constructor({ rootSelector = 'body', onSuccess } = {}) {
    this.mode = 'login';
    this.root = document.querySelector(rootSelector);
    this.onSuccess = onSuccess;
    this.load();
  }

  load() {
    // Insert HTML into root
    const template = `
      <div id="login-overlay" class="login-overlay hidden">
        <div class="login-panel">
          <button id="login-close" class="login-close" aria-label="Close">✕</button>
          <h3 id="login-title">Log In</h3>
          <label class="login-label" for="login-email">Email</label>
          <input id="login-email" type="email" placeholder="email@example.com" />
          <label class="login-label" for="login-password">Password</label>
          <input id="login-password" type="password" placeholder="password" />
          <label class="login-label hidden" id="login-confirm-label" for="login-password-confirm">Confirm Password</label>
          <input id="login-password-confirm" type="password" placeholder="password" class="hidden" />
          <button id="login-submit">Log In</button>
          <div id="login-error" class="error"></div>
          <div class="switch-mode">
            <span id="toggle-login-signup">Don't have an account? Sign Up</span>
          </div>
        </div>
      </div>
    `;
    this.root.insertAdjacentHTML('beforeend', template);

    // DOM references
    this.overlay = document.getElementById('login-overlay');
    this.error = document.getElementById('login-error');
    this.title = document.getElementById('login-title');
    this.submitBtn = document.getElementById('login-submit');
    this.emailInput = document.getElementById('login-email');
    this.passwordInput = document.getElementById('login-password');
    this.confirmInput = document.getElementById('login-password-confirm');
    this.confirmLabel = document.getElementById('login-confirm-label');
    this.toggleLink = document.getElementById('toggle-login-signup');

    document
      .getElementById('login-close')
      .addEventListener('click', () => this.close());
    this.toggleLink.addEventListener('click', () => this.toggleMode());
    this.submitBtn.addEventListener('click', () => this.submit());
  }

  open() {
    this.overlay.classList.remove('hidden');
  }

  close() {
    this.overlay.classList.add('hidden');
    this.error.textContent = '';

    this.emailInput.value = '';
    this.passwordInput.value = '';
    this.confirmInput.value = '';
  }

  toggleMode() {
    this.emailInput.value = '';
    this.passwordInput.value = '';
    this.confirmInput.value = '';

    if (this.mode === 'login') {
      this.mode = 'signup';
      this.title.textContent = 'Sign Up';
      this.submitBtn.textContent = 'Sign Up';
      this.confirmInput.classList.remove('hidden');
      this.confirmLabel.classList.remove('hidden');
      this.toggleLink.textContent = 'Already have an account? Log In';
    } else {
      this.mode = 'login';
      this.title.textContent = 'Log In';
      this.submitBtn.textContent = 'Log In';
      this.confirmInput.classList.add('hidden');
      this.confirmLabel.classList.add('hidden');
      this.toggleLink.textContent = "Don't have an account? Sign Up";
    }
  }

  async submit() {
    const email = this.emailInput.value;
    const password = this.passwordInput.value;
    const confirm = this.confirmInput.value;

    this.error.textContent = '';

    if (!email || !password || (this.mode === 'signup' && !confirm)) {
      this.error.textContent = 'Please fill all fields';
      return;
    }

    if (this.mode === 'signup' && password !== confirm) {
      this.error.textContent = 'Passwords do not match';
      return;
    }

    try {
      let response;

      if (this.mode === 'login') {
        response = await supabase.auth.signInWithPassword({ email, password });
      } else {
        response = await supabase.auth.signUp({ email, password });
      }

      this.emailInput.value = '';
      this.passwordInput.value = '';
      this.confirmInput.value = '';

      if (response.error) {
        this.error.textContent = response.error.message;
        return;
      }

      const { user, session } = response.data;
      this.close();

      if (this.mode === 'signup' && !session) {
        alert('Check your email to confirm your account.');
        return;
      }

      if (this.onSuccess && user) {
        this.onSuccess(user);
      }
    } catch(err) {
      console.error(err);
      this.error.textContent = 'An unexpected error occurred';
    }
  }
}