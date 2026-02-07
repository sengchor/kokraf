import * as THREE from 'three';

export default class OriginHelper {
  constructor(editor) {
    this.editor = editor;
    this.sceneManager = editor.sceneManager;
    this.originHelpers = new Map();
  }

  addOriginHelper(object) {
    if (this.originHelpers.has(object.id)) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));

    const material = new THREE.PointsMaterial({
      color: 0xffba00,
      size: 5,
      sizeAttenuation: false,
      depthTest: false,
      depthWrite: false
    });

    const originPoint = new THREE.Points(geometry, material);
    originPoint.name = '__OriginHelper';
    originPoint.userData.isEditorOnly = true;
    
    originPoint.renderOrder = 999; 

    this.sceneManager.sceneEditorHelpers.add(originPoint);

    this.originHelpers.set(object.id, originPoint);
  }

  removeOriginHelper(object) {
    const helper = this.originHelpers.get(object.id);
    if(helper && helper.parent) {
      helper.parent.remove(helper);
      this.originHelpers.delete(object.id);
    }
  }

  updateOrginHelpers(objects) {
    for (const object of objects) {
      const originHelper = this.originHelpers.get(object.id);
      if (originHelper) {
        object.getWorldPosition(originHelper.position);
      }
    }
  }
}