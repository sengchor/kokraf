import { LineMaterial } from 'jsm/lines/LineMaterial.js';

export class EdgeLineMaterial extends LineMaterial {
  constructor(parameters = {}) {
    super({
      color: 0xffffff,
      linewidth: 0.9,
      vertexColors: true,
      dashed: false,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -5,
      polygonOffsetUnits: -5,
      ...parameters,
    });
 
    this.isEdgeLineMaterial = true;
    this.perEdgeWidth = this._enablePerEdgeWidth();
  }
 
  _enablePerEdgeWidth() {
    const vs = this.vertexShader;
    const target = 'offset *= linewidth;';
 
    if (vs.includes('attribute float instanceWidth;')) return true;
 
    if (!vs.includes(target)) {
      console.warn('EdgeLineMaterial: LineMaterial shader changed, per-edge width disabled.');
      return false;
    }
 
    this.vertexShader = vs
      .replace('uniform float linewidth;', 'uniform float linewidth;\nattribute float instanceWidth;')
      .replace(target, 'offset *= linewidth * instanceWidth;');
    this.needsUpdate = true;
    return true;
  }
}