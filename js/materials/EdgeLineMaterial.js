import { LineMaterial } from 'jsm/lines/LineMaterial.js';
import { VIEW_DEPTH_BIAS } from './chunks/ViewDepthBias.js';

export class EdgeLineMaterial extends LineMaterial {
  constructor(parameters = {}) {
    const { depthBias = 0.002, ...rest } = parameters

    super({
      color: 0xffffff,
      linewidth: 0.9,
      vertexColors: true,
      dashed: false,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffset: false,
      ...rest,
    });
 
    this.isEdgeLineMaterial = true;
    this.uniforms.depthBias = { value: depthBias };
    this._patchShader();
  }

  get depthBias() { return this.uniforms.depthBias.value; }
  set depthBias(v) { this.uniforms.depthBias.value = v; }
 
  _patchShader() {
    let vs = this.vertexShader;
    const widthTarget = 'offset *= linewidth;';
    const biasTarget = '#include <logdepthbuf_vertex>';

    if (!vs.includes(widthTarget) || !vs.includes(biasTarget)) {
      console.warn('EdgeLineMaterial: LineMaterial shader changed, patch skipped.');
      this.perEdgeWidth = false;
      return;
    }

    vs = vs
      .replace(
        'uniform float linewidth;',
        'uniform float linewidth;\nuniform float depthBias;\nattribute float instanceWidth;'
      )
      .replace(widthTarget, 'offset *= linewidth * instanceWidth;')
      .replace(
        biasTarget,
        `vec4 biasSrc = (position.y < 0.5) ? start : end;
        ${VIEW_DEPTH_BIAS}
        ${biasTarget}`
      );

    this.vertexShader = vs;
    this.perEdgeWidth = true;
    this.needsUpdate = true;
  }
}