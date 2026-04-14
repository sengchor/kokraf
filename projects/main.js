import { auth } from '/supabase/services/AuthService.js';
import { initProjects } from './projects.js';
import { initProfile } from './profile.js';
import { LoginPanel } from '/js/panels/LoginPanel.js';
import { AccountPanel } from '/js/panels/AccountPanel.js';
import { createEmptyCloudProject } from '/supabase/services/ProjectService.js';

document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
  const accountBtn = document.getElementById('account-btn');
  const newProjectBtn = document.getElementById('new-project-btn');

  const accountPanel = new AccountPanel();

  const user = await auth.waitForUser();

  if (!user) {
    const panel = new LoginPanel({
      closeable: false,
      onSuccess: async (loggedInUser) => {
        await Promise.all([
          initProfile(loggedInUser),
          initProjects(loggedInUser),
        ]);
      },
    });
    panel.open();
    return;
  }

  accountBtn.addEventListener('click', () => accountPanel.open());
  newProjectBtn.addEventListener('click', async () => {
    await createEmptyCloudProject();
    await initProjects(user);
  });

  await Promise.all([
    initProfile(user),
    initProjects(user)
  ]);
}