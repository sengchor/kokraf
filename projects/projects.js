import { auth } from '/supabase/AuthService.js';
import { getUserProjects, loadProject } from '/supabase/storage/ProjectService.js';

// Run on page load
document.addEventListener('DOMContentLoaded', initProjectsPage);

// Main: fetch and render
async function initProjectsPage() {
  const grid = document.getElementById("projects-grid");
  renderSkeletonCards(grid);

  const user = await auth.waitForUser();
  if (!user) return;

  const projects = await getUserProjects();
  renderProjects(grid, projects);
}

function renderSkeletonCards(grid, count = 6) {
  grid.innerHTML = Array.from({ length: count }, () => `
    <div class="project-card">
      <div class="thumbnail"></div>
      <div class="project-info">
        <div class="skeleton skeleton-name"></div>
        <div class="skeleton skeleton-date"></div>
      </div>
    </div>
  `).join("");
}

// Format date to "Edited X days ago"
function formatEditedDate(dateString) {
  if (!dateString) return '';
  const editedDate = new Date(dateString);
  const now = new Date();
  const diffMs = now - editedDate;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Edited today';
  if (diffDays === 1) return 'Edited 1 day ago';
  return `Edited ${diffDays} days ago`;
}

// Render project cards
function renderProjects(grid, projects) {
  if (!grid) return;

  grid.innerHTML = '';

  projects.forEach(project => {
    const card = document.createElement('div');
    card.className = 'project-card';

    // Thumbnail placeholder
    const thumb = document.createElement('div');
    thumb.className = 'thumbnail';

    // Project info
    const info = document.createElement('div');
    info.className = 'project-info';

    const name = document.createElement('div');
    name.className = 'project-name';
    name.textContent = project.name || 'Untitled Project';

    const date = document.createElement('div');
    date.className = 'project-date';
    date.textContent = formatEditedDate(project.created_at);

    info.appendChild(name);
    info.appendChild(date);
    card.appendChild(thumb);
    card.appendChild(info);

    card.addEventListener('click', async () => {
      window.location.href = `/?projectId=${project.id}`;
    });

    grid.appendChild(card);
  });
}