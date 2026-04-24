import { auth } from '/supabase/services/AuthService.js';
import { initExplore } from './explore.js';
import { LoginPanel } from '/js/panels/LoginPanel.js';
import { AccountPanel } from '/js/panels/AccountPanel.js';
import { createEmptyCloudProject } from '/supabase/services/ProjectService.js';
import { consumeCredits, getCreditsErrorMessage } from '/supabase/services/CreditsService.js';

document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
  const accountBtn = document.getElementById('account-btn');
  const newProjectBtn = document.getElementById('new-project-btn');

  const user = await auth.waitForUser();

  if (!user) {
    accountBtn.textContent = 'Log in';
    accountBtn.addEventListener('click', () => createLoginPanel());
  } else {
    accountBtn.textContent = 'Account';
    accountBtn.addEventListener('click', () => createAccountPanel());
  }

  newProjectBtn.addEventListener('click', async () => {
    if (!user) {
      await createLoginPanel();
      return;
    }

    const { allowed, reason } = await consumeCredits('cloud-save');
    if (!allowed) {
      alert(getCreditsErrorMessage(reason));
      return;
    }
    const project = await createEmptyCloudProject();
    window.location.href = `/?projectId=${project.id}`;
  });

  await initExplore(user);
}

async function createLoginPanel() {
  const panel = new LoginPanel({
    closeable: false,
    onSuccess: async (loggedInUser) => {
      await initExplore(user);
    },
  });
  panel.open();
}

async function createAccountPanel() {
  const panel = new AccountPanel();
  panel.open();
}