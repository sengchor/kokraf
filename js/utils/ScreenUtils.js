import * as THREE from 'three';

export function projectToScreen(worldPosition, camera, domElement) {
  const projected = worldPosition.clone().project(camera);

  return new THREE.Vector2(
    (projected.x + 1) * 0.5 * domElement.clientWidth,
    (-projected.y + 1) * 0.5 * domElement.clientHeight
  );
}

export function worldToScreen(pos, camera, renderer) {
  const ndc = pos.clone().project(camera);

  return {
    x: (ndc.x * 0.5 + 0.5) * renderer.domElement.width,
    y: (-ndc.y * 0.5 + 0.5) * renderer.domElement.height
  };
}

export function pixelsToWorldUnits(pixelDistance, camera, depth, renderer) {
  const viewportHeightPx = renderer.domElement.clientHeight;

  let worldPerPixel;

  if (camera.isPerspectiveCamera) {
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const viewportHeight = 2 * Math.tan(vFov / 2) * depth;
    worldPerPixel = viewportHeight / viewportHeightPx;
  } else if (camera.isOrthographicCamera) {
    const worldHeight = (camera.top - camera.bottom) / camera.zoom;
    worldPerPixel = worldHeight / viewportHeightPx;
  }

  return pixelDistance * worldPerPixel;
}