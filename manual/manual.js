const searchInput = document.getElementById('search-input');
const categoryList = document.getElementById('category-list');
const categories = Array.from(categoryList.querySelectorAll('li'));
const content = document.getElementById('content');

// Search filtering
searchInput.addEventListener('input', () => {
  const query = searchInput.value.toLowerCase();
  categories.forEach(item => {
    const text = item.textContent.toLowerCase();
    item.style.display = text.includes(query) ? '' : 'none';
  });
});

// Category loading
categories.forEach(item => {
  item.addEventListener('click', async () => {
    const page = item.dataset.link;
    if (!page) return;

    setActive(item);
    await loadPage(page);
    updateHash(page);
  });
});

// Helpers
function setActive(activeItem) {
  categories.forEach(item => item.classList.remove('active'));
  activeItem.classList.add('active');
}

// Load content dynamically
async function loadPage(page) {
  try {
    if (page === 'manual') {
      content.innerHTML = `
        <h1>Kokraf User Manual</h1>
        <p>Welcome to the <strong>Kokraf User Manual</strong> — a collaborative 3D modeling app.</p>
      `;
      return;
    }

    const response = await fetch(`./${page}.html`);
    if (!response.ok) throw new Error('Page not found');
    content.innerHTML = await response.text();
  } catch (err) {
    content.innerHTML = `
      <h1>Page not found</h1>
      <p>The requested manual page could not be loaded.</p>
    `;
    console.error(err);
  }
}

// Update hash in URL
function updateHash(page) {
  window.location.hash = page;
}

// Load page based on hash
function loadFromHash() {
  let page = window.location.hash.replace('#', '');
  if (!page) page = 'manual';

  const item = categories.find(li => li.dataset.link === page);
  if (item) {
    setActive(item);
    loadPage(page);
  }
}

// Listen to hash changes
window.addEventListener('hashchange', loadFromHash);

// Initial load
loadFromHash();
