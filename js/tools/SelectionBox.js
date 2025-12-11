import * as THREE from 'three';

export class SelectionBox {
  constructor(editor) {
    this.editor = editor;
    this.renderer = editor.renderer;
    this.cameraManager = editor.cameraManager;

    this.element = document.createElement("div");
    this.element.id = "selectionBox";
    document.body.appendChild(this.element);

    this.start = new THREE.Vector2();
    this.end = new THREE.Vector2();

    this.dragging = false;
  }

  startSelection(x, y) {
    this.start.set(x, y);
    this.end.set(x, y);
    this.dragging = true;
  }

  updateSelection(x, y) {
    this.end.set(x, y);

    const left = Math.min(this.start.x, this.end.x);
    const top = Math.min(this.start.y, this.end.y);
    const width = Math.abs(this.start.x - this.end.x);
    const height = Math.abs(this.start.y - this.end.y);

    this.element.style.left = `${left}px`;
    this.element.style.top = `${top}px`;
    this.element.style.width = `${width}px`;
    this.element.style.height = `${height}px`;
    this.element.style.display = "block";
  }

  finishSelection() {
    this.dragging = false;
    this.element.style.display = "none";
  }

  hasValidArea() {
    const width = Math.abs(this.start.x - this.end.x);
    const height = Math.abs(this.start.y - this.end.y);
    return width > 1 && height > 1;
  }

  computeFrustumFromSelection() {
    if (!this.hasValidArea()) return null;

    const camera = this.cameraManager.camera;
    const rect = this.renderer.domElement.getBoundingClientRect();

    const x1 = (this.start.x - rect.left) / rect.width * 2 - 1;
    const y1 = - (this.start.y - rect.top) / rect.height * 2 + 1;

    const x2 = (this.end.x - rect.left) / rect.width * 2 - 1;
    const y2 = - (this.end.y - rect.top) / rect.height * 2 + 1;

    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);

    const ndc = {
      near: [
        new THREE.Vector3(minX, minY, -1),
        new THREE.Vector3(minX, maxY, -1),
        new THREE.Vector3(maxX, maxY, -1),
        new THREE.Vector3(maxX, minY, -1)
      ],
      far: [
        new THREE.Vector3(minX, minY,  1),
        new THREE.Vector3(minX, maxY,  1),
        new THREE.Vector3(maxX, maxY,  1),
        new THREE.Vector3(maxX, minY,  1)
      ]
    };

    const nearWorld = ndc.near.map(v => v.clone().unproject(camera));
    const farWorld  = ndc.far.map(v => v.clone().unproject(camera));

    const camPos = new THREE.Vector3();
    camera.getWorldPosition(camPos);

    const centerNDC = new THREE.Vector3((minX + maxX) * 0.5, (minY + maxY) * 0.5, 0);
    const centerWorld = centerNDC.clone().unproject(camera);

    // Side planes
    const planes = [];
    const leftP   = new THREE.Plane().setFromCoplanarPoints(camPos, nearWorld[1], nearWorld[0]);
    const rightP  = new THREE.Plane().setFromCoplanarPoints(camPos, nearWorld[3], nearWorld[2]);
    const topP    = new THREE.Plane().setFromCoplanarPoints(camPos, nearWorld[2], nearWorld[1]);
    const bottomP = new THREE.Plane().setFromCoplanarPoints(camPos, nearWorld[0], nearWorld[3]);

    // near and far planes use three points on the plane
    const nearPlane = new THREE.Plane().setFromCoplanarPoints(nearWorld[0], nearWorld[1], nearWorld[2]);
    const farPlane  = new THREE.Plane().setFromCoplanarPoints(farWorld[2], farWorld[1], farWorld[0]);

    planes.push(leftP, rightP, topP, bottomP, nearPlane, farPlane);

    // Ensure all plane normals point *into* the frustum (towards centerWorld)
    for (const p of planes) {
      if (p.distanceToPoint(centerWorld) < 0) {
        p.negate();
      }
    }

