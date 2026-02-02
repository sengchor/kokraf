export default class UIComponentsLoader {
  constructor() {}

  async loadComponent(selector, url) {
    const container = document.querySelector(selector);
    if (!container) {
      console.warn(`No container found for selector: ${selector}`);
      return null;
    }

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      container.innerHTML = html;

      return container;
    } catch (error) {
      console.error(`Failed to load component from ${url}`, error);
      throw error;
    }
  }
}
