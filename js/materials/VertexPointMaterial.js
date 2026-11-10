import * as THREE from 'three';
import { VIEW_DEPTH_BIAS } from './chunks/ViewDepthBias.js';

export class VertexPointMaterial extends THREE.PointsMaterial {
  constructor(parameters = {}) {
    const { depthBias = 0.002, ...rest } = parameters;

    super({
      size: 3.5,
      sizeAttenuation: false,
      vertexColors: true,
      ...rest,
    });

    this.isVertexPointMaterial = true;
    this.depthBias = { value: depthBias };

    this.onBeforeCompile = (shader) => {
      shader.uniforms.depthBias = this.depthBias;
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'uniform float depthBias;\nvoid main() {')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vec4 biasSrc = mvPosition;
          ${VIEW_DEPTH_BIAS}`
        );
    };
  }
}