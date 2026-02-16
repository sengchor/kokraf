export class NameManager {
  constructor(editor) {
    this.editor = editor;
    this.sceneManager = editor.sceneManager;
  }

  _collectSceneNames(excludedObject = null) {
    const names = new Set();
    const scene = this.sceneManager.mainScene;

    scene.traverse(object => {
      if (object === excludedObject) return;
      if (object.name) names.add(object.name);
    });

    return names;
  }

  _generateFromNameSet(baseName, occupiedNames) {
    if (!baseName) return '';

    if (!occupiedNames.has(baseName)) {
      return baseName;
    }

    // Detect existing numeric suffixes
    const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`^${escapedBase}\\.(\\d{3})$`);

    const usedIndices = new Set();

    occupiedNames.forEach(name => {
      const match = name.match(regex);
      if (match) {
        usedIndices.add(parseInt(match[1], 10));
      }
    });

    let index = 1;
    while (usedIndices.has(index)) {
      index++;
    }

    const suffix = String(index).padStart(3, '0');
    return `${baseName}.${suffix}`;
  }

  generateUniqueName(baseName) {
    const names = this._collectSceneNames();
    return this._generateFromNameSet(baseName, names);
  }

  generateUniqueNameWithReserved(baseName, reservedNames) {
    const sceneNames = this._collectSceneNames();
    const allNames = new Set([...sceneNames, ...reservedNames]);
    return this._generateFromNameSet(baseName, allNames);
  }

  ensureUniqueObjectName(object, baseName = object.name) {
    const uniqueName = this.generateUniqueName(baseName);
    object.name = uniqueName;
    return uniqueName;
  }

  isValidName(name) {
    if (!name) return false;
    if (name.trim().length === 0) return false;

    return true;
  }

  generateRenameName(value, object) {
    const currentName = object.name;
    const name = value?.trim();

    if (!this.isValidName(name)) {
      return currentName;
    }

    const sceneNames = this._collectSceneNames(object);
    if (sceneNames.has(name)) {
      return currentName;
    }

    return name;
  }

  getBaseName(name) {
    if (!name) return '';
    return name.replace(/\.\d{3}$/, '');
  }
}