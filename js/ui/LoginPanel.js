export class LoginPanel {
  constructor(editor) {
    this.editor = editor;
    this.signals = editor.signals;
    this.uiLoader = editor.uiLoader;
    this.mode = 'login';

    this.load();
    this.setupListeners();
  }

  load() {
    this.uiLoader.loadComponent('#overlay-root', 'components/login-panel.html', () => {
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
    });
  }

  setupListeners() {
    this.signals.showLogin.add(() => this.open());
  }

  open() {
    this.overlay.classList.remove('hidden');
  }

  close() {
    this.overlay.classList.add('hidden');
    this.error.textContent = '';
  }

  toggleMode() {
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

  submit() {
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

    // TODO: call Supabase login/signup here
    console.log(this.mode, email, password);
  }
}