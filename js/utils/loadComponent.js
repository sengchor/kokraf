export async function loadComponent(selector, url) {
  const container = document.querySelector(selector);
  if (!container) {
    console.warn(`No container found for selector: ${selector}`);
    return;
  }

  try {
    const response = await fetch(url);
    const html = await response.text();
    container.innerHTML = html;
  } catch (error) {
    console.error(`Failed to load component from ${url}`, error);
  }
}