import * as THREE from 'three';
import { resolveTargets } from './AgentUtils.js';
import { AXES_NOTE, positionToThree, positionFromThree } from './AgentAxes.js';

const MAX_CAPTURE_EDGE = 1568;
const MIN_CAPTURE_EDGE = 16;
const MIN_FRAME_RADIUS = 0.05;
const POINT_FRAME_RADIUS = 1;
const DEG = Math.PI / 180;

const VIEW_PRESETS = {
  front: { azimuth: 0, elevation: 0 },
  right: { azimuth: 90, elevation: 0 },
  back: { azimuth: 180, elevation: 0 },
  left: { azimuth: -90, elevation: 0 },
  top: { azimuth: 0, elevation: 90 },
  bottom: { azimuth: 0, elevation: -90 },
};

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read captured image.'));
    reader.readAsDataURL(blob);
  });
}

function validateEdge(name, value) {
  if (!Number.isInteger(value) || value < MIN_CAPTURE_EDGE || value > MAX_CAPTURE_EDGE) {
    throw new Error(
      `viewport.capture: ${name} must be an integer between ${MIN_CAPTURE_EDGE} and ${MAX_CAPTURE_EDGE} (got ${value}).`
    );
  }
  return value;
}

function normalizeAzimuth(deg) {
  const n = ((((deg + 180) % 360) + 360) % 360) - 180;
  return n === -180 ? 180 : n;
}

const toVector3 = (v) => (v?.isVector3 ? v.clone() : new THREE.Vector3().fromArray(v));
const zUpToThree = (xyz) => toVector3(positionToThree(xyz));
const formatVec = (v) => `${positionFromThree(v).map((n) => n.toFixed(2)).join(', ')}`;

function anglesOf(directionThree) {
  const [x, y, z] = positionFromThree(directionThree);
  return {
    azimuth: Math.atan2(y, x) / DEG,
    elevation: Math.asin(Math.max(-1, Math.min(1, z))) / DEG,
  };
}

function resolveDirection(orbit, { view, azimuth, elevation }) {
  const camera = orbit.camera;

  const current = new THREE.Vector3().subVectors(camera.position, orbit.target);
  if (current.lengthSq() < 1e-12) camera.getWorldDirection(current).negate();
  current.normalize();

  const preset = view && view !== 'current' ? VIEW_PRESETS[view] : null;

  if (!preset && azimuth === undefined && elevation === undefined) {
    return { direction: current, up: camera.up.clone().normalize(), ...anglesOf(current) };
  }

  const base = anglesOf(current);
  const az = azimuth ?? preset?.azimuth ?? base.azimuth;
  const el = elevation ?? preset?.elevation ?? base.elevation;

  if (!Number.isFinite(az)) {
    throw new Error(`viewport.capture: azimuth must be a finite number (got ${az}).`);
  }
  if (!(el >= -90 && el <= 90)) {
    throw new Error(`viewport.capture: elevation must be between -90 and 90 degrees (got ${el}).`);
  }

  const a = az * DEG;
  const e = el * DEG;

  const direction = zUpToThree([Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)]).normalize();

  const up = Math.abs(Math.sin(e)) > 0.999
    ? zUpToThree([-Math.sign(e) * Math.cos(a), -Math.sign(e) * Math.sin(a), 0]) : zUpToThree([0, 0, 1]);

  return { direction, up: up.normalize(), azimuth: az, elevation: el };
}

function expandBySelection(editor, box) {
  const edited = editor.editSelection.editedObject;

  if (editor.modeManager.currentMode === 'edit' && edited) {
    const meshData = edited.userData.meshData;
    const point = new THREE.Vector3();

    for (const id of editor.editSelection.selectedVertexIds) {
      const vertex = meshData?.getVertex(id);
      if (vertex) box.expandByPoint(point.copy(vertex.position).applyMatrix4(edited.matrixWorld));
    }
  } else {
    expandByObjects(box, editor.selection.selectedObjects ?? []);
  }

  if (box.isEmpty()) throw new Error('viewport.capture: nothing is selected to frame.');
}

function expandByObjects(box, objects) {
  const objectBox = new THREE.Box3();
  const position = new THREE.Vector3();

  for (const object of objects) {
    objectBox.makeEmpty().expandByObject(object);
    if (objectBox.isEmpty()) box.expandByPoint(object.getWorldPosition(position));
    else box.union(objectBox);
  }
}

function resolveFocus(editor, orbit, { target, lookAt }) {
  if (target !== undefined && lookAt !== undefined) {
    throw new Error('viewport.capture: pass either target or lookAt, not both.');
  }

  if (lookAt !== undefined) return { center: zUpToThree(lookAt), radius: null };
  if (target === undefined) return { center: orbit.target.clone(), radius: null };

  const box = new THREE.Box3();

  if (target === 'selection') {
    expandBySelection(editor, box);
  } else {
    expandByObjects(box, resolveTargets(editor, target));
  }

  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = sphere.radius < 1e-6 ? POINT_FRAME_RADIUS : Math.max(sphere.radius, MIN_FRAME_RADIUS);
  return { center: sphere.center, radius };
}

function fitPerspectiveDistance(camera, radius, aspect) {
  const halfV = (camera.fov * DEG) / 2;
  const halfH = Math.atan(Math.tan(halfV) * aspect);
  return radius / Math.sin(Math.min(halfV, halfH));
}

function fitOrthographicZoom(camera, radius, aspect) {
  const halfHeight = (camera.top - camera.bottom) / 2;
  return (Math.min(1, aspect) * halfHeight) / radius;
}

export const viewportCaptureSpec = {
  description:
    AXES_NOTE +
    "Move the user's viewport camera and return a render of the new view as an image. " +
    'Use it to look at things and to show the user what you are working on. ' +
    'Includes the grid, gizmos and, in Edit Mode, the vertex/edge/face overlays and selection. ' +
    'With no view parameters it captures the current view unchanged. To look somewhere else, set target ' +
    '(frames objects, or "selection" for the selected objects / selected Edit Mode vertices) or lookAt (a point), ' +
    'and set the angle with view or azimuth/elevation. Azimuth turns about +Z from +X (front) toward +Y (right); ' +
    'elevation is degrees above the XY plane; the camera sits on that side of the target. ' +
    'Angles you omit keep the current view. The camera stays where you leave it. ',
  mutates: false,
  params: {
    width: {
      type: 'number',
      default: 960,
      description: `Image width in pixels, an integer from ${MIN_CAPTURE_EDGE} to ${MAX_CAPTURE_EDGE}.`,
    },
    height: {
      type: 'number',
      default: 540,
      description: `Image height in pixels, an integer from ${MIN_CAPTURE_EDGE} to ${MAX_CAPTURE_EDGE}.`,
    },
    format: {
      type: 'string',
      enum: ['webp', 'jpeg', 'png'],
      default: 'jpeg',
      description: 'Image encoding.',
    },
    target: {
      type: 'string|string[]',
      optional: true,
      description:
        'uuid or name of object(s) to frame, or "selection". Omit to keep the current look-at point. ' +
        'Cannot be combined with lookAt.',
    },
    lookAt: {
      type: 'vec3',
      optional: true,
      description:
        '[x, y, z] world point in metres to look at. Cannot be combined with target. ' +
        'Keeps the current distance unless distance is set.',
    },
    view: {
      type: 'string',
      enum: ['current', 'front', 'back', 'left', 'right', 'top', 'bottom'],
      default: 'current',
      description: 'Preset viewing angle. azimuth/elevation override its angles individually.',
    },
    azimuth: { type: 'number', optional: true, description: 'Degrees about +Z; 0 = front (+X), 90 = right (+Y).' },
    elevation: { type: 'number', optional: true, description: 'Degrees above the XY plane, -90 to 90. 90 = top.' },
    distance: {
      type: 'number',
      optional: true,
      description:
        'Camera distance from the look-at point in metres. Defaults to fitting target in frame, ' +
        'otherwise the current distance. Overrides margin. Has no effect on the size of an orthographic view.',
    },
    margin: {
      type: 'number',
      default: 1.15,
      description:
        'Framing margin when target is set, greater than 0; 1 fits the bounding sphere exactly, ' +
        'larger zooms out, below 1 crops in.',
    },
  },
  async run(params, editor) {
    const { width, height, format, target, lookAt, view, azimuth, elevation, distance, margin } = params;

    const w = validateEdge('width', width);
    const h = validateEdge('height', height);
    const captureAspect = w / h;

    if (!(margin > 0)) throw new Error(`viewport.capture: margin must be greater than 0 (got ${margin}).`);
    if (distance !== undefined && !(distance > 0)) {
      throw new Error('viewport.capture: distance must be greater than 0.');
    }

    const orbit = editor.controlsManager.orbit;
    const camera = orbit.camera;

    const viewportSize = editor.renderer.renderer.getSize(new THREE.Vector2());
    const viewportAspect = viewportSize.y > 0 ? viewportSize.x / viewportSize.y : captureAspect;
    const fitAspect = Math.min(captureAspect, viewportAspect);

    editor.sceneManager.mainScene.updateMatrixWorld(true);

    const { center, radius } = resolveFocus(editor, orbit, { target, lookAt });
    const { direction, up, azimuth: az, elevation: el } = resolveDirection(orbit, { view, azimuth, elevation });

    const frameRadius = radius !== null ? radius * margin : null;

    let dist;
    if (distance !== undefined) {
      dist = distance;
    } else if (frameRadius !== null) {
      dist = camera.isPerspectiveCamera
        ? fitPerspectiveDistance(camera, frameRadius, fitAspect)
        : Math.max(frameRadius * 4, 10);
    } else {
      dist = camera.position.distanceTo(orbit.target) || 10;
    }

    camera.position.copy(center).addScaledVector(direction, dist);
    camera.up.copy(up);
    camera.lookAt(center);

    if (camera.isOrthographicCamera && frameRadius !== null) {
      camera.zoom = fitOrthographicZoom(camera, frameRadius, fitAspect);
    }

    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    orbit.target.copy(center);
    orbit.eye.subVectors(camera.position, orbit.target);

    editor.signals.viewportCameraChanged.dispatch(camera);

    const blob = await editor.renderer.captureViewportRender(
      editor.sceneManager, camera, `image/${format}`, w, h
    );

    if (!blob) throw new Error('viewport.capture: the canvas produced no image.');

    const mimeType = blob.type || `image/${format}`;
    const data = await blobToBase64(blob);

    const edited = editor.editSelection.editedObject;

    const caption = [
      `${w}x${h} ${mimeType}`,
      `mode: ${editor.modeManager.currentMode}`,
      edited && `editing "${edited.name || edited.uuid}"`,
      `${camera.isOrthographicCamera ? 'orthographic' : 'perspective'} view`,
      `azimuth ${normalizeAzimuth(az).toFixed(1)}°, elevation ${el.toFixed(1)}°, distance ${dist.toFixed(2)}`,
      `looking at ${formatVec(center)}`,
      `camera at ${formatVec(camera.position)} (Z-up)`,
    ]
      .filter(Boolean)
      .join(', ');

    return { __image: { data, mimeType, caption } };
  },
};