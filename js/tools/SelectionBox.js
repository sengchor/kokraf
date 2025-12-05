import * as THREE from 'three';

export class SelectionBox {
  constructor(editor) {
    this.renderer = editor.renderer;

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

  computeFrustumFromSelection(camera) {
    if (!this.hasValidArea()) return null;

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

  getVerticesInFrustum(mesh, frustum) {
    const vertexHits = [];
    const position = mesh.geometry.getAttribute('position');

    const worldMatrix = mesh.matrixWorld;
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
}