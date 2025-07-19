import * as THREE from 'three';

export class MatcapWireframeMaterial extends THREE.ShaderMaterial {
  constructor(matcapTexture, options = {}) {
    super({
      uniforms: {
        matcap: { value: matcapTexture },
        tintColor: { value: new THREE.Color(options.tintColor || 0xffffff) },
        wireframeColor: { value: new THREE.Color(options.wireframeColor || 0x000000) },
        wireframeOpacity: { value: options.wireframeOpacity ?? 1.0 },
        wireframeThickness: { value: options.wireframeThickness ?? 1.0 }
      },
      vertexShader: /* glsl */`
        varying vec3 vNormal;
        varying vec3 vViewPosition;
        varying vec3 vBarycentric;

        attribute vec3 aBarycentric;

        void main() {
          vBarycentric = aBarycentric;

          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vViewPosition = -mvPosition.xyz;
          vNormal = normalize(normalMatrix * normal);

          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */`
        uniform sampler2D matcap;
        uniform vec3 tintColor;
        uniform vec3 wireframeColor;
        uniform float wireframeOpacity;
        uniform float wireframeThickness;

        varying vec3 vNormal;
        varying vec3 vViewPosition;
        varying vec3 vBarycentric;

        float edgeFactor(vec3 bary) {
          vec3 d = fwidth(bary);
          vec3 a3 = smoothstep(vec3(0.0), d * wireframeThickness, bary);
          return min(min(a3.x, a3.y), a3.z);
        }

        void main() {
          vec3 normal = normalize(vNormal);
          vec3 viewDir = normalize(vViewPosition);
          vec3 x = normalize(vec3(viewDir.z, 0.0, -viewDir.x));
          vec3 y = cross(viewDir, x);
          vec2 uv = vec2(dot(x, normal), dot(y, normal)) * 0.495 + 0.5;

          // vec3 baseColor = texture2D(matcap, uv).rgb;
          vec3 baseColor = texture2D(matcap, uv).rgb * tintColor;

          float edge = edgeFactor(vBarycentric);
          vec3 color = mix(wireframeColor, baseColor, edge * (1.0 - wireframeOpacity) + wireframeOpacity);

          // gl_FragColor = vec4(color, 1.0);
          gl_FragColor = vec4(pow(color, vec3(1.0 / 2.2)), 1.0);
        }
      `,
      transparent: false
    });

    this.wireframe = false;
    this.side = THREE.DoubleSide;
  }
}
