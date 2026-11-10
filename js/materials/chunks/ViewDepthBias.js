export const VIEW_DEPTH_BIAS = `
  {
    float viewHeight = 2.0 * gl_Position.w / projectionMatrix[1][1];
    vec3 p = biasSrc.xyz;
    p.z += depthBias * viewHeight;
    vec4 bc = projectionMatrix * vec4(p, 1.0);
    gl_Position.z = (bc.z / bc.w) * gl_Position.w;
  }
`;