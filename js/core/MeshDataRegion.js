import { MeshData } from './MeshData.js';

export const MeshDataRegion = {
  expand(meshData, seeds, depth = 2) {
    let vSet = new Set(seeds.vertexIds || []);
    let eSet = new Set(seeds.edgeIds || []);
    let fSet = new Set(seeds.faceIds || []);

    for (let i = 0; i < depth; i++) {
      const nextV = new Set(vSet);
      const nextE = new Set(eSet);
      const nextF = new Set(fSet);

      for (const fId of fSet) {
        const face = meshData.faces.get(fId);
        if (!face) continue;
        for (const vId of face.vertexIds) {
          nextV.add(vId);
        }
        for (const eId of face.edgeIds) {
          nextE.add(eId);
        }
      }

      for (const eId of eSet) {
        const edge = meshData.edges.get(eId);
        if (!edge) continue;
        nextV.add(edge.v1Id);
        nextV.add(edge.v2Id);
        for (const fId of edge.faceIds) {
          nextF.add(fId);
        }
      }

      for (const vId of vSet) {
        const vertex = meshData.vertices.get(vId);
        if (!vertex) continue;
        for (const eId of vertex.edgeIds) {
          nextE.add(eId);
        }
        for (const fId of vertex.faceIds) {
          nextF.add(fId);
        }
      }

      vSet = nextV;
      eSet = nextE;
      fSet = nextF;
    }

    return { vertexIds: vSet, edgeIds: eSet, faceIds: fSet };
  },

  snapshot(meshData, ids) {
    const snapMap = (map, idSet, serialize) => {
      const out = {};
      for (const id of idSet) {
        const el = map.get(id);
        out[id] = el ? serialize(el) : null;
      }
      return out;
    };

    return {
      vertices: snapMap(meshData.vertices, ids.vertexIds, MeshData.serializeVertex),
      edges: snapMap(meshData.edges, ids.edgeIds, MeshData.serializeEdge),
      faces: snapMap(meshData.faces, ids.faceIds, MeshData.serializeFace),
    };
  },

  idsOf(snapshot) {
    return {
      vertexIds: Object.keys(snapshot.vertices).map(Number),
      edgeIds: Object.keys(snapshot.edges).map(Number),
      faceIds: Object.keys(snapshot.faces).map(Number),
    };
  },

  apply(meshData, snapshot) {
    for (const [key, data] of Object.entries(snapshot.edges)) {
      const id = Number(key);
      const existing = meshData.edges.get(id);
      if (existing) meshData.edgeKeyMap.delete(meshData._getEdgeKey(existing.v1Id, existing.v2Id));

      if (data === null) {
        meshData.edges.delete(id);
      } else {
        const edge = MeshData.rehydrateEdge(data);
        meshData.edges.set(id, edge);
        meshData.edgeKeyMap.set(meshData._getEdgeKey(edge.v1Id, edge.v2Id), edge);
      }
    }

    for (const [key, data] of Object.entries(snapshot.faces)) {
      const id = Number(key);
      const existing = meshData.faces.get(id);
      if (existing) meshData.faceKeyMap.delete(meshData._getFaceKey(existing.vertexIds));

      if (data === null) {
        meshData.faces.delete(id);
      } else {
        const face = MeshData.rehydrateFace(data);
        meshData.faces.set(id, face);
        meshData.faceKeyMap.set(meshData._getFaceKey(face.vertexIds), face);
      }
    }

    for (const [key, data] of Object.entries(snapshot.vertices)) {
      const id = Number(key);
      if (data === null) meshData.vertices.delete(id);
      else meshData.vertices.set(id, MeshData.rehydrateVertex(data));
    }
  },

  captureNewElements(meshData, startElements, beforeSnapshot) {
    const { startVertexId, startEdgeId, startFaceId } = startElements;

    for (let id = startVertexId; id < meshData.nextVertexId; id++) {
      if (meshData.vertices.has(id) && !(id in beforeSnapshot.vertices)) {
        beforeSnapshot.vertices[id] = null;
      }
    }

    for (let id = startEdgeId; id < meshData.nextEdgeId; id++) {
      if (meshData.edges.has(id) && !(id in beforeSnapshot.edges)) {
        beforeSnapshot.edges[id] = null;
      }
    }

    for (let id = startFaceId; id < meshData.nextFaceId; id++) {
      if (meshData.faces.has(id) && !(id in beforeSnapshot.faces)) {
        beforeSnapshot.faces[id] = null;
      }
    }
  }
};