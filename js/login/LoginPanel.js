import { auth } from '/supabase/AuthService.js';

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

          <button id="login-google" class="gsi-material-button">
            <div class="gsi-material-button-icon">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                <path fill="none" d="M0 0h48v48H0z"></path>
              </svg>
            </div>
            <span class="gsi-material-button-text">Continue with Google</span>
          </button>

          <div class="or-separator"><span>or</span></div>

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
    this.googleBtn = document.getElementById('login-google');

    document
      .getElementById('login-close')
      .addEventListener('click', () => this.close());
    this.toggleLink.addEventListener('click', () => this.toggleMode());
    this.submitBtn.addEventListener('click', () => this.submit());
    this.googleBtn.addEventListener('click', () => auth.loginWithGoogle());
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
        response = await auth.login(email, password);
      } else {
        response = await auth.signup(email, password);
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