import { getUserProjectsCursor, deleteProject, getThumbnailUrl, renameProject, setProjectVisibility } from '/supabase/services/ProjectService.js';
import { ViewerPanel } from '/js/panels/ViewerPanel.js';

document.addEventListener('click', () => {
  document.querySelectorAll('.project-menu-panel').forEach(p => p.remove());
});

const PAGE_SIZE = 12;
let cursor = null;
let isLoading = false;
let hasMore = true;
let currentUser = null;

const thumbnailObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;

    const thumb = entry.target;
    const project = thumb._project;

    createThumbnail(currentUser, project, thumb);

    thumbnailObserver.unobserve(thumb);
  }
}, { rootMargin: '100px' });

const sentinelObserver = new IntersectionObserver(async ([entry]) => {
  if (entry.isIntersecting && !isLoading && hasMore) {
    await loadPage();
  }
}, { rootMargin: '200px' });

// Main: fetch and render
export async function initProjects(user) {
  currentUser = user;
  if (!user) return;

  resetState();

  const grid = document.getElementById("projects-grid");
  renderSkeletonCards(grid);
  await loadPage(grid);

  if (!document.getElementById('scroll-sentinel')) {
    const sentinel = document.createElement('div');
    sentinel.id = 'scroll-sentinel';
    grid.parentElement.appendChild(sentinel);
    sentinelObserver.observe(sentinel);
  }
}

function renderSkeletonCards(grid, count = 6) {
  grid.innerHTML = Array.from({ length: count }, () => `
    <div class="project-card">
      <div class="thumbnail"></div>
      <div class="project-info-wrapper">
        <div class="project-meta">
          <div class="skeleton skeleton-long"></div>
          <div class="skeleton skeleton-short"></div>
        </div>
      </div>
    </div>
  `).join("");
}

async function loadPage(gridOverride) {
  const grid = gridOverride ?? document.getElementById('projects-grid');
  isLoading = true;

  try {
    const projects = await getUserProjectsCursor(PAGE_SIZE, cursor);

    if (!cursor) {
      grid.innerHTML = '';
    }

    if (projects.length === 0 && !cursor) {
      grid.innerHTML = `<p style="color:#888;font-size:16px;">No public projects yet.</p>`;
      hasMore = false;
    } else {
      appendProjects(grid, projects);
    }

    // Advance cursor to last item
    if (projects.length > 0) {
      const last = projects.at(-1);
      cursor = { updated_at: last.updated_at, id: last.id };
    }

    const sentinel = document.getElementById('scroll-sentinel');

    if (projects.length < PAGE_SIZE) {
      hasMore = false;
      if (sentinel) sentinelObserver.unobserve(sentinel);
    }
  } finally {
    isLoading = false;

    if (hasMore) {
      const sentinel = document.getElementById('scroll-sentinel');
      if (sentinel) {
        sentinelObserver.unobserve(sentinel);
        sentinelObserver.observe(sentinel);
      }
    }
  }
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
async function appendProjects(grid, projects) {
  if (!grid) return;

  for (const project of projects) {
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

    // Visibility Icon
    const visibilityIcon = document.createElement('div');
    visibilityIcon.className = 'project-visibility-icon';
    visibilityIcon.dataset.tooltip = 'Public';
    visibilityIcon.innerHTML = `<img src="/assets/icons/globe.svg" alt="Public" />`;
    if (!project.is_public) visibilityIcon.classList.add('hidden');

    const menuBtn = createMenuBtn(project, card);

    thumb.innerHTML = fallbackSVG();
    thumb.appendChild(visibilityIcon);
    thumb._project = project;
    thumbnailObserver.observe(thumb);

    wrapper.appendChild(meta);
    wrapper.appendChild(menuBtn);
    card.appendChild(thumb);
    card.appendChild(wrapper);

    card.addEventListener('click', async () => {
      const viewerPanel = new ViewerPanel();
      window.location.href = `/?projectId=${project.id}`;
    });

    grid.appendChild(card);
  };
}
  
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

    const renameBtn = document.createElement('button');
    renameBtn.className = 'menu-rename';
    renameBtn.innerHTML = `Rename`;

    renameBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      panel.remove();
      const currentNameEl = card.querySelector('.project-name');
      startRename(project, card, currentNameEl);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'menu-delete';
    deleteBtn.innerHTML = `Delete`;

    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      panel.remove();
      await handleDeleteProject(project, card);
    });

    const visibilityBtn = document.createElement('button');
    visibilityBtn.className = 'menu-visibility';
    visibilityBtn.textContent = project.is_public ? 'Make Private' : 'Make Public';

    visibilityBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      panel.remove();
      await handleToggleVisibility(project, card);
    });

    panel.appendChild(renameBtn);
    panel.appendChild(visibilityBtn);
    panel.appendChild(deleteBtn);
    menuBtn.parentElement.appendChild(panel);

    const panelRect = panel.getBoundingClientRect();
    if (panelRect.bottom > window.innerHeight) {
      panel.style.top = 'auto';
      panel.style.bottom = '100%';
    }
  });

  return menuBtn;
}

