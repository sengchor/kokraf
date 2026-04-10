import { profile } from '/supabase/services/ProfileService.js';
import { renderProfile } from './profile.js';

export class EditProfilePanel {
  constructor({ rootSelector = 'body' } = {}) {
    this.root = document.querySelector(rootSelector);
    this.load();
  }

  load() {
    const template = `
      <div id="editprofile-overlay" class="editprofile-overlay hidden">
        <div class="editprofile-panel">
          <button id="editprofile-close" class="editprofile-close" aria-label="Close">✕</button>

          <h3 class="editprofile-title">Edit Profile</h3>

          <!-- Name -->
          <div class="editprofile-section">
            <div class="editprofile-label">Name</div>
            <input id="editprofile-name" class="editprofile-input" type="text" />
          </div>

          <!-- Username -->
          <div class="editprofile-section">
            <div class="editprofile-label">Username</div>
            <input id="editprofile-username" class="editprofile-input" type="text" />
          </div>

          <!-- About -->
          <div class="editprofile-section">
            <div class="editprofile-label">About</div>
            <textarea id="editprofile-about" class="editprofile-textarea"></textarea>
          </div>

          <!-- Profile Picture -->
          <div class="editprofile-section">
            <div class="editprofile-label">Profile Picture</div>
            <input id="editprofile-avatar" type="file" accept="image/*" />
          </div>

          <div id="editprofile-error" class="error"></div>

          <div class="editprofile-actions">
            <button id="editprofile-save" class="primary">Save</button>
            <button id="editprofile-cancel">Cancel</button>
          </div>
        </div>
      </div>
    `;

    this.root.insertAdjacentHTML('beforeend', template);

    this.overlay = document.getElementById('editprofile-overlay');
    this.nameInput = document.getElementById('editprofile-name');
    this.usernameInput = document.getElementById('editprofile-username');
    this.aboutInput = document.getElementById('editprofile-about');
    this.avatarInput = document.getElementById('editprofile-avatar');
    this.errorEl = document.getElementById('editprofile-error');

    this.saveBtn = document.getElementById('editprofile-save');
    this.cancelBtn = document.getElementById('editprofile-cancel');

    document.getElementById('editprofile-close')
      .addEventListener('click', () => this.close());

    this.cancelBtn.addEventListener('click', () => this.close());
    this.saveBtn.addEventListener('click', () => this.handleSave());
  }

  async open() {
    const data = await profile.loadProfile();

    const username =
      data.username || profile.extractNameFromEmail(data.email);

    this.nameInput.value = data.displayName || '';
    this.usernameInput.value = username || '';
    this.aboutInput.value = data.about || '';

    this.overlay.classList.remove('hidden');
    this.clearError();
  }

  close() {
    this.overlay.classList.add('hidden');
  }

  async handleSave() {
    const displayName = this.nameInput.value.trim();
    const username = this.usernameInput.value.trim();
    const about = this.aboutInput.value.trim();
    const avatarFile = this.avatarInput.files[0];

    if (!displayName || !username) {
      this.showError('Name and username are required.');
      return;
    }

    try {
      this.saveBtn.disabled = true;
      this.saveBtn.textContent = 'Saving...';

      const updated = await profile.saveProfile({ displayName, username, about, avatarFile });

      renderProfile(updated);

      this.close();
    } catch (err) {
      console.error(err);
      this.showError('Failed to update profile.');
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
}