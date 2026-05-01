import * as THREE from 'three';

const ID_VERT = `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const ID_FRAG = `
uniform vec3 uId;
void main() {
  gl_FragColor = vec4(uId, 1.0);
}`;

const EDGE_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}`;

const EDGE_FRAG = `
uniform sampler2D uIdBuffer;
uniform vec2 uTexelSize;
uniform vec4 uOutlineColor;
varying vec2 vUv;

bool idEq(vec4 a, vec4 b) {
  if (abs(a.a - b.a) > 0.5) return false;
  return all(lessThan(abs(a.rgb - b.rgb), vec3(0.002)));
}

void main() {
  vec4 c = texture2D(uIdBuffer, vUv);
  vec4 r = texture2D(uIdBuffer, vUv + vec2( uTexelSize.x, 0.0));
  vec4 l = texture2D(uIdBuffer, vUv + vec2(-uTexelSize.x, 0.0));
  vec4 u = texture2D(uIdBuffer, vUv + vec2(0.0,  uTexelSize.y));
  vec4 d = texture2D(uIdBuffer, vUv + vec2(0.0, -uTexelSize.y));

  bool edge = !idEq(c, r) || !idEq(c, l) || !idEq(c, u) || !idEq(c, d);

  if (edge) {
    gl_FragColor = uOutlineColor;
  } else {
    discard;
  }
}`;

export class Outline {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = true;
    this._matCache = new Map(); // uuid -> ShaderMaterial with baked ID color

    this.idTarget = new THREE.WebGLRenderTarget(1, 1, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1,-1,0, 3,-1,0, -1,3,0], 3));
    geo.setAttribute('uv',       new THREE.Float32BufferAttribute([ 0,0,0,  2,0,0,  0,2,0], 3));

    this.edgeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uIdBuffer:     { value: this.idTarget.texture },
        uTexelSize:    { value: new THREE.Vector2() },
        uOutlineColor: { value: new THREE.Vector4(0, 0, 0, 0.25) },
      },
      vertexShader: EDGE_VERT,
      fragmentShader: EDGE_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geo, this.edgeMaterial);
    mesh.frustumCulled = false;

    this.edgeScene = new THREE.Scene();
    this.edgeScene.add(mesh);
    this.edgeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(width, height) {
    this.idTarget.setSize(width, height);
    this.edgeMaterial.uniforms.uTexelSize.value.set(1 / width, 1 / height);
  }

  setColor(r, g, b, a = 1.0) {
    this.edgeMaterial.uniforms.uOutlineColor.value.set(r, g, b, a);
  }

  _getIdMaterial(uuid, id) {
    let mat = this._matCache.get(uuid);
    if (!mat) {
      mat = new THREE.ShaderMaterial({
        uniforms: { uId: { value: new THREE.Vector3() } },
        vertexShader: ID_VERT,
        fragmentShader: ID_FRAG,
        side: THREE.DoubleSide,
      });
      this._matCache.set(uuid, mat);
    }
    // Bake the ID color directly into this material's uniform
    mat.uniforms.uId.value.set(
      ((id >> 16) & 0xff) / 255,
      ((id >>  8) & 0xff) / 255,
      ( id        & 0xff) / 255,
    );
    return mat;
  }

  render(scene, camera) {
    if (!this.enabled) return;

    const renderer = this.renderer;

    // ID pass
    const swapped = [];
    let id = 1;

    const savedOverride = scene.overrideMaterial;
    scene.overrideMaterial = null;

    scene.traverse(obj => {
      if (!obj.isMesh) return;
      swapped.push({ obj, original: obj.material });
      obj.material = this._getIdMaterial(obj.uuid, id++);
    });

    const savedClearColor = new THREE.Color();
    const savedClearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(savedClearColor);

    renderer.setRenderTarget(this.idTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);

    // Restore
    swapped.forEach(({ obj, original }) => { obj.material = original; });
    scene.overrideMaterial = savedOverride;
    renderer.setClearColor(savedClearColor, savedClearAlpha);
    renderer.setRenderTarget(null);

    // Edge detection composite
    renderer.render(this.edgeScene, this.edgeCamera);
  }

  dispose() {
    this.idTarget.dispose();
    this._matCache.forEach(mat => mat.dispose());
    this._matCache.clear();
    this.edgeMaterial.dispose();
  }
}