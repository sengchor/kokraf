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
    updateURL(page);
  });
});

// Helpers
function setActive(activeItem) {
  categories.forEach(item => item.classList.remove('active'));
  activeItem.classList.add('active');
}

async function loadPage(page) {
  try {
    const response = await fetch(`./${page}.html`);
    if (!response.ok) throw new Error('Page not found');

    const html = await response.text();
    content.innerHTML = html;
  } catch (err) {
    content.innerHTML = `
      <h1>Page not found</h1>
      <p>The requested manual page could not be loaded.</p>
    `;
    console.error(err);
  }
}

function updateURL(page) {
  history.pushState({ page }, '', `/manual/${page}`);
}

// Handle direct URL access
function loadFromURL() {
  const parts = window.location.pathname.split('/');
  let page = parts[parts.length - 1];

  const item = categories.find(li => li.dataset.link === page);
  if (item) {
    setActive(item);
    loadPage(page);
  }
}

window.addEventListener('popstate', loadFromURL);
loadFromURL();
