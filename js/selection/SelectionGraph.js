/**
 * Pure helpers that derive the full vertex/edge/face selection from a
 * selection in one element type. Safe to call with a null meshData.
 */

export function resolveSelectionGraphFromVertices(meshData, vertexSet) {
  const edgeSet = new Set();
  const faceSet = new Set();
  if (!meshData) return { edgeSet, faceSet };

  for (const edge of meshData.edges.values()) {
    if (vertexSet.has(edge.v1Id) && vertexSet.has(edge.v2Id)) {
      edgeSet.add(edge.id);
    }
  }

  for (const face of meshData.faces.values()) {
    let allVerticesSelected = true;

    for (const vId of face.vertexIds) {
      if (!vertexSet.has(vId)) {
        allVerticesSelected = false;
        break;
      }
    }

    if (allVerticesSelected) {
      faceSet.add(face.id);
    }
  }

  return { edgeSet, faceSet };
}

export function resolveSelectionGraphFromEdges(meshData, edgeSet) {
  const vertexSet = new Set();
  const faceSet = new Set();
  if (!meshData) return { vertexSet, faceSet };

  for (const edgeId of edgeSet) {
    const edge = meshData.edges.get(edgeId);
    if (!edge) continue;

    vertexSet.add(edge.v1Id);
    vertexSet.add(edge.v2Id);
  }

  for (const face of meshData.faces.values()) {
    let allEdgesSelected = true;

    for (const eId of face.edgeIds) {
      if (!edgeSet.has(eId)) {
        allEdgesSelected = false;
        break;
      }
    }

    if (allEdgesSelected) {
      faceSet.add(face.id);
    }
  }

  return { vertexSet, faceSet };
}

export function resolveSelectionGraphFromFaces(meshData, faceSet) {
  const vertexSet = new Set();
  const edgeSet = new Set();
  if (!meshData) return { vertexSet, edgeSet };

  for (const faceId of faceSet) {
    const face = meshData.faces.get(faceId);
    if (!face) continue;

    for (const edgeId of face.edgeIds) {
      edgeSet.add(edgeId);
    }

    for (const vId of face.vertexIds) {
      vertexSet.add(vId);
    }
  }

  return { vertexSet, edgeSet };
}