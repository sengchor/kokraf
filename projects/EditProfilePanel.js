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

          <!-- Profile Picture -->
          <div class="editprofile-section">
            <div class="editprofile-label">Profile Picture</div>
            <div class="editprofile-avatar-row">
              <img id="editprofile-avatar-preview" class="editprofile-avatar-preview" src="" alt="Avatar preview" />
              <div class="editprofile-avatar-upload">
                <button type="button" id="editprofile-avatar-btn" class="editprofile-avatar-btn">
                  CHOOSE NEW PICTURE
                </button>

                <input id="editprofile-input" type="file" accept="image/png, image/jpeg" style="display:none" />

                <div class="editprofile-avatar-hint">
                  PNG or JPG • 256×256 pixels • Max 2MB
                </div>
              </div>
            </div>
          </div>

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
    this.avatarPreview = document.getElementById('editprofile-avatar-preview');
    this.avatarInput = document.getElementById('editprofile-input');
    this.editAvatarBtn = document.getElementById('editprofile-avatar-btn');
    this.errorEl = document.getElementById('editprofile-error');

    this.saveBtn = document.getElementById('editprofile-save');
    this.cancelBtn = document.getElementById('editprofile-cancel');
    this.closeBtn = document.getElementById('editprofile-close');

    this.avatarInput.addEventListener('change', () => {
      const file = this.avatarInput.files[0];
      if (!file) return;

      const MAX_SIZE = 2 * 1024 * 1024;

      // File size check
      if (file.size > MAX_SIZE) {
        this.showError('Image must be less than 2MB');
        this.avatarInput.value = '';
        return;
      }

      // Check image dimensions
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);

      img.onload = () => {
        const { width, height } = img;

        if (width !== 256 || height !== 256) {
          this.showError('Image must be exactly 256x256 pixels');
          this.avatarInput.value = '';
          URL.revokeObjectURL(objectUrl);
          return;
        }

        this.clearError();

        this.avatarPreview.src = objectUrl;
      };

      img.onerror = () => {
        this.showError('Invalid image file');
        this.avatarInput.value = '';
        URL.revokeObjectURL(objectUrl);
      };

      img.src = objectUrl;
    });

    this.editAvatarBtn.addEventListener('click', () => this.avatarInput.click());
    this.cancelBtn.addEventListener('click', () => this.close());
    this.saveBtn.addEventListener('click', () => this.handleSave());
    this.closeBtn.addEventListener('click', () => this.close());
  }

  async open() {
    const data = await profile.loadProfile();

    const username =
      data.username || profile.extractNameFromEmail(data.email);

    this.nameInput.value = data.displayName || '';
    this.usernameInput.value = username || '';
    this.avatarPreview.src = data.avatarUrl || '';
    this.avatarPreview.style.display = data.avatarUrl ? 'block' : 'none';
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

      const avatarUrl = avatarFile ? await profile.uploadAvatar(avatarFile) : undefined;

      const updated = await profile.saveProfile({ displayName, username, about, avatarUrl });
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