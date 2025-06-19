import * as THREE from 'three';
import { OutlineEffect } from 'jsm/effects/OutlineEffect.js';

export default class Renderer {
  constructor(editor) {
    this.editor = editor;
    this.config = editor.config;
    
    this.canvas = document.getElementById('three-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.config.get('antialias')});
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.autoClear = false;

    this.outlineEffect = new OutlineEffect(this.renderer);
  }

  applyConfig() {
    this.renderer.shadowMap.enabled = this.config.get('shadows');

    this.renderer.shadowMap.type = {
      0: THREE.BasicShadowMap,
      1: THREE.PCFShadowMap,
      2: THREE.PCFSoftShadowMap
    }[this.config.get('shadowType')];

    this.renderer.toneMapping = {
      0: THREE.NoToneMapping,
      1: THREE.LinearToneMapping,
      2: THREE.ReinhardToneMapping,
      3: THREE.CineonToneMapping,
      4: THREE.ACESFilmicToneMapping,
      5: THREE.AgXToneMapping,
      6: THREE.NeutralToneMapping
    }[this.config.get('tonemapping')];
  }

  get domElement() {
    return this.renderer.domElement;
  }

  setSize(width, height) {
    this.renderer.setSize(width, height);
  }

  clearAll() {
    this.renderer.clear();
  }

  render(scene, camera) {
    this.renderer.render(scene, camera);
  }

  renderWithOutline(scene, camera) {
    this.outlineEffect.render(scene, camera);
  }
}