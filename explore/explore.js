import { getThumbnailUrl, getPublicProjects } from '/supabase/services/ProjectService.js';
import { profile } from '/supabase/services/ProfileService.js';
import { ViewerPanel } from '/js/panels/ViewerPanel.js';

const thumbnailObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;

    const thumb = entry.target;
    const project = thumb._project;

    createThumbnail(project, thumb);

    thumbnailObserver.unobserve(thumb);
  }
}, {
  rootMargin: '100px'
});

export async function initExplore(user) {
  const grid = document.getElementById('projects-grid');
  renderSkeletonCards(grid);

  if (!user) return;

  const projects = await getPublicProjects(12);

  const userIds = [...new Set(projects.map(p => p.user_id))];
  const profileMap = await profile.loadPublicProfiles(userIds);

  const enriched = projects.map(p => ({
    ...p,
    user_profiles: profileMap[p.user_id] || null
  }));

  renderProjects(grid, enriched);
}

function renderSkeletonCards(grid, count = 12) {
  grid.innerHTML = Array.from({ length: count }, () => `
    <div class="project-card">
      <div class="thumbnail"></div>
      <div class="project-info-wrapper">
        <div class="skeleton skeleton-avatar"></div>
        <div class="project-meta">
          <div class="skeleton skeleton-long"></div>
          <div class="skeleton skeleton-short"></div>
        </div>
        <div class="skeleton skeleton-stats"></div>
      </div>
    </div>
  `).join('');
}

function renderProjects(grid, projects) {
  if (!grid) return;
  grid.innerHTML = '';

  if (projects.length === 0) {
    grid.innerHTML = `<p style="color: #888; font-size: 16px;">No public projects yet.</p>`;
    return;
  }

  for (const project of projects) {
    const card = document.createElement('div');
    card.className = 'project-card';

    const thumb = document.createElement('div');
    thumb.className = 'thumbnail';
    thumb.innerHTML = fallbackSVG();
    thumb._project = project;
    thumbnailObserver.observe(thumb);

    const wrapper = document.createElement('div');
    wrapper.className = 'project-info-wrapper';

    const avatar = document.createElement('img');
    avatar.className = 'explore-avatar';
    avatar.src = project.user_profiles?.avatar_url || '/assets/icons/default-avatar.svg';
    avatar.alt = '';
    
    const meta = document.createElement('div');
    meta.className = 'project-meta';

    const name = document.createElement('div');
    name.className = 'project-name';
    name.textContent = project.name || 'Untitled Project';

    const author = document.createElement('div');
    author.className = 'explore-author-name';
    author.textContent = 'by ' + project.user_profiles?.display_name || project.user_profiles?.username || 'Unknown';

    meta.appendChild(name);
    meta.appendChild(author);

    wrapper.appendChild(avatar);
    wrapper.appendChild(meta);
    card.appendChild(thumb);
    card.appendChild(wrapper);

    card.addEventListener('click', () => {
      const viewerPanel = new ViewerPanel();
      viewerPanel.open(project.id);
    });

    grid.appendChild(card);
  }
}

async function createThumbnail(project, thumb) {
  const url = await getThumbnailUrl(project.user_id, project.id);
  if (!url) return;

  const img = document.createElement('img');
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.2s ease;';
  img.src = url;

  img.onload = () => {
    thumb.innerHTML = '';
    thumb.appendChild(img);
    requestAnimationFrame(() => { img.style.opacity = '1'; });
  };
}

function fallbackSVG() {
  return `<svg width="32" height="32" fill="none" stroke="#ccc" stroke-width="1.5" viewBox="0 0 24 24">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <path d="m3 16 5-5 4 4 3-3 6 6"/>
    <circle cx="8.5" cy="8.5" r="1.5"/>
  </svg>`;
}