/** @fileoverview Joint-weighted character mesh: hair, fabric and legs swing as parts, never as a cursor-driven ripple. */
const W = 1090, H = 1443;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const v = clamp((x - a) / (b - a), 0, 1); return v * v * (3 - 2 * v); };

const PARTS = [
  { name: 'head', pivot: [540, 705] },
  { name: 'left-lock', pivot: [290, 270], feather: 30, polygon: [[130,240],[282,250],[328,464],[300,626],[382,713],[332,770],[171,760],[119,657]] },
  { name: 'right-lock', pivot: [835, 238], feather: 30, polygon: [[840,235],[1040,290],[1051,674],[881,737],[739,682],[783,594],[812,441]] },
  { name: 'back-hair-right', pivot: [780, 724], polygon: [[827,699],[978,728],[1060,845],[1057,993],[931,1090],[823,1147],[777,1085],[898,1006],[936,902],[875,783]] },
  { name: 'back-hair-left', pivot: [294, 1128], polygon: [[223,1108],[305,1140],[300,1260],[408,1312],[412,1355],[299,1393],[156,1358],[157,1215]] },
  { name: 'cloak-left', pivot: [340, 859], feather: 40, polygon: [[307,859],[426,941],[419,1080],[371,1197],[439,1316],[390,1392],[262,1263],[65,1170],[47,1085],[160,967]] },
  { name: 'cloak-right', pivot: [755, 811], feather: 40, polygon: [[730,800],[845,815],[934,930],[896,1043],[882,1227],[765,1272],[703,1120],[678,950]] },
  { name: 'skirt', pivot: [537, 827], feather: 32, polygon: [[402,817],[672,815],[770,1012],[746,1095],[583,1098],[426,1114],[323,1061]] },
  // The polygons include the whole stocking and shoe, with room for a soft
  // outside margin. A mask ending at the shoe centre only bends a small patch.
  { name: 'leg-left', pivot: [454, 1063], feather: 38, polygon: [[388,1042],[526,1042],[595,1270],[619,1398],[474,1422],[414,1235]] },
  { name: 'leg-right', pivot: [564, 1066], feather: 38, polygon: [[510,1037],[654,1045],[726,1200],[753,1335],[653,1380],[536,1240]] },
  // Follow the pink fringe itself. The loose centre moves below a fixed root;
  // eye guards below keep the neighbouring lashes/skin out of this joint.
  { name: 'fringe', pivot: [500, 278], feather: 24, polygon: [[406,294],[560,257],[599,304],[608,397],[583,439],[548,463],[510,485],[470,502],[444,479],[422,437],[397,403]] },
  { name: 'top-tuft', pivot: [832, 202], feather: 24, polygon: [[765,130],[856,113],[897,118],[941,111],[966,140],[950,204],[889,240],[799,226]] },
];

function polygonWeight(x, y, points, feather = 18) {
  let inside = false, distance = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[j], [bx, by] = points[i];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
    const dx = bx - ax, dy = by - ay;
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
    distance = Math.min(distance, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return smooth(-feather, feather, inside ? distance : -distance);
}

function weightsForPoint(x, y) {
  const weights = PARTS.map((part, index) => index === 0
    ? 1 - smooth(680, 765, y)
    : polygonWeight(x, y, part.polygon, part.feather));
  // Broad attachment transitions preserve shoulder/waist/hip continuity while
  // allowing the loose hems and complete shoes to travel visibly at pet size.
  weights[5] *= smooth(875, 975, y); weights[6] *= smooth(840, 950, y);
  weights[7] *= smooth(830, 940, y);
  weights[8] *= smooth(1060, 1150, y); weights[9] *= smooth(1060, 1150, y);
  const legs = weights[8] + weights[9];
  if (legs > 1) { weights[8] /= legs; weights[9] /= legs; }
  weights[10] *= smooth(310, 410, y);
  // These guards cover the complete eye artwork, including the upper lashes.
  // They fade inside the fringe rather than dragging the eyes with its tips.
  const eyes = smooth(1, 1.35, Math.hypot((x - 411) / 81, (y - 548) / 91))
    * smooth(1, 1.35, Math.hypot((x - 647) / 95, (y - 519) / 110));
  // Eyebrows overlap the pink fringe in the original drawing. Keep their whole
  // strokes attached to the face, with enough falloff for the stronger sway.
  const browGuard = (cx, cy, rx, ry) => smooth(0, 30, Math.hypot(Math.max(0, Math.abs(x-cx)-rx), Math.max(0, Math.abs(y-cy)-ry)));
  const brows = browGuard(400, 422, 28, 10) * browGuard(589, 389, 55, 10)
    * browGuard(641, 414, 30, 10);
  for (const index of [1, 2, 10]) weights[index] *= eyes * brows;
  return weights;
}

/** Independent idle joint angles in radians; the mouse never drives hair, cloth or leg movement. */
export function jointPose(time = 0, enabled = true) {
  if (!enabled) return new Float32Array(PARTS.length);
  const t = Number.isFinite(time) ? time : 0;
  return new Float32Array([
    Math.sin(t * .92) * .0045,
    Math.sin(t * .94 - .4) * .055,
    Math.sin(t * .89 + .65) * .058,
    Math.sin(t * 1.05 - .85) * .038 + Math.sin(t * 1.72) * .006,
    Math.sin(t * 1.05 - 1.2) * .034,
    // About 7 seconds per cycle, with different phases for fabric and feet.
    // 3–4 degree leg arcs produce visible travel even in a 420 × 560 window.
    Math.sin(t * .90 - .7) * .050,
    Math.sin(t * .86 - 1.1) * -.052,
    Math.sin(t * .88 - .35) * .050,
    Math.sin(t * .90 - .4) * .0655,
    Math.sin(t * .86 + 1.15) * -.070,
    // A wider, softly attached fringe arc stays legible at desktop size.
    // Its guarded tip travels about 10.5 px in the default 420 px window.
    Math.sin(t * .92 - .25) * .105,
    Math.sin(t * .88 + 1.1) * .042,
  ]);
}

/** Samples the same weighted transforms as the shader for screen-space motion audits. */
export function deformPoint(x, y, time = 0, enabled = true) {
  const angles = jointPose(time, enabled), weights = weightsForPoint(x, y);
  let dx = 0, dy = 0;
  PARTS.forEach((part, i) => {
    const qx = x - part.pivot[0], qy = y - part.pivot[1];
    const c = Math.cos(angles[i]), s = Math.sin(angles[i]);
    dx += (c * qx - s * qy - qx) * weights[i];
    dy += (s * qx + c * qy - qy) * weights[i];
  });
  return [x + dx, y + dy];
}

const vertexSource = `
precision highp float;
attribute vec2 a_position;
attribute vec4 a_weights0;
attribute vec4 a_weights1;
attribute vec4 a_weights2;
uniform vec3 u_joints[12];
varying vec2 v_uv;
vec2 rotated(vec2 p, vec3 joint) {
  vec2 q = p - joint.xy;
  float c = cos(joint.z), s = sin(joint.z);
  return vec2(c*q.x-s*q.y,s*q.x+c*q.y) + joint.xy - p;
}
void main() {
  vec2 p = a_position;
  vec2 delta = vec2(0.0);
  delta += rotated(p,u_joints[0])*a_weights0.x;
  delta += rotated(p,u_joints[1])*a_weights0.y;
  delta += rotated(p,u_joints[2])*a_weights0.z;
  delta += rotated(p,u_joints[3])*a_weights0.w;
  delta += rotated(p,u_joints[4])*a_weights1.x;
  delta += rotated(p,u_joints[5])*a_weights1.y;
  delta += rotated(p,u_joints[6])*a_weights1.z;
  delta += rotated(p,u_joints[7])*a_weights1.w;
  delta += rotated(p,u_joints[8])*a_weights2.x;
  delta += rotated(p,u_joints[9])*a_weights2.y;
  delta += rotated(p,u_joints[10])*a_weights2.z;
  delta += rotated(p,u_joints[11])*a_weights2.w;
  v_uv = p / vec2(1090.0,1443.0);
  vec2 target = (p+delta)/vec2(1090.0,1443.0);
  gl_Position=vec4(target*vec2(2.0,-2.0)+vec2(-1.0,1.0),0.0,1.0);
}`;
const fragmentSource = `
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_gaze;
varying vec2 v_uv;
void main() {
  vec2 p = v_uv*vec2(1090.0,1443.0);
  float l=1.0-smoothstep(0.15,1.0,length((p-vec2(413.0,556.0))/vec2(48.0,61.0)));
  float r=1.0-smoothstep(0.15,1.0,length((p-vec2(647.0,519.0))/vec2(57.0,66.0)));
  vec2 sampleUV=(p-u_gaze*vec2(7.0,5.0)*(l+r))/vec2(1090.0,1443.0);
  gl_FragColor=texture2D(u_image,sampleUV);
}`;

/** Creates a GPU mesh over a complete, already composed frame; expression pixels move with the same geometry. */
export function createMeshRig() {
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: true, depth: false });
  let available = false, previousSource = null, previousKey = null;
  let texture, program, gaze, joints, count = 0;
  canvas.addEventListener('webglcontextlost', () => { available = false; });
  try {
    if (!gl) throw new Error('WebGL unavailable');
    const compile = (type, source) => {
      const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource)); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const vertices = [], nx = 66, ny = 88;
    const add = (i, j) => {
      const x = W * i / nx, y = H * j / ny;
      const weights = weightsForPoint(x, y);
      vertices.push(x, y, ...weights);
    };
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      add(i,j); add(i+1,j); add(i,j+1); add(i+1,j); add(i+1,j+1); add(i,j+1);
    }
    const stride = 2 + PARTS.length;
    count = vertices.length / stride;
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    for (const [name, size, offset] of [['position',2,0],['weights0',4,2],['weights1',4,6],['weights2',4,10]]) {
      const attribute = gl.getAttribLocation(program, `a_${name}`);
      gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, size, gl.FLOAT, false, stride * 4, offset * 4);
    }
    texture = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(program,'u_image'), 0);
    gaze = gl.getUniformLocation(program,'u_gaze'); joints = gl.getUniformLocation(program,'u_joints[0]');
    gl.viewport(0,0,W,H); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.clearColor(0,0,0,0);
    available = true;
  } catch (error) { console.warn('Animation mesh unavailable:', error.message); }
  return {
    get accelerated() { return available; },
    /** Deforms a cached expression drawing. Texture upload happens only when the expression image changes. */
    draw(source, key, state, settings, allowGaze = true) {
      if (!available || gl.isContextLost()) { available = false; return source; }
      const angles = jointPose(state.time, settings.hairMotion !== false);
      const values = new Float32Array(PARTS.length * 3);
      PARTS.forEach((part, i) => values.set([...part.pivot, angles[i]], i * 3));
      if (previousSource !== source || previousKey !== key) {
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
        previousSource = source; previousKey = key;
      }
      const track = allowGaze && settings.eyeTracking !== false;
      gl.uniform2f(gaze, track ? clamp(state.gaze.x,-1,1) : 0, track ? clamp(state.gaze.y,-1,1) : 0);
      gl.uniform3fv(joints,values); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES,0,count);
      return canvas;
    },
  };
}
