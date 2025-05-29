import * as THREE from 'three';
import { OutlineEffect } from 'jsm/effects/OutlineEffect.js';

export default class Renderer {
  constructor({ canvasId }) {
    const canvas = document.getElementById(canvasId);
    this.instance = new THREE.WebGLRenderer({ canvas, antialias: true});
    this.instance.setPixelRatio(window.devicePixelRatio);
    this.instance.autoClear = false;

    this.outlineEffect = new OutlineEffect(this.instance);
  }

  get domElement() {
    return this.instance.domElement;
  }

  setSize(width, height) {
    this.instance.setSize(width, height);
  }

  clearAll() {
    this.instance.clear();
  }

  render(scene, camera) {
    this.instance.render(scene, camera);
  }

  renderWithOutline(scene, camera) {
    this.outlineEffect.render(scene, camera);
  }
}