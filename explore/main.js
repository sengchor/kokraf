import { auth } from '/supabase/services/AuthService.js';
import { LoginPanel } from '/js/panels/LoginPanel.js';
import { AccountPanel } from '/js/panels/AccountPanel.js';
import { createEmptyCloudProject } from '/supabase/services/ProjectService.js';
import { consumeCredits, getCreditsErrorMessage } from '/supabase/services/CreditsService.js';

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
        console.log('on success');
      },
    });
    panel.open();
    return;
  }

  accountBtn.addEventListener('click', () => accountPanel.open());
  newProjectBtn.addEventListener('click', async () => {
    const { allowed, reason } = await consumeCredits('cloud-save');
    if (!allowed) {
      alert(getCreditsErrorMessage(reason));
      return;
    }
    const project = await createEmptyCloudProject();
    window.location.href = `/?projectId=${project.id}`;
  });

  console.log('on success');
}