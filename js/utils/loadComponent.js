export async function loadComponent(selector, url, onLoaded) {
  const container = document.querySelector(selector);
  if (!container) {
    console.warn(`No container found for selector: ${selector}`);
    return;
  }

  try {
    const response = await fetch(url);
    const html = await response.text();
    container.innerHTML = html;

    // Callback after HTML is loaded
    if (typeof onLoaded === 'function') {
      onLoaded(container);
    }
  } catch (error) {
    console.error(`Failed to load component from ${url}`, error);
  }
}
