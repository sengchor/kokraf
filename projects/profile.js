import { profile } from '/supabase/services/ProfileService.js';
import { EditProfilePanel } from './EditProfilePanel.js';

let editPanel;

export async function initProfile(user) {
  const profileInfo = document.getElementById("profile-info");
  const editProfileBtn = document.getElementById('edit-profile-btn');
  renderProfileSkeleton(profileInfo);

  if (!user) return;

  const data = await profile.loadProfile();
  if (!data) return;

  renderProfile(data);

  editProfileBtn.addEventListener('click', () => {
    if (!editPanel) {
      editPanel = new EditProfilePanel();
    }

    editPanel.open();
  });
}

function renderProfile(data) {
  const nameEl = document.querySelector('.profile-name');
  const usernameEl = document.querySelector('.profile-username');
  const avatarEl = document.querySelector('.profile-avatar');

  nameEl.classList.remove('skeleton', 'skeleton-long');
  usernameEl.classList.remove('skeleton', 'skeleton-short');

  nameEl.textContent = data.displayName;
  let handle = data.email.split('@')[0].replace(/[+.]/g, '');
  usernameEl.textContent = `@${handle}`;

  if (data.avatarUrl) {
    avatarEl.src = data.avatarUrl;
  }
}

function renderProfileSkeleton(profileInfo) {
  profileInfo.innerHTML = `
    <div id="profile-info" class="profile-info">
      <div class="profile-name skeleton skeleton-long"></div>
      <div class="profile-username skeleton skeleton-short"></div>
    </div>
  `;
}