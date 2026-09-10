const DEFAULT_THEME = {
  background: [0.247, 0.247, 0.247],
  tileFill: [0.204, 0.204, 0.204],
  gridLine: [0.290, 0.290, 0.290],
  tileBorder: [0.400, 0.400, 0.400, 1.0],

  face: [1.0, 1.0, 1.0, 0.15],
  faceSelected: [1.0, 1.0, 0.703, 0.388],

  edge: [0.784, 0.784, 0.784, 0.7],
  edgeSelected: [1.0, 1.0, 1.0, 1.0],

  point: [0.631, 0.631, 0.631, 1.0],
  pointSelected: [1.0, 1.0, 1.0, 1.0],

  boxStroke: [1.0, 0.847, 0.0, 1.0],
  boxFill: [1.0, 0.847, 0.0, 0.18]
};

const GRID_DIVISIONS = 10;

// Attribute locations are fixed across programs so divisor state stays
// predictable without VAOs.
const LOC = { pos: 0, corner: 0, a: 1, b: 2, flagVertex: 1, flagInstance: 3 };

// Per-vertex corners for an expanded line segment: x = t along the segment,
// y = side of the centre line.
const LINE_CORNERS = new Float32Array([
  0, -1,
  1, -1,
  0, 1,
  1, 1
]);

// Unit quad covering the 0..1 UV tile, as a triangle strip.
const TILE_QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);

// The four tile border segments, as line instances (ax, ay, bx, by).
const TILE_BORDER = new Float32Array([
  0, 0, 1, 0,
  1, 0, 1, 1,
  1, 1, 0, 1,
  0, 1, 0, 0
]);

const COMMON_VS = `
precision highp float;

uniform vec2 uResolution;   // CSS pixels
uniform vec2 uPan;          // CSS pixels
uniform float uZoom;        // CSS pixels per UV unit
uniform float uSpace;       // 0 = input is UV space, 1 = input is CSS pixels

vec2 toPixel(vec2 p) {
  vec2 uvPixel = vec2(uPan.x + p.x * uZoom, uPan.y - p.y * uZoom);
  return mix(uvPixel, p, uSpace);
}

vec4 toClip(vec2 pixel) {
  vec2 ndc = pixel / uResolution * 2.0 - 1.0;
  return vec4(ndc.x, -ndc.y, 0.0, 1.0);
}
`;

const SOLID_VS = COMMON_VS + `
attribute vec2 aPos;
attribute float aSelected;
varying float vSelected;

void main() {
  vSelected = aSelected;
  gl_Position = toClip(toPixel(aPos));
}
`;

const LINE_VS = COMMON_VS + `
attribute vec2 aCorner;
attribute vec2 aA;
attribute vec2 aB;
attribute float aSelected;   // per instance

uniform float uWidth;        // CSS pixels
uniform float uSelWidth;     // CSS pixels

varying float vSelected;

void main() {
  vSelected = aSelected;

  vec2 pa = toPixel(aA);
  vec2 pb = toPixel(aB);

  vec2 delta = pb - pa;
  float len = length(delta);
  vec2 dir = len > 0.0 ? delta / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);

  float width = mix(uWidth, uSelWidth, aSelected);
  vec2 p = mix(pa, pb, aCorner.x) + normal * (aCorner.y * width * 0.5);

  gl_Position = toClip(p);
}
`;

const POINT_VS = COMMON_VS + `
attribute vec2 aPos;
attribute float aSelected;
uniform float uSize;         // device pixels
varying float vSelected;

void main() {
  vSelected = aSelected;
  gl_Position = toClip(toPixel(aPos));
  gl_PointSize = uSize;
}
`;

// aSelected is constant across every vertex of an element, so the varying never
// interpolates to a fractional value and the mix is a straight pick.
const TINTED_FS = `
precision mediump float;
uniform vec4 uColor;
uniform vec4 uSelColor;
varying float vSelected;

void main() {
  gl_FragColor = mix(uColor, uSelColor, vSelected);
}
`;

const GRID_VS = COMMON_VS + `
attribute vec2 aPos;
varying vec2 vUV;
void main() {
  vUV = aPos;
  gl_Position = toClip(toPixel(aPos));
}
`;

