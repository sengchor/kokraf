export function duplicateObject(object) {
  const clone = object.clone(true);

  clone.traverse(child => {
    if (child.isMesh) {
      if (child.geometry) {
        child.geometry = child.geometry.clone();
      }

      if (child.material) {
        child.material = Array.isArray(child.material)
          ? child.material.map(m => m.clone()) : child.material.clone();
      }
    }
  });

  return clone;
}