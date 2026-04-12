import { profile } from '/supabase/services/ProfileService.js';
import { EditProfilePanel } from './EditProfilePanel.js';
import { createEmptyCloudProject } from '/supabase/services/ProjectService.js';
import { initProjects } from './projects.js';

let editPanel;

export async function initProfile(user) {
  const profileInfo = document.getElementById("profile-info");
  const editProfileBtn = document.getElementById('edit-profile-btn');
  const newProjectBtn = document.getElementById('new-project-btn');
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

  newProjectBtn.addEventListener('click', async () => {
    await createEmptyCloudProject();
    await initProjects(user);
  });
}

export function renderProfile(data) {
  const nameEl = document.querySelector('.profile-name');
  const usernameEl = document.querySelector('.profile-username');
  const avatarEl = document.querySelector('.profile-avatar');
  const aboutEl = document.querySelector('.profile-about');
  const bannerEl = document.querySelector('.profile-banner');

  nameEl.classList.remove('skeleton', 'skeleton-long');
  usernameEl.classList.remove('skeleton', 'skeleton-short');

  nameEl.textContent = data.displayName;
  const username =
    data.username || profile.extractNameFromEmail(data.email);
  usernameEl.textContent = `@${username}`;

  if (data.avatarUrl) {
    avatarEl.src = data.avatarUrl;
  }

  if (data.bannerUrl) {
    bannerEl.style.backgroundImage = `url('${data.bannerUrl}')`;
    bannerEl.style.backgroundSize = 'cover';
    bannerEl.style.backgroundPosition = 'center';
  }

  if (data.about && data.about.trim() !== "") {
    aboutEl.textContent = data.about;
    aboutEl.classList.add("filled");
  } else {
    aboutEl.textContent = "Write a little more about yourself";
    aboutEl.classList.remove("filled");
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