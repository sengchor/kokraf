import { auth } from '/supabase/services/AuthService.js';
import { initProjects } from './projects.js';
import { initProfile } from './profile.js';
import { LoginPanel } from '/js/panels/LoginPanel.js';

document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
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

  await Promise.all([
    initProfile(user),
    initProjects(user)
  ]);
}