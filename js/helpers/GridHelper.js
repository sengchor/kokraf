import * as THREE from "three";

export class GridHelper extends THREE.Mesh {
  constructor() {
    const geometry = new THREE.PlaneGeometry(100, 100);
    geometry.rotateX(-Math.PI / 2);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uCameraPos: { value: new THREE.Vector3() },
        uCameraDir: { value: new THREE.Vector3() },
        uGridSize: { value: 0.5 },
        uMajorGridSize: { value: 5.0 },
        uLineThickness: { value: 1.5 },
        uLineColor: { value: new THREE.Color(0xffffff) },
        uBackgroundColor: { value: new THREE.Color(0x000000) },
        uDistance: { value: 2.0 },
      },
      vertexShader: `varying vec3 vWorldPos;
      uniform vec3 uCameraPos;
      uniform float uDistance;
      void main() {
        vec3 scaledPosition = position * uDistance;
        vec4 worldPosition = modelMatrix * vec4(scaledPosition, 1.0);
        worldPosition.xz += uCameraPos.xz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
        vWorldPos = worldPosition.xyz;
      }`,
      fragmentShader: `uniform vec3 uCameraPos;
      uniform vec3 uCameraDir;
      uniform float uGridSize;
      uniform float uMajorGridSize;
      uniform float uLineThickness;
      uniform vec3 uLineColor;
      uniform vec3 uBackgroundColor;
      uniform float uDistance;
      varying vec3 vWorldPos;

      float getGridLine(vec2 coord, float size, float thickness) {
        vec2 grid = abs(fract(coord / size - 0.5) - 0.5) / fwidth(coord / size);
        float line = min(grid.x, grid.y);
        return 1.0 - smoothstep(0.0, thickness, line);
      }

      float getAxisLine(vec2 coord, float thickness) {
        float xLine = 1.0 - smoothstep(0.0, thickness, abs(coord.x) / fwidth(coord.x));
        float zLine = 1.0 - smoothstep(0.0, thickness, abs(coord.y) / fwidth(coord.y));
        return max(xLine, zLine);
      }

      float computeGridFade(vec3 cameraPos, vec3 worldPos, vec3 cameraDir) {
        float distFade = 1.0 - min(distance(cameraPos, worldPos) / uDistance / 40.0, 1.0);
        distFade = pow(distFade, 3.0);
        vec3 planeNormal = vec3(0.0, 1.0, 0.0);
        float angleDot = abs(dot(normalize(cameraDir), planeNormal));
        float fadeStart = 0.0872;
        float t = clamp((angleDot - fadeStart) / (1.0 - fadeStart), 0.0, 1.0);
        float angleFade = pow(t, 0.5);
        return distFade * angleFade;
      }

      void main() {
        vec2 coord = vWorldPos.xz;
        float minorGrid = getGridLine(coord, uGridSize, uLineThickness);
        float majorGrid = getGridLine(coord, uMajorGridSize, uLineThickness);
        float axis = getAxisLine(coord, uLineThickness * 1.5);

        float combinedFade = computeGridFade(uCameraPos, vWorldPos, uCameraDir);

        vec3 color = uBackgroundColor;
        color = mix(color, uLineColor, minorGrid);
        color = mix(color, uLineColor, majorGrid);

        if (axis > 0.0) {
          vec3 xAxisColor = vec3(142.0 / 255.0, 254.0 / 255.0, 97.0 / 255.0);
          vec3 zAxisColor = vec3(252.0 / 255.0, 74.0 / 255.0, 103.0 / 255.0);
          color = (abs(coord.x) < abs(coord.y)) ? zAxisColor : xAxisColor;
        }

        float alpha = max(max(minorGrid * 0.4, majorGrid * 0.7), axis * 0.9) * combinedFade;
        gl_FragColor = vec4(color, alpha);
      }`,
      side: THREE.DoubleSide,
      transparent: true,
    });

    super(geometry, material);

    this.frustumCulled = false;
  }

  updateUniforms(camera, maxScale = 5) {
    const material = this.material;
    const cameraPos = camera.position;
    const gridPos = this.position;

    material.uniforms.uCameraPos.value.copy(cameraPos);

    const cameraDistance = cameraPos.distanceTo(gridPos);
    const distanceScale = Math.min(cameraDistance * 2.0, maxScale);
    material.uniforms.uDistance.value = distanceScale;

    const cameraDir = new THREE.Vector3();
    camera.getWorldDirection(cameraDir);
    material.uniforms.uCameraDir.value.copy(cameraDir);
  }
}