    return new THREE.Frustum(...planes);
  }

  getVerticesInFrustum(vertexPoints, frustum) {
    const vertexHits = [];
    const position = vertexPoints.geometry.getAttribute('position');

    const worldMatrix = vertexPoints.matrixWorld;
    const vertex = new THREE.Vector3();

    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i);
      const worldPos = vertex.clone().applyMatrix4(worldMatrix);

      if (frustum.containsPoint(worldPos)) {
        vertexHits.push({
          index: i,
          point: worldPos
        });
      }
    }
    
    return vertexHits;
  }

  getEdgesInFrustum(edgeLines, frustum) {
    const edgeHits = [];

    const camera = this.cameraManager.camera;
    const camPos = new THREE.Vector3();
    camera.getWorldPosition(camPos);

    for (const edgeLine of edgeLines) {
      const pos = edgeLine.geometry.attributes.position.array;

      const a = new THREE.Vector3(pos[0], pos[1], pos[2]).applyMatrix4(edgeLine.matrixWorld);
      const b = new THREE.Vector3(pos[3], pos[4], pos[5]).applyMatrix4(edgeLine.matrixWorld);

      const aInside = frustum.containsPoint(a);
      const bInside = frustum.containsPoint(b);

      const addEdgeHit = (type) => {
        const hitPoint = this.getSafePointOnEdge(a, b, camPos);
        edgeHits.push({
          type,
          index: edgeLine.userData.edge?.id ?? null,
          distance: hitPoint.distanceTo(camPos),
          object: edgeLine,
          point: hitPoint,
        });
      };

      if (aInside && bInside) {
        addEdgeHit('endpoint');
        continue;
      }

      if (this.edgeClipsFrustum(a, b, frustum)) {
        addEdgeHit('clipping');
      }
    }

    return edgeHits;
  }

  getFacesInFrustum(faceMesh, frustum) {
    if (!faceMesh || !faceMesh.geometry) return [];

    const geom = faceMesh.geometry;
    const pos = geom.attributes.position.array;
    const matrixWorld = faceMesh.matrixWorld;

    const faceRanges = faceMesh.userData.faceRanges;
    const faceHits = [];

    const camera = this.cameraManager.camera;
    const camPos = new THREE.Vector3();
    camera.getWorldPosition(camPos);

    const v = new THREE.Vector3();

    for (let range of faceRanges) {
      const { start, count, faceId } = range;
      const startIndex = start * 3;
      const endIndex = (start + count) * 3;

      const worldPoints = [];
      for (let i = startIndex; i < endIndex; i += 3) {
        v.fromArray(pos, i).applyMatrix4(matrixWorld);
        worldPoints.push(v.clone());
      }

      const clipped = this.faceClipsFrustum(worldPoints, frustum);

      if (clipped && clipped.length > 0) {
        let closestVertex = clipped[0];
        let minDist = clipped[0].distanceTo(camPos);

        for (let p of clipped) {
          const d = p.distanceTo(camPos);
          if (d < minDist) {
            minDist = d;
            closestVertex = p;
          }
        }

        faceHits.push({
          index: faceId,
          point: closestVertex,
          distance: minDist,
        });
      }
    }

    return faceHits;
  }

  getObjectsInFrustum(objects, frustum) {
    const hits = [];

    for (const obj of objects) {
      if (!obj.geometry) continue;

      if (!obj.geometry.boundingBox) {
        obj.geometry.computeBoundingBox();
      }

      const worldBB = new THREE.Box3().copy(obj.geometry.boundingBox);
      worldBB.applyMatrix4(obj.matrixWorld);

      const target = obj.userData.object || obj;

      if (frustum.intersectsBox(worldBB)) {
        hits.push({ object: target });
      }
    }

    return hits;
  }

  getSafePointOnEdge(a, b, camPos) {
    const hitPoint = this.closestPointOnSegmentToPoint(a, b, camPos);

    const ab = new THREE.Vector3().subVectors(b, a);
    const dotABAB = ab.dot(ab);

    if (dotABAB < 1e-6) {
      // Edge is degenerate — return its midpoint
      return new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    }

    let t = hitPoint.clone().sub(a).dot(ab) / dotABAB;

    // Clamp strictly inside the segment to avoid endpoints
    t = Math.min(Math.max(t, 0.05), 0.95);

    return new THREE.Vector3().lerpVectors(a, b, t);
  }

  closestPointOnSegmentToPoint(a, b, p) {
    const ab = new THREE.Vector3().subVectors(b, a);
    const ap = new THREE.Vector3().subVectors(p, a);

    const t = THREE.MathUtils.clamp(ap.dot(ab) / ab.lengthSq(), 0, 1);

    return new THREE.Vector3().copy(a).add(ab.multiplyScalar(t));
  }

  edgeClipsFrustum(a, b, frustum) {
    const eps = 1e-6;

    if (frustum.containsPoint(a) || frustum.containsPoint(b)) {
      return true;
    }

    for (const plane of frustum.planes) {
      const da = plane.distanceToPoint(a);
      const db = plane.distanceToPoint(b);

      if (da * db < -eps || Math.abs(da) < eps || Math.abs(db) < eps) {
        const t = da / (da - db);
        if (t >= 0 && t <= 1) {
          const hit = new THREE.Vector3().lerpVectors(a, b, t);

          let inside = true;
          for (const p of frustum.planes) {
            if (p.distanceToPoint(hit) < -eps) {
              inside = false;
              break;
            }
          }

          if (inside) return true;
        }
      }
    }
    return false;
  }

  clipPolygonWithPlane(points, plane) {
    const result = [];
    const len = points.length;

    for (let i = 0; i < len; i++) {
      const a = points[i];
      const b = points[(i + 1) % len];

      const da = plane.distanceToPoint(a);
      const db = plane.distanceToPoint(b);

      const aInside = (da >= 0);
      const bInside = (db >= 0);

      // A inside, B inside -> keep B
      if (aInside && bInside) {
        result.push(b.clone());
      }
      // A inside, B outside -> keep intersection
      else if (aInside && !bInside) {
        const t = da / (da - db);
        const hit = a.clone().lerp(b, t);
        result.push(hit);
      }
      // A outside, B inside -> add intersection + B
      else if (!aInside && bInside) {
        const t = da / (da -db);
        const hit = a.clone().lerp(b, t);
        result.push(hit);
        result.push(b.clone());
      }
    }

    return result;
  }

  faceClipsFrustum(points, frustum) {
    let clipped = points.map(p => p.clone());

    for (let plane of frustum.planes) {
      clipped = this.clipPolygonWithPlane(clipped, plane);
      if (clipped.length === 0) return null;
    }

    return clipped;
  }
}