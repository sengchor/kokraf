import * as THREE from "three"

export function createGridHelper() {
  const geometry = new THREE.PlaneGeometry(100, 100);
  geometry.rotateX(- Math.PI / 2);

  // const material = new THREE.MeshStandardMaterial({ color: '#86B049'});\

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uCameraPos: { value: new THREE.Vector3() },
      uGridSize: { value: 1.0 },
      uLineThickness: { value: 1.0 },
      uLineColor: { value: new THREE.Color(0xFFFFFF) },
      uBackgroundColor: { value: new THREE.Color(0x0000FF) },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uCameraPos;
      uniform float uGridSize;
      uniform float uLineThickness;
      uniform vec3 uLineColor;
      uniform vec3 uBackgroundColor;
      varying vec3 vWorldPos;

      float getGridLine(vec2 coord, float size, float thickness) {
        vec2 grid = abs(fract(coord / size - 0.5) - 0.5) / fwidth(coord / size);
        float line = min(grid.x, grid.y);
        return 1.0 - smoothstep(0.0, thickness, line);
      }

      void main() {
        vec2 coord = vWorldPos.xz;
        float grid = getGridLine(coord, uGridSize, uLineThickness);
        vec3 color = mix(uBackgroundColor, uLineColor, grid);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.DoubleSide,
    transparent: false
  });

  const gridHelper = new THREE.Mesh(geometry, material);
  return gridHelper;
}