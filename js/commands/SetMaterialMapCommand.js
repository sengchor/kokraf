import * as THREE from 'three';

export class SetMaterialMapCommand {
  static type = 'SetMaterialMapCommand';

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D|null} object
   * @param {string} attributeName
   * @param {THREE.Texture|null} newTexture
   * @param {{ key: string, newValue: number|THREE.Color } | null} scalarReset
   */
  constructor(editor, object = null, attributeName = '', newTexture = null, scalarReset = null) {
    this.editor = editor;
    this.name = `Set Material Map: ${attributeName}`;

    this.attributeName = attributeName;
    this.objectUuid = object ? object.uuid : null;

    const material = this._getMaterial(object);
    
    this.oldTexture = material?.[attributeName] ?? null;
    this.newTexture = newTexture;

    this.scalarKey = scalarReset?.key ?? null;
    this.newScalarValue = scalarReset?.newValue ?? null;
    this.oldScalarValue = (this.scalarKey && material)
      ? this.captureScalar(material, this.scalarKey)
      : null;
  }
  
  _getMaterial(object) {
    if (!object) return null;
    
    const painter = this.editor.viewportControls?.texturePainter;
    if (painter?.isActive && painter.object === object && painter.originalMaterial) {
      return painter.originalMaterial;
    }
    
    return object.material;
  }

  captureScalar(material, key) {
    const value = material[key];
    return value instanceof THREE.Color ? value.clone() : value;
  }

  applyScalar(material, key, value) {
    if (value instanceof THREE.Color) {
      material[key].copy(value);
    } else {
      material[key] = value;
    }
  }

  execute() {
    const object = this.editor.objectByUuid(this.objectUuid);
    const material = this._getMaterial(object);
    
    if (!material) return;

    material[this.attributeName] = this.newTexture;
    
    if (this.scalarKey !== null) {
      this.applyScalar(material, this.scalarKey, this.newScalarValue);
    }

    material.needsUpdate = true;
    this.editor.signals.objectChanged.dispatch();
  }

  undo() {
    const object = this.editor.objectByUuid(this.objectUuid);
    const material = this._getMaterial(object);
    
    if (!material) return;

    material[this.attributeName] = this.oldTexture;
    
    if (this.scalarKey !== null && this.oldScalarValue !== null) {
      this.applyScalar(material, this.scalarKey, this.oldScalarValue);
    }

    material.needsUpdate = true;
    this.editor.signals.objectChanged.dispatch();
  }

  toJSON() {
    const extractTextureData = (texture) => {
      if (!texture) return null;
      return {
        uuid: texture.uuid,
        name: texture.name,
        colorSpace: texture.colorSpace,
        src: texture.image ? texture.image.src : null,
        attributeName: this.attributeName,
      };
    };

    return {
      type: SetMaterialMapCommand.type,
      objectUuid: this.objectUuid,
      attributeName: this.attributeName,
      oldTexture: extractTextureData(this.oldTexture),
      newTexture: extractTextureData(this.newTexture),
      scalarKey: this.scalarKey,
      oldScalarValue: this.oldScalarValue instanceof THREE.Color ? this.oldScalarValue.getHex() : this.oldScalarValue,
      newScalarValue: this.newScalarValue instanceof THREE.Color ? this.newScalarValue.getHex() : this.newScalarValue,
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== SetMaterialMapCommand.type) return null;

    const command = new SetMaterialMapCommand(editor, null, json.attributeName, null, null);
    command.objectUuid = json.objectUuid;
    command.scalarKey = json.scalarKey ?? null;

    const restoreTexture = (texData) => {
      if (!texData) return null;
      
      let tex = editor.textureByUuid?.(texData.uuid);
      if (tex) return tex;

      if (texData.src) {
        tex = new THREE.TextureLoader().load(texData.src);
        tex.uuid = texData.uuid;
        tex.name = texData.name;
        tex.colorSpace = texData.colorSpace;
        
        if (editor.addTexture) {
          editor.addTexture(tex);
        }
      }
      return tex || null;
    };

    command.oldTexture = restoreTexture(json.oldTexture);
    command.newTexture = restoreTexture(json.newTexture);

    const isColor = command.scalarKey === 'color';
    command.oldScalarValue = (isColor && json.oldScalarValue != null)
      ? new THREE.Color(json.oldScalarValue)
      : json.oldScalarValue;
    command.newScalarValue = (isColor && json.newScalarValue != null)
      ? new THREE.Color(json.newScalarValue)
      : json.newScalarValue;

    command.attributeName = json.attributeName;

    return command;
  }
}