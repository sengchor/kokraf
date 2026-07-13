import * as THREE from 'three';

export class PaintStrokeCommand {
  static type = 'PaintStrokeCommand';

  static MAP_LABELS = {
    map: 'Base Color',
    metalnessMap: 'Metalness',
    roughnessMap: 'Roughness',
    normalMap: 'Normal',
  };

  /**
   * @param {Editor} editor
   * @param {THREE.Object3D} object
   * @param {string} paintMap
   * @param {ImageData} beforeImageData
   * @param {ImageData} afterImageData
   * @constructor
   */
  constructor(editor, object, paintMap, beforeImageData, afterImageData) {
    this.editor = editor;
    this.objectUuid = object ? object.uuid : null;

    this.paintMap = paintMap || 'map';
    this.name = `Paint Stroke (${PaintStrokeCommand.MAP_LABELS[this.paintMap] ?? this.paintMap})`;

    this.before = beforeImageData || null;
    this.after = afterImageData || null;
  }

  execute() {
    this._apply(this.after);
  }

  undo() {
    this._apply(this.before);
  }

  _getMaterial(object) {
    if (!object) return null;

    const painter = this.editor.viewportControls?.texturePainter;
    if (painter?.isActive && painter.object === object && painter.originalMaterial) {
      return painter.originalMaterial;
    }

    return object.material;
  }

  _apply(imageData) {
    if (!imageData) return;

    const object = this.editor.objectByUuid(this.objectUuid);
    const painter = this.editor.viewportControls?.texturePainter;

    if (painter?.isActive && painter.object === object) {
      painter.setPaintMap(this.paintMap);
    }

    const material = this._getMaterial(object);
    const texture = material?.[this.paintMap];
    const canvas = texture?.image;

    if (!canvas || imageData.width !== canvas.width || imageData.height !== canvas.height) {
      return;
    }

    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);
    texture.needsUpdate = true;

    if (painter?.object === object && painter.projectionPainter?.canvas === canvas) {
      painter.projectionPainter.imageData = new ImageData(
        new Uint8ClampedArray(imageData.data),
        imageData.width,
        imageData.height
      );
    }

    this.editor.signals.objectChanged.dispatch(object);
  }

  toJSON() {
    return {
      type: PaintStrokeCommand.type,
      objectUuid: this.objectUuid,
      paintMap: this.paintMap,
      beforeImage: PaintStrokeCommand._imageDataToDataURL(this.before),
      afterImage: PaintStrokeCommand._imageDataToDataURL(this.after),
    };
  }

  static fromJSON(editor, json) {
    if (!json || json.type !== PaintStrokeCommand.type) return null;

    const command = new PaintStrokeCommand(editor, null, json.paintMap, null, null);
    command.objectUuid = json.objectUuid;

    PaintStrokeCommand._dataURLToImageData(json.beforeImage).then(d => { command.before = d; });
    PaintStrokeCommand._dataURLToImageData(json.afterImage).then(d => { command.after = d; });

    return command;
  }

  static _imageDataToDataURL(imageData) {
    if (!imageData) return null;
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext('2d').putImageData(imageData, 0, 0);
    return canvas.toDataURL();
  }

  static _dataURLToImageData(dataURL) {
    if (!dataURL) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, img.width, img.height));
      };
      img.onerror = reject;
      img.src = dataURL;
    });
  }
}