async function createThumbnail(user, project, thumb) {
  const url = await getThumbnailUrl(user.id, project.id);
  if (!url) return;

  const img = document.createElement('img');
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.2s ease;';
  img.src = url;
  const icon = thumb.querySelector('.project-visibility-icon');

  img.onload = () => {
    thumb.innerHTML = '';
    thumb.appendChild(img);
    if (icon) thumb.appendChild(icon); 

    requestAnimationFrame(() => {
      img.style.opacity = '1';
    });
  };
}

function fallbackSVG() {
  return `<svg width="32" height="32" fill="none" stroke="#ccc" stroke-width="1.5" viewBox="0 0 24 24">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <path d="m3 16 5-5 4 4 3-3 6 6"/>
    <circle cx="8.5" cy="8.5" r="1.5"/>
  </svg>`;
}

function attachPanelDismiss(panel, threshold = 100) {
  const onMouseMove = (e) => {
    const rect = panel.getBoundingClientRect();
    const dx = Math.max(rect.left - e.clientX, 0, e.clientX - rect.right);
    const dy = Math.max(rect.top - e.clientY, 0, e.clientY - rect.bottom);
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist > threshold) {
      cleanup();
    }
  };

  function cleanup() {
    panel.remove();
    document.removeEventListener('mousemove', onMouseMove);
  }

  document.addEventListener('mousemove', onMouseMove);
}

async function handleDeleteProject(project, card) {
  card.style.opacity = '0.3';
  card.style.pointerEvents = 'none';

  try {
    await deleteProject(project.id);
    card.remove();

    const grid = document.getElementById('projects-grid');
    if (grid && grid.children.length === 0) {
      grid.innerHTML = `<p style="color: #888; font-size: 16px;">No projects yet. Create one to get started.</p>`;
    }
  } catch (err) {
    console.error('Failed to delete project:', err);
    card.style.opacity = '';
    card.style.pointerEvents = '';
  }
}

async function handleToggleVisibility(project, card) {
  const newValue = !project.is_public;

  try {
    await setProjectVisibility(project.id, newValue);
    project.is_public = newValue;

    const icon = card.querySelector('.project-visibility-icon');
    if (icon) icon.classList.toggle('hidden', !newValue);
  } catch (err) {
    console.error('Failed to update visibility:', err);
  }
}

function startRename(project, card, nameEl) {
  const original = project.name || 'Untitled Project';

  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 40;
  input.value = original;
  input.className = 'project-name project-name-input';

  nameEl.replaceWith(input);
  input.focus();
  input.select();

  card.style.pointerEvents = 'none';
  input.style.pointerEvents = 'auto';

  let committed = false;

  async function commit() {
    if (committed) return;
    committed = true;

    const newName = input.value.trim() || original;

    const restored = document.createElement('div');
    restored.className = 'project-name';
    restored.textContent = newName;
    input.replaceWith(restored);
    card.style.pointerEvents = '';
    nameEl = restored;

    if (newName !== original) {
      project.name = newName;
      try {
        await renameProject(project.id, newName);
      } catch (err) {
        console.error('Rename failed:', err);
        restored.textContent = original;
        project.name = original;
      }
    }
  }

  function cancel() {
    if (committed) return;
    committed = true;

    const restored = document.createElement('div');
    restored.className = 'project-name';
    restored.textContent = original;
    input.replaceWith(restored);
    card.style.pointerEvents = '';
    nameEl = restored;
  }

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });

  input.addEventListener('blur', commit);
  input.addEventListener('click', (e) => e.stopPropagation());
}

function resetState() {
  cursor = null;
  isLoading = false;
  hasMore = true;
}