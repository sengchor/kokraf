import * as THREE from 'three';

export class VertexEditor {
  constructor(object3D) {
    this.object = object3D;
    this.geometry = object3D.geometry;
    this.positionAttr = this.geometry.attributes.position;
  }

  moveVertex(index, delta) {
    const x = this.positionAttr.getX(index) + delta.x;
    const y = this.positionAttr.getY(index) + delta.y;
    const z = this.positionAttr.getZ(index) + delta.z;

    this.positionAttr.setXYZ(index, x, y, z);
    this.positionAttr.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  setVertexWorldPosition(index, worldPosition) {
    if (!this.object || !this.positionAttr) return;

    const localPosition = worldPosition.clone().applyMatrix4(
      new THREE.Matrix4().copy(this.object.matrixWorld).invert()
    );

    this.positionAttr.setXYZ(index, localPosition.x, localPosition.y, localPosition.z);
    this.positionAttr.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();
  }

  getVertexPosition(index) {
    return {
      x: this.positionAttr.getX(index),
      y: this.positionAttr.getY(index),
      z: this.positionAttr.getZ(index)
    };
  }

  addVertexPoints(selectedObject) {
    const geometry = selectedObject.geometry;
    const pointMaterial = new THREE.PointsMaterial({
      size: 3.5,
      sizeAttenuation: false,
      color: 0x000000
    });

    const pointCloud = new THREE.Points(geometry, pointMaterial);
    pointCloud.userData.isEditorOnly = true;
    pointCloud.name = '__VertexPoints';
    selectedObject.add(pointCloud);
  }

  removeVertexPoints(selectedObject) {
    const pointCloud = selectedObject.getObjectByName('__VertexPoints');
    if (pointCloud) {
      selectedObject.remove(pointCloud);
      pointCloud.geometry.dispose();
      pointCloud.material.dispose();
    }
  }

  applyBarycentricCoordinates(object) {
    let geometry = object.geometry;

    if (geometry.index) {
      geometry = geometry.toNonIndexed();
      object.geometry = geometry;
    }

    const count = geometry.attributes.position.count;
    const barycentric = [];

    for (let i = 0; i < count; i += 3) {
      barycentric.push(1, 0, 0);
      barycentric.push(0, 1, 0);
      barycentric.push(0, 0, 1);
    }

    const barycentricAttr = new THREE.Float32BufferAttribute(barycentric, 3);
    geometry.setAttribute('aBarycentric', barycentricAttr);
  }
}