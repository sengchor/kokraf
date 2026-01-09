import Editor from './Editor.js';

async function main() {
  try {
    const editor = new Editor();
    await editor.init();
  } catch (error) {
    console.error('Failed to initialize editor:', error);
    indexedDB.deleteDatabase('kokraf-storage');
  }
}

main();