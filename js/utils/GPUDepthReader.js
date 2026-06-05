import * as THREE from 'three';

const linearDepthVertexShader = `
  varying float vViewZ;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewZ = -mvPosition.z; // Capture distance along the camera's Z-axis
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const linearDepthFragmentShader = `
  #include <packing>
  
  varying float vViewZ;
  uniform float cameraNear;
  uniform float cameraFar;

  void main() {
    // Normalize linear depth to a [0, 1] range
    float linearDepth = (vViewZ - cameraNear) / (cameraFar - cameraNear);
    
    // Pack the float into RGBA to maintain high precision
    gl_FragColor = packDepthToRGBA(linearDepth);
  }
`;

export class GPUDepthReader {
  constructor(renderer, width, height) {
    this.renderer = renderer;
    this.width = width;
    this.height = height;

    // Use NearestFilter to prevent depth values from blending at edges
    this.renderTarget = new THREE.WebGLRenderTarget(this.width, this.height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      generateMipmaps: false
    });

    // Initialize the ShaderMaterial
    this.depthMaterial = new THREE.ShaderMaterial({
      vertexShader: linearDepthVertexShader,
      fragmentShader: linearDepthFragmentShader,
      uniforms: {
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000.0 }
      }
    });

    this.pixelBuffer = new Uint8Array(this.width * this.height * 4);
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.renderTarget.setSize(width, height);
    this.pixelBuffer = new Uint8Array(width * height * 4);
  }

  updateDepthBuffer(scene, camera) {
    // Sync camera near/far planes with uniforms
    this.depthMaterial.uniforms.cameraNear.value = camera.near;
    this.depthMaterial.uniforms.cameraFar.value = camera.far;

    const originalOverride = scene.overrideMaterial;
    const originalBackground = scene.background;

    scene.overrideMaterial = this.depthMaterial;
    // Black background represents infinite depth (1.0 when packed)
    scene.background = new THREE.Color(0xffffff); 

    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.clear();
    this.renderer.render(scene, camera);

    this.renderer.readRenderTargetPixels(
      this.renderTarget,
      0, 0,
      this.width, this.height,
      this.pixelBuffer
    );

    this.renderer.setRenderTarget(null);
    scene.overrideMaterial = originalOverride;
    scene.background = originalBackground;
  }

  isPointVisible(position, camera) {
    // Get NDC coordinates to find the correct pixel
    const proj = position.clone().project(camera);
    
    if (proj.x < -1 || proj.x > 1 || proj.y < -1 || proj.y > 1 || proj.z > 1 || proj.z < -1) {
      return false; // Point is outside the frustum
    }

    const x = Math.floor((proj.x + 1) * this.width / 2);
    const y = Math.floor((proj.y + 1) * this.height / 2);
    const index = (y * this.width + x) * 4;

    // Unpack to normalized linear depth [0, 1]
    const normalizedDepth = this.unpackRGBAToDepth(
      this.pixelBuffer[index],
      this.pixelBuffer[index + 1],
      this.pixelBuffer[index + 2],
      this.pixelBuffer[index + 3]
    );

    // Convert GPU depth back to absolute view-space distance
    const gpuViewZ = normalizedDepth * (camera.far - camera.near) + camera.near;

    // Transform the test point into view space
    const viewPos = position.clone().applyMatrix4(camera.matrixWorldInverse);
    const testViewZ = -viewPos.z;

    // Direct 1D comparison
    // Epsilon may need slight tuning depending on your scene scale
    const VIEW_EPSILON = 0.001; 
    return testViewZ <= gpuViewZ + VIEW_EPSILON;
  }

  // Your original unpack math is perfect and matches Three's packDepthToRGBA
  unpackRGBAToDepth(r, g, b, a) {
    const rNorm = r / 255.0;
    const gNorm = g / 255.0;
    const bNorm = b / 255.0;
    const aNorm = a / 255.0;
    return rNorm + (gNorm / 255.0) + (bNorm / 65025.0) + (aNorm / 16581375.0);
  }
}