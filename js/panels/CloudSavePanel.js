import { saveProject } from '/supabase/services/ProjectService.js';
import { auth } from '/supabase/services/AuthService.js';
import { consumeCredits, getCreditsErrorMessage } from '/supabase/services/CreditsService.js';

export class CloudSavePanel {
  constructor({ rootSelector = 'body', editor} = {}) {
    this.root = document.querySelector(rootSelector);
    this.editor = editor;

    this.load();
  }

  load() {
    const template = `
      <div id="cloudsave-overlay" class="cloudsave-overlay hidden">
        <div class="cloudsave-panel">
          <button id="cloudsave-close" class="cloudsave-close" aria-label="Close">✕</button>

          <h3 class="cloudsave-title">Save Project</h3>

          <!-- Project name -->
          <div class="cloudsave-section">
            <div class="cloudsave-label">Project Name</div>
            <input 
              id="cloudsave-name" 
              class="cloudsave-input" 
              type="text" 
              placeholder="Untitled Project"
            />
          </div>

          <div id="cloudsave-error" class="error"></div>

          <div class="cloudsave-actions">
            <button id="cloudsave-save" class="primary">Save</button>
            <button id="cloudsave-cancel">Cancel</button>
          </div>
        </div>
      </div>
    `;

    this.root.insertAdjacentHTML('beforeend', template);

    this.overlay = document.getElementById('cloudsave-overlay');
    this.nameInput = document.getElementById('cloudsave-name');
    this.nameInput.maxLength = 40;
    this.errorEl = document.getElementById('cloudsave-error');

    this.saveBtn = document.getElementById('cloudsave-save');
    this.cancelBtn = document.getElementById('cloudsave-cancel');

    document
      .getElementById('cloudsave-close')
      .addEventListener('click', () => this.close());

    this.cancelBtn.addEventListener('click', () => this.close());

    this.saveBtn.addEventListener('click', () => this.handleSave());

    this.nameInput.addEventListener('input', () => {
      this.clearError();
    });
  }

  async open() {
    const user = await auth.waitForUser();

    if (!user) return;

    this.nameInput.value = this.editor.currentProjectName || 'Untitled Project';

    this.overlay.classList.remove('hidden');
    this.nameInput.focus();
    this.clearError();
  }

  close() {
    this.overlay.classList.add('hidden');
  }

  async handleSave() {
    const name = this.nameInput.value.trim();

    if (!name) {
      this.showError('Please enter a project name.');
      return;
    }

    try {
      this.saveBtn.disabled = true;
      this.saveBtn.textContent = 'Saving...';

      const canSave = await this.canCloudSave();
      if (!canSave) return;

      // Save into editor state
      this.editor.signals.saveStatusChanged.dispatch('saving');
      this.editor.currentProjectName = name;

      await saveProject(this.editor, { name: name });

      this.editor.signals.saveStatusChanged.dispatch('saved');
      this.close();
    } catch (err) {
      console.error('Save failed:', err);
      this.editor.signals.saveStatusChanged.dispatch('error');
    } finally {
      this.saveBtn.disabled = false;
      this.saveBtn.textContent = 'Save';
    }
  }

  showError(message) {
    this.errorEl.textContent = message;
    this.errorEl.classList.add('visible');
  }

  clearError() {
    this.errorEl.textContent = '';
    this.errorEl.classList.remove('visible');
  }

  async canCloudSave() {
    const { allowed, reason } = await consumeCredits('cloud-save');
    if (!allowed) {
      alert(getCreditsErrorMessage(reason));
    }
    return allowed;
  }
}