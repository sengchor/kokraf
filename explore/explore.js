import { getThumbnailUrl, getPublicProjectsCursor, getPublicProjectsCursorSearch, likeProject, unlikeProject, hasUserLikedProject } from '/supabase/services/ProjectService.js';
import { profile } from '/supabase/services/ProfileService.js';
import { ViewerPanel } from '/js/panels/ViewerPanel.js';

const input = document.getElementById("project-search");
const grid = document.getElementById("projects-grid");

let mode = "all"; // "all" | "search"

const PAGE_SIZE = 12;
let cursor = null;
let isLoading  = false;
let hasMore = true;
let currentUser = null;

let timeout;
let currentQuery = "";

input.addEventListener("input", (e) => {
  clearTimeout(timeout);

  timeout = setTimeout(async () => {
    currentQuery = e.target.value.trim();
    mode = currentQuery ? "search" : "all";

    const url = new URL(window.location);
    if (currentQuery) {
      url.searchParams.set('q', currentQuery);
    } else {
      url.searchParams.delete('q');
    }
    history.replaceState(null, '', url);

    cursor = null;
    hasMore = true;
    isLoading = false;
    grid.innerHTML = '';

    await loadPage();

    const sentinel = document.getElementById('scroll-sentinel');
    if (sentinel) {
      sentinelObserver.unobserve(sentinel);
      sentinelObserver.observe(sentinel);
    }
  }, 300);
});

const thumbnailObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;

    const thumb = entry.target;
    const project = thumb._project;
    createThumbnail(project, thumb);
    thumbnailObserver.unobserve(thumb);
  }
}, { rootMargin: '100px' });

const sentinelObserver = new IntersectionObserver(async ([entry]) => {
  if (entry.isIntersecting && !isLoading && hasMore) {
    await loadPage();
  }
}, { rootMargin: '200px' });

export async function initExplore(user) {
  currentUser = user;

  resetState();

  const params = new URLSearchParams(window.location.search);
  const q = params.get('q') || '';

  if (q) {
    input.value = q;
    input.focus();
    currentQuery = q;
    mode = 'search';
  }

  renderSkeletonCards(grid);
  await loadPage(grid);

  if (!document.getElementById('scroll-sentinel')) {
    const sentinel = document.createElement('div');
    sentinel.id = 'scroll-sentinel';
    grid.parentElement.appendChild(sentinel);
    sentinelObserver.observe(sentinel);
  }
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

async function loadPage(gridOverride) {
  const grid = gridOverride ?? document.getElementById('projects-grid');
  isLoading = true;

  try {
    let projects;
    if (mode === "search") {
      projects = await getPublicProjectsCursorSearch(PAGE_SIZE, cursor, currentQuery);
    } else {
      projects = await getPublicProjectsCursor(PAGE_SIZE, cursor);
    }

    // Resolve profiles only for new batch
    const userIds    = [...new Set(projects.map(p => p.user_id))];
    const profileMap = userIds.length
      ? await profile.loadPublicProfiles(userIds)
      : {};

    const enriched = projects.map(p => ({
      ...p,
      user_profiles: profileMap[p.user_id] || null,
    }));

    // First page: replace skeletons. Subsequent pages: append.
    if (!cursor) {
      grid.innerHTML = '';
    }

    if (enriched.length === 0 && !cursor) {
      grid.innerHTML = `<p style="color:#888;font-size:16px;">No public projects yet.</p>`;
      hasMore = false;
    } else {
      appendProjects(grid, enriched);
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

function appendProjects(grid, projects) {
  if (!grid) return;

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

    // Like button
    const likeBtn = document.createElement('button');
    likeBtn.className = 'like-btn';
    likeBtn.setAttribute('aria-label', 'Like project');
    likeBtn.innerHTML = `
      <svg class="heart-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 21C12 21 3 14.5 3 8.5C3 5.42 5.42 3 8.5 3C10.24 3 11.91 3.81 13 5.08C14.09 3.81 15.76 3 17.5 3C20.58 3 23 5.42 23 8.5C23 14.5 12 21 12 21Z"
          stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/>
      </svg>
      <span class="like-count">${project.likes_count ?? 0}</span>
    `;

    if (currentUser) {
      hasUserLikedProject(project.id, currentUser.id)
        .then((isLiked) => {
          if (isLiked) likeBtn.classList.add('liked');
        });

      likeBtn.addEventListener('click',
        createLikeHandler({ likeBtn, projectId: project.id, userId: currentUser.id })
      );
    }

    wrapper.appendChild(avatar);
    wrapper.appendChild(meta);
    wrapper.appendChild(likeBtn);
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

function resetState() {
  cursor = null;
  isLoading = false;
  hasMore = true;
}

function createLikeHandler({ likeBtn, projectId, userId }) {
  return async function handleLikeClick(e) {
    e.stopPropagation();

    const liked = likeBtn.classList.toggle('liked');
    const countEl = likeBtn.querySelector('.like-count');
    const delta = liked ? 1 : -1;

    countEl.textContent = parseInt(countEl.textContent, 10) + delta;

    try {
      if (liked) {
        await likeProject(projectId, userId);
      } else {
        await unlikeProject(projectId, userId);
      }
    } catch (err) {
      // rollback
      likeBtn.classList.toggle('liked');
      countEl.textContent = parseInt(countEl.textContent, 10) - delta;
      console.error('Like failed:', err);
    }
  };
}