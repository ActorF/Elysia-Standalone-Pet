/** @fileoverview Independent face, pose and skin selections plus time-based animation. */
export const EXPRESSIONS = [
  ['blush', '害羞', '1', '♡'], ['angry', '生气', '2', '╬'],
  ['sleep', '睡觉', '3', '☾'], ['surprise', '惊讶', '4', '!'],
  ['dizzy', '晕', '5', '◎'], ['wink', 'Wink', '6', '✧'],
  ['cry', '伤心', '7', '◡'], ['heart', '爱心眼', '8', '♥'],
  ['smile', '微笑', '9', '☺'], ['awkward', '囧', '0', '囧'],
].map(([id, label, key, icon]) => ({ id, label, key, icon }));

export const SKINS = [
  ['cat', '猫猫形态', 'F1', '♧'], ['glasses', '眼镜', 'F2', '⌘'],
].map(([id, label, key, icon]) => ({ id, label, key, icon }));

export const POSES = [
  ['idle', '日常待机', 'F3', '♡'], ['megaphone', '听我说呀！', 'F4', '♬'],
  ['cake', '吃蛋糕', 'F5', '♜'], ['tea', '喝奶茶', 'F6', '◒'],
].map(([id, label, key, icon]) => ({ id, label, key, icon }));

/** Creates independent renderer state; expression changes never alter desktop preferences. */
export function createPetState() {
  return { expression: null, pose: 'idle', cat: false, glasses: false, gaze: { x: 0, y: 0 },
    target: { x: 0, y: 0 }, time: 0, blink: 0, nextBlink: 3.2, blinkAge: -1,
    hair: 0, hairVelocity: 0, actionAge: 0 };
}

/** Faces toggle to neutral; poses are exclusive selections and skins are independent switches. */
export function applyAction(state, action) {
  if (!action || typeof action !== 'object') return state;
  if (action.type === 'expression' && EXPRESSIONS.some(item => item.id === action.id)) {
    state.expression = state.expression === action.id ? null : action.id;
    state.actionAge = 0;
  } else if (action.type === 'pose' && POSES.some(item => item.id === action.id)) {
    state.pose = action.id;
    state.actionAge = 0;
  } else if (action.type === 'toggle-skin' && SKINS.some(item => item.id === action.id)) {
    state[action.id] = !state[action.id];
    state.actionAge = 0;
  } else if (action.type === 'reset') {
    state.expression = null;
    state.pose = 'idle';
    state.cat = false;
    state.glasses = false;
    state.actionAge = 0;
  }
  return state;
}

/** Numeric keys select faces; F keys select skins / poses after the Space prefix. */
export function actionForKey(code) {
  if (typeof code !== 'string') return null;
  if (code === 'Backspace') return { type: 'reset' };
  const key = code.startsWith('Digit') ? code.slice(5) : code.startsWith('Numpad') ? code.slice(6) : code;
  const item = EXPRESSIONS.find(expression => expression.key === key);
  if (item) return { type: 'expression', id: item.id };
  const skin = SKINS.find(item => item.key === key);
  if (skin) return { type: 'toggle-skin', id: skin.id };
  const pose = POSES.find(item => item.key === key);
  return pose ? { type: 'pose', id: pose.id } : null;
}

/** Smooths global cursor coordinates and advances a damped hair spring independent of frame rate. */
export function advance(state, elapsed, settings = {}) {
  const dt = Math.min(Math.max(elapsed, 0), 0.04);
  state.time += dt;
  state.actionAge += dt;
  const smoothing = 1 - Math.exp(-dt * 9);
  const x = settings.eyeTracking === false ? 0 : Math.max(-1, Math.min(1, state.target.x));
  const y = settings.eyeTracking === false ? 0 : Math.max(-1, Math.min(1, state.target.y));
  state.gaze.x += (x - state.gaze.x) * smoothing;
  state.gaze.y += (y - state.gaze.y) * smoothing;
  const targetHair = settings.hairMotion === false ? 0 : Math.sin(state.time * 1.05) * 0.032;
  state.hairVelocity += ((targetHair - state.hair) * 65 - state.hairVelocity * 9) * dt;
  state.hair += state.hairVelocity * dt;
  if (state.time >= state.nextBlink && state.blinkAge < 0) state.blinkAge = 0;
  if (state.blinkAge >= 0) {
    state.blinkAge += dt;
    state.blink = Math.sin(Math.min(1, state.blinkAge / 0.17) * Math.PI);
    if (state.blinkAge >= 0.17) {
      state.blinkAge = -1;
      state.blink = 0;
      state.nextBlink = state.time + 3.2 + Math.sin(state.time * 3.4) * 1.3;
    }
  }
  return state;
}
