import { auth } from '/supabase/services/AuthService.js';
import { initProjects } from './projects.js';
import { initProfile } from './profile.js';

document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
  const userPromise = auth.waitForUser();

  const user = await userPromise;
  if (!user) return;

  await Promise.all([
    initProfile(user),
    initProjects(user)
  ]);
}