// Procedural grid: distance to the nearest subdivision is computed analytically
// from uZoom, so no derivative extension is needed and the lines stay 1px at
// every zoom level. Indices 0 and N are skipped; the tile border is a separate
// draw so it can carry its own colour.
const GRID_FS = `
precision highp float;
varying vec2 vUV;
uniform float uZoom;
uniform float uDivisions;
uniform vec3 uFill;
uniform vec3 uLine;

void main() {
  vec2 k = vUV * uDivisions;
  vec2 idx = floor(k + 0.5);
  vec2 distPx = abs(k - idx) * (uZoom / uDivisions);

  vec2 inRange = step(vec2(0.5), idx) * (1.0 - step(vec2(uDivisions - 0.5), idx));
  vec2 cover = (1.0 - smoothstep(0.25, 1.0, distPx)) * inRange;

  gl_FragColor = vec4(mix(uFill, uLine, max(cover.x, cover.y)), 1.0);
}
`;

export class UVRenderer {
  constructor(canvas, { theme } = {}) {
    this.canvas = canvas;
    this.theme = { ...DEFAULT_THEME, ...theme };
    this.supported = false;

    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.pan = { x: 0, y: 0 };
    this.zoom = 1;

    this.counts = { faces: 0, edges: 0, points: 0 };

    const attrs = {
      alpha: false,
      antialias: true,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false
    };

    const gl =
      canvas.getContext('webgl2', attrs) ||
      canvas.getContext('webgl', attrs) ||
      canvas.getContext('experimental-webgl', attrs);

    if (!gl) {
      console.warn('UVRenderer: WebGL is unavailable.');
      return;
    }

    this.gl = gl;
    this.isWebGL2 =
      typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;

    this._angle = this.isWebGL2 ? null : gl.getExtension('ANGLE_instanced_arrays');
    if (!this.isWebGL2 && !this._angle) {
      console.warn('UVRenderer: instanced arrays are unavailable.');
      return;
    }

    this._init();
    this.supported = true;
  }

  // Re-create every GL object. Called from the constructor and again after a
  // context restore, since all resources are lost with the context.
  _init() {
    const gl = this.gl;

    this.programs = {
      solid: this._createProgram(SOLID_VS, TINTED_FS, {
        aPos: LOC.pos, aSelected: LOC.flagVertex
      }),
      line: this._createProgram(LINE_VS, TINTED_FS, {
        aCorner: LOC.corner, aA: LOC.a, aB: LOC.b, aSelected: LOC.flagInstance
      }),
      point: this._createProgram(POINT_VS, TINTED_FS, {
        aPos: LOC.pos, aSelected: LOC.flagVertex
      }),
      grid: this._createProgram(GRID_VS, GRID_FS, { aPos: LOC.pos })
    };

    this.buffers = {
      lineCorners: this._createBuffer(LINE_CORNERS, gl.STATIC_DRAW),
      tileQuad: this._createBuffer(TILE_QUAD, gl.STATIC_DRAW),
      tileBorder: this._createBuffer(TILE_BORDER, gl.STATIC_DRAW),

      faces: this._createBuffer(null, gl.STATIC_DRAW),
      faceFlags: this._createBuffer(null, gl.DYNAMIC_DRAW),
      edges: this._createBuffer(null, gl.STATIC_DRAW),
      edgeFlags: this._createBuffer(null, gl.DYNAMIC_DRAW),
      points: this._createBuffer(null, gl.STATIC_DRAW),
      pointFlags: this._createBuffer(null, gl.DYNAMIC_DRAW),

      screenTris: this._createBuffer(null, gl.DYNAMIC_DRAW),
      screenSegs: this._createBuffer(null, gl.DYNAMIC_DRAW)
    };

    this.counts = { faces: 0, edges: 0, points: 0 };

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(
      gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE, gl.ONE_MINUS_SRC_ALPHA
    );

    const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
    this._maxPointSize = range ? range[1] : 64;
  }

  restore() {
    if (!this.gl || this.gl.isContextLost()) return false;
    this._init();
    this.resize(this.width, this.height, this.dpr);
    this.supported = true;
    return true;
  }

  isContextLost() {
    return !this.gl || this.gl.isContextLost();
  }

  // Program and buffer plumbing
  _compile(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`UVRenderer: shader compile failed: ${log}`);
    }
    return shader;
  }

  _createProgram(vsSource, fsSource, attribBindings) {
    const gl = this.gl;
    const vs = this._compile(gl.VERTEX_SHADER, vsSource);
    const fs = this._compile(gl.FRAGMENT_SHADER, fsSource);

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);

    for (const [name, index] of Object.entries(attribBindings)) {
      gl.bindAttribLocation(program, index, name);
    }

    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`UVRenderer: program link failed: ${log}`);
    }

    const uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      uniforms[info.name] = gl.getUniformLocation(program, info.name);
    }

    return { program, uniforms };
  }

  _createBuffer(data, usage) {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    if (data) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    }
    return buffer;
  }

  _upload(buffer, data, usage) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data || new Float32Array(0), usage || gl.DYNAMIC_DRAW);
  }

  _divisor(location, value) {
    if (this.isWebGL2) this.gl.vertexAttribDivisor(location, value);
    else this._angle.vertexAttribDivisorANGLE(location, value);
  }

  _drawInstanced(mode, first, count, instances) {
    if (this.isWebGL2) this.gl.drawArraysInstanced(mode, first, count, instances);
    else this._angle.drawArraysInstancedANGLE(mode, first, count, instances);
  }

  _use(entry, space = 0) {
    const gl = this.gl;
    const u = entry.uniforms;

    gl.useProgram(entry.program);
    if (u.uResolution) gl.uniform2f(u.uResolution, this.width, this.height);
    if (u.uPan) gl.uniform2f(u.uPan, this.pan.x, this.pan.y);
    if (u.uZoom) gl.uniform1f(u.uZoom, this.zoom);
    if (u.uSpace) gl.uniform1f(u.uSpace, space);

    return u;
  }

  _bindPositions(location, buffer, size, divisor, stride = 0, offset = 0) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    this._divisor(location, divisor);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
  }

  // A null buffer falls back to the generic attribute value, which is how the
  // selection-box draws reuse the same programs with no flag data.
  _bindFlags(location, buffer, divisor) {
    const gl = this.gl;
    if (buffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(location);
      this._divisor(location, divisor);
      gl.vertexAttribPointer(location, 1, gl.UNSIGNED_BYTE, false, 0, 0);
    } else {
      gl.disableVertexAttribArray(location);
      this._divisor(location, 0);
      gl.vertexAttrib1f(location, 0);
    }
  }

  // Frame state
  resize(cssWidth, cssHeight, dpr = window.devicePixelRatio || 1) {
    if (!this.supported || cssWidth === 0 || cssHeight === 0) return;

    this.width = cssWidth;
    this.height = cssHeight;
    this.dpr = dpr;

    this.canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;

    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  setTransform(panX, panY, zoom) {
    this.pan.x = panX;
    this.pan.y = panY;
    this.zoom = zoom;
  }

  beginFrame() {
    const gl = this.gl;
    const [r, g, b] = this.theme.background;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  // Geometry. `geometry` is { faces, edges, points } of Float32Arrays: faces are
  // triangle positions (2 floats/vertex), edges are segments (4 floats/segment),
  // points are positions (2 floats/point). `flags` holds the matching Uint8Arrays
  // and defines the flag buffer sizes.
  setGeometry(geometry, flags) {
    if (!this.supported) return;
    const gl = this.gl;
    const g = geometry || {};
    const f = flags || {};

    this._upload(this.buffers.faces, g.faces, gl.STATIC_DRAW);
    this._upload(this.buffers.edges, g.edges, gl.STATIC_DRAW);
    this._upload(this.buffers.points, g.points, gl.STATIC_DRAW);

    this._upload(this.buffers.faceFlags, f.faces, gl.DYNAMIC_DRAW);
    this._upload(this.buffers.edgeFlags, f.edges, gl.DYNAMIC_DRAW);
    this._upload(this.buffers.pointFlags, f.points, gl.DYNAMIC_DRAW);

    this.counts.faces = g.faces ? g.faces.length / 2 : 0;
    this.counts.edges = g.edges ? g.edges.length / 4 : 0;
    this.counts.points = g.points ? g.points.length / 2 : 0;
  }

  // Selection change: one small byte upload per stream, no position traffic.
  updateFlags(flags) {
    if (!this.supported || !flags) return;
    const gl = this.gl;

    if (flags.faces) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.faceFlags);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, flags.faces);
    }
    if (flags.edges) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.edgeFlags);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, flags.edges);
    }
    if (flags.points) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.pointFlags);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, flags.points);
    }
  }

  updatePositions({ faces, edges, points } = {}) {
    if (!this.supported) return;
    const gl = this.gl;

    if (faces) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.faces);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, faces);
    }
    if (edges) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.edges);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, edges);
    }
    if (points) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.points);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, points);
    }
  }

  // Draw calls
  _drawTriangles(buffer, flagBuffer, vertexCount, color, selColor, space = 0) {
    if (vertexCount === 0) return;
    const gl = this.gl;
    const u = this._use(this.programs.solid, space);

    gl.uniform4fv(u.uColor, color);
    gl.uniform4fv(u.uSelColor, selColor || color);

    this._bindPositions(LOC.pos, buffer, 2, 0);
    this._bindFlags(LOC.flagVertex, flagBuffer, 0);

    gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
  }

  _drawLines(buffer, flagBuffer, segmentCount, width, selWidth, color, selColor, space = 0) {
    if (segmentCount === 0) return;
    const gl = this.gl;
    const u = this._use(this.programs.line, space);

    gl.uniform4fv(u.uColor, color);
    gl.uniform4fv(u.uSelColor, selColor || color);
    gl.uniform1f(u.uWidth, width);
    gl.uniform1f(u.uSelWidth, selWidth || width);

    this._bindPositions(LOC.corner, this.buffers.lineCorners, 2, 0);
    this._bindPositions(LOC.a, buffer, 2, 1, 16, 0);
    this._bindPositions(LOC.b, buffer, 2, 1, 16, 8);
    this._bindFlags(LOC.flagInstance, flagBuffer, 1);

    this._drawInstanced(gl.TRIANGLE_STRIP, 0, 4, segmentCount);

    this._divisor(LOC.a, 0);
    this._divisor(LOC.b, 0);
    gl.disableVertexAttribArray(LOC.a);
    gl.disableVertexAttribArray(LOC.b);
  }

  _drawPoints(buffer, flagBuffer, pointCount, size, color, selColor) {
    if (pointCount === 0) return;
    const gl = this.gl;
    const u = this._use(this.programs.point, 0);

    gl.uniform4fv(u.uColor, color);
    gl.uniform4fv(u.uSelColor, selColor || color);
    gl.uniform1f(u.uSize, Math.min(size * this.dpr, this._maxPointSize));

    this._bindPositions(LOC.pos, buffer, 2, 0);
    this._bindFlags(LOC.flagVertex, flagBuffer, 0);

    gl.drawArrays(gl.POINTS, 0, pointCount);
  }

  drawGrid() {
    if (!this.supported) return;
    const gl = this.gl;
    const u = this._use(this.programs.grid, 0);

    gl.uniform1f(u.uDivisions, GRID_DIVISIONS);
    gl.uniform3fv(u.uFill, this.theme.tileFill);
    gl.uniform3fv(u.uLine, this.theme.gridLine);

    this._bindPositions(LOC.pos, this.buffers.tileQuad, 2, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    this._drawLines(
      this.buffers.tileBorder, null, 4,
      1, 1,
      this.theme.tileBorder, this.theme.tileBorder
    );
  }

  drawMesh({ edgeWidth = 1, selEdgeWidth = 1.6, pointSize = 5, showPoints = false } = {}) {
    if (!this.supported) return;
    const t = this.theme;
    const b = this.buffers;
    const c = this.counts;

    this._drawTriangles(b.faces, b.faceFlags, c.faces, t.face, t.faceSelected);

    this._drawLines(
      b.edges, b.edgeFlags, c.edges,
      edgeWidth, selEdgeWidth,
      t.edge, t.edgeSelected
    );

    if (showPoints) {
      this._drawPoints(b.points, b.pointFlags, c.points, pointSize, t.point, t.pointSelected);
    }
  }

  // Screen-space box, in CSS pixels.
  drawBox(minX, minY, maxX, maxY) {
    if (!this.supported) return;

    this._upload(this.buffers.screenTris, new Float32Array([
      minX, minY, maxX, minY, minX, maxY,
      maxX, minY, maxX, maxY, minX, maxY
    ]));
    this._upload(this.buffers.screenSegs, new Float32Array([
      minX, minY, maxX, minY,
      maxX, minY, maxX, maxY,
      maxX, maxY, minX, maxY,
      minX, maxY, minX, minY
    ]));

    this._drawTriangles(this.buffers.screenTris, null, 6, this.theme.boxFill, null, 1);
    this._drawLines(
      this.buffers.screenSegs, null, 4,
      1, 1,
      this.theme.boxStroke, null, 1
    );
  }

  dispose() {
    if (!this.gl) return;
    const gl = this.gl;

    for (const entry of Object.values(this.programs || {})) gl.deleteProgram(entry.program);
    for (const buffer of Object.values(this.buffers || {})) gl.deleteBuffer(buffer);

    this.programs = null;
    this.buffers = null;
    this.supported = false;
  }
}