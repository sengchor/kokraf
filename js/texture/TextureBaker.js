import * as THREE from 'three';

const ATLAS_OFFSETS = [
  new THREE.Vector2(0.0, 0.5),
  new THREE.Vector2(0.5, 0.5),
  new THREE.Vector2(0.5, 0.0),
  new THREE.Vector2(0.0, 0.0),
];

// Shaders
const VERTEX_SHADER = `
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    // Reconstruct world-space position and normal for projection in fragment
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vWorldNormal = normalize(normalMatrix * normal);

    // Render the mesh "flat" in UV space so each texel covers one UV point
    gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  uniform sampler2D uAtlas;
  uniform sampler2D depthTex;

  uniform mat4 uVP0;
  uniform mat4 uVP1;
  uniform mat4 uVP2;
  uniform mat4 uVP3;

  uniform vec3 uCamPos0;
  uniform vec3 uCamPos1;
  uniform vec3 uCamPos2;
  uniform vec3 uCamPos3;

  uniform vec2 uOffset0;
  uniform vec2 uOffset1;
  uniform vec2 uOffset2;
  uniform vec2 uOffset3;

  uniform sampler2D uDepth0;
  uniform sampler2D uDepth1;
  uniform sampler2D uDepth2;
  uniform sampler2D uDepth3;

  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  // Project vWorldPos into one camera view and accumulate weighted sample.
  // atlasOffset is the bottom-left UV corner of that view's quadrant.
  void accumulateView(
      mat4 vp,
      vec3 camPos,
      vec2 atlasOffset,
      sampler2D depthTex,
      inout vec4 colorSum,
      inout float weightSum
  ) {
    vec4 clip = vp * vec4(vWorldPos, 1.0);
    if (clip.w <= 0.0) return;

    vec3 ndc = clip.xyz / clip.w;

    // Reject points outside the view frustum
    if (abs(ndc.x) > 1.0 || abs(ndc.y) > 1.0 || ndc.z < -1.0 || ndc.z > 1.0)
    return;

    // Weight by how directly this camera faces the surface normal
    vec3 viewDir = normalize(camPos - vWorldPos);
    float facing = max(0.0, dot(vWorldNormal, viewDir));
    if (facing < 0.01) return;

    // Map NDC → [0,1] → quadrant in the atlas
    vec2 projUV = ndc.xy * 0.5 + 0.5;
    vec2 atlasUV = projUV * 0.5 + atlasOffset;

    float projectedDepth = ndc.z * 0.5 + 0.5;
    float sceneDepth = texture2D(depthTex, projUV).r;
    float bias = 0.001;
    if (projectedDepth > sceneDepth + bias) return;

    colorSum += texture2D(uAtlas, atlasUV) * facing;
    weightSum += facing;
  }
  
  void main() {
    vec4 colorSum = vec4(0.0);
    float weightSum = 0.0;

    accumulateView(uVP0, uCamPos0, uOffset0, uDepth0, colorSum, weightSum);
    accumulateView(uVP1, uCamPos1, uOffset1, uDepth1, colorSum, weightSum);
    accumulateView(uVP2, uCamPos2, uOffset2, uDepth2, colorSum, weightSum);
    accumulateView(uVP3, uCamPos3, uOffset3, uDepth3, colorSum, weightSum);

    if (weightSum > 0.0) {
      gl_FragColor = colorSum / weightSum;
    } else {
      // UV islands with zero coverage get a neutral mid-grey placeholder
      gl_FragColor = vec4(0.5, 0.5, 0.5, 1.0);
    }
  }
`;

export class TextureBaker {
  static async bake(threeRenderer, mesh, atlasBlob, views, size = 512) {
    if (views.length !== 4) {
      throw new Error('TextureBaker.bake: expected exactly 4 view snapshots');
    }
    if (!mesh.geometry.attributes.uv) {
      throw new Error('TextureBaker.bake: mesh geometry is missing a uv attribute - run UV unwrap first');
    }

    const atlasTexture = await TextureBaker.blobToTexture(atlasBlob);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uAtlas: { value: atlasTexture },

        uVP0: { value: views[0].vpMatrix },
        uVP1: { value: views[1].vpMatrix },
        uVP2: { value: views[2].vpMatrix },
        uVP3: { value: views[3].vpMatrix },

        uCamPos0: { value: views[0].camWorldPos },
        uCamPos1: { value: views[1].camWorldPos },
        uCamPos2: { value: views[2].camWorldPos },
        uCamPos3: { value: views[3].camWorldPos },

        uOffset0: { value: ATLAS_OFFSETS[0] },
        uOffset1: { value: ATLAS_OFFSETS[1] },
        uOffset2: { value: ATLAS_OFFSETS[2] },
        uOffset3: { value: ATLAS_OFFSETS[3] },

        uDepth0: { value: views[0].depthTexture },
        uDepth1: { value: views[1].depthTexture },
        uDepth2: { value: views[2].depthTexture },
        uDepth3: { value: views[3].depthTexture },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      side: THREE.DoubleSide
    });

    const bakeMesh = new THREE.Mesh(mesh.geometry, material);
    bakeMesh.matrixWorld.copy(mesh.matrixWorld);
    bakeMesh.matrixAutoUpdate = false;

    const bakeScene = new THREE.Scene();
    bakeScene.add(bakeMesh);

    const bakeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const renderTarget = new THREE.WebGLRenderTarget(size, size, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    });

    const prevTarget = threeRenderer.getRenderTarget();
    threeRenderer.setRenderTarget(renderTarget);
    threeRenderer.clear();
    threeRenderer.render(bakeScene, bakeCamera);
    threeRenderer.setRenderTarget(prevTarget);

    material.dispose();
    atlasTexture.dispose();

    return renderTarget;
  }

  static async toBlob(threeRenderer, renderTarget) {
    const { width, height } = renderTarget;
    const buf = new Uint8Array(width * height * 4);
    threeRenderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, buf);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    const data = ctx.createImageData(width, height);

    for (let y = 0; y < height; y++) {
      const srcRow = (height - 1 - y) * width * 4;
      const dstRow = y * width * 4;
      data.data.set(buf.subarray(srcRow, srcRow + width * 4), dstRow);
    }

    ctx.putImageData(data, 0, 0);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  }

  static async blobToTexture(blob) {
    const dataUrl = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });

    return new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(
        dataUrl,
        (tex) => {
          tex.flipY = true;
          resolve(tex);
        },
        undefined,
        reject
      );
    });
  }
}