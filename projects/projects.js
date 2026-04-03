import { auth } from '/supabase/AuthService.js';
import { getUserProjects, deleteProject } from '/supabase/storage/ProjectService.js';

// Run on page load
document.addEventListener('DOMContentLoaded', initProjectsPage);

document.addEventListener('click', () => {
  document.querySelectorAll('.project-menu-panel').forEach(p => p.remove());
});

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
      <div class="project-info-wrapper">
        <div class="project-meta">
          <div class="skeleton skeleton-name"></div>
          <div class="skeleton skeleton-date"></div>
        </div>
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

  if (projects.length === 0) {
    grid.innerHTML = `<p style="color: #888; font-size: 14px;">No projects yet. Create one to get started.</p>`;
    return;
  }

  projects.forEach(project => {
    const card = document.createElement('div');
    card.className = 'project-card';

    // Thumbnail placeholder
    const thumb = document.createElement('div');
    thumb.className = 'thumbnail';

    // Info wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'project-info-wrapper';

    // Left: name + date
    const meta = document.createElement('div');
    meta.className = 'project-meta';

    const name = document.createElement('div');
    name.className = 'project-name';
    name.textContent = project.name || 'Untitled Project';

    const date = document.createElement('div');
    date.className = 'project-date';
    date.textContent = formatEditedDate(project.updated_at || project.created_at);

    meta.appendChild(name);
    meta.appendChild(date);

    const menuBtn = createMenuBtn(project, card);

    wrapper.appendChild(meta);
    wrapper.appendChild(menuBtn);
    card.appendChild(thumb);
    card.appendChild(wrapper);

    card.addEventListener('click', async () => {
      window.location.href = `/?projectId=${project.id}`;
    });

    grid.appendChild(card);
  });
  
  function createMenuBtn(project, card) {
    const menuBtn = document.createElement('button');
    menuBtn.className = 'project-menu-btn';
    menuBtn.title = 'More options';
    menuBtn.textContent = '⋮';

    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();

      document.querySelectorAll('.project-menu-panel').forEach(p => p.remove());

      const panel = document.createElement('div');
      panel.className = 'project-menu-panel';
      attachPanelDismiss(panel);

      const rect = menuBtn.getBoundingClientRect();

      panel.style.top = `${rect.bottom + 4}px`;
      panel.style.left = `${rect.right - 150}px`;

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'menu-delete';
      deleteBtn.innerHTML = `Delete`;

      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        panel.remove();
        await handleDeleteProject(project, card);
        console.log('delete');
      });

      panel.appendChild(deleteBtn);
      document.body.appendChild(panel);
    });

    return menuBtn;
  }

  function attachPanelDismiss(panel, threshold = 100) {
    const onMouseMove = (e) => {
      const rect = panel.getBoundingClientRect();
      const dx = Math.max(rect.left - e.clientX, 0, e.clientX - rect.right);
      const dy = Math.max(rect.top - e.clientY, 0, e.clientY - rect.bottom);
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist > threshold) {
        panel.remove();
        document.removeEventListener('mousemove', onMouseMove);
      }
    };

    document.addEventListener('mousemove', onMouseMove);

    panel.addEventListener('remove', () => {
      document.removeEventListener('mousemove', onMouseMove);
    }, { once: true });
  }

  async function handleDeleteProject(project, card) {
    card.style.opacity = '0.3';
    card.style.pointerEvents = 'none';

    try {
      await deleteProject(project.id);
      card.remove();
    } catch (err) {
      console.error('Failed to delete project:', err);
      card.style.opacity = '';
      card.style.pointerEvents = '';
    }
  }
}