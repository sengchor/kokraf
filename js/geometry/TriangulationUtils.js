import * as THREE from 'three';

export function computePlaneNormal(verts) {
  if (verts.length < 3) return new THREE.Vector3(0, 0, 1);

  const normal = new THREE.Vector3(0, 0, 0);

  for (let i = 0; i < verts.length; i++) {
    const current = verts[i].position;
    const next = verts[(i + 1) % verts.length].position;

    normal.x += (current.y - next.y) * (current.z + next.z);
    normal.y += (current.z - next.z) * (current.x + next.x);
    normal.z += (current.x - next.x) * (current.y + next.y);
  }

  return normal.normalize();
}

export function projectTo2D(verts, normal) {
  verts = verts.filter(v => v !== undefined && v !== null);
  if (verts.length === 0) return [];

  let tangent = new THREE.Vector3(1, 0, 0);
  if (Math.abs(normal.dot(tangent)) > 0.99) tangent.set(0, 1, 0);

  const u = new THREE.Vector3().crossVectors(normal, tangent).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();

  const origin = verts[0].position;
  const flat = [];

  for (let vert of verts) {
      const p = new THREE.Vector3().subVectors(vert.position, origin);
      flat.push(p.dot(u), p.dot(v));
  }

  return flat;
}

export function removeCollinearVertices(verts, angleEpsilon = 1e-4) {
  if (verts.length <= 3) return verts.slice();

  const toVec3 = v =>
    new THREE.Vector3(v.position.x, v.position.y, v.position.z);

  const filtered = [];

  for (let i = 0; i < verts.length; i++) {
    const prev = toVec3(verts[(i - 1 + verts.length) % verts.length]);
    const curr = toVec3(verts[i]);
    const next = toVec3(verts[(i + 1) % verts.length]);

    const v1 = curr.clone().sub(prev).normalize();
    const v2 = next.clone().sub(curr).normalize();

    const dot = v1.dot(v2);

    if (Math.abs(dot) < 1 - angleEpsilon) {
      filtered.push(verts[i]);
    }
  }

  return filtered;
}