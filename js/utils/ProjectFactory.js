import { MathUtils } from 'three';

export function createEmptyProject(projectId) {
  return {
    metadata: {
      version: 1,
      type: "Project"
    },

    projectId: projectId,
    projectName: null,

    scene: {
      metadata: {
        version: 4.6,
        type: "Object",
        generator: "Object3D.toJSON"
      },
      object: {
        uuid: MathUtils.generateUUID(),
        type: "Scene",
        layers: 1,
        matrix: [
          1,0,0,0,
          0,1,0,0,
          0,0,1,0,
          0,0,0,1
        ],
        up: [0, 1, 0],
        background: 3881787,
        backgroundRotation: [0, 0, 0, "XYZ"],
        environmentRotation: [0, 0, 0, "XYZ"]
      }
    },

    camera: {
      metadata: {
        version: 4.6,
        type: "Object",
        generator: "Object3D.toJSON"
      },
      object: {
        uuid: MathUtils.generateUUID(),
        type: "PerspectiveCamera",
        name: "CAMERA",
        layers: 1,
        matrix: [
          0.8574929257125442, 0, -0.5144957554275266, 0,
          -0.16692446522239712, 0.9459053029269173, -0.2782074420373286, 0,
          0.48666426339228763, 0.3244428422615251, 0.8111071056538127, 0,
          3, 2, 5, 1
        ],
        up: [0, 1, 0],
        fov: 50,
        zoom: 1,
        near: 0.1,
        far: 1000,
        focus: 10,
        aspect: 1.6358974358974359,
        filmGauge: 35,
        filmOffset: 0
      }
    },

    viewportControls: {
      mode: "object",
      editedObjectUuid: null,
      subSelectionMode: "vertex"
    },

    controlsManager: {
      orbit: {
        target: [0, 0, 0],
        eye: [0, 0, 0]
      }
    }
  };
}