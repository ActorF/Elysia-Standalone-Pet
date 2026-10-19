/** @fileoverview Pure expression toggles and time-based animation for the desktop character. */
export const EXPRESSIONS = [
  ['glasses', '眼镜', '1', '⌘'], ['blush', '害羞', '2', '♡'],
  ['angry', '生气', '3', '╬'], ['sleep', '睡觉', '4', '☾'],
  ['surprise', '惊讶', '5', '!'], ['squint', '眯眯眼', '6', '⌒'],
  ['dizzy', '晕', '7', '◎'], ['wink', 'Wink', '8', '✧'],
  ['cry', '哭', '9', '◡'], ['heart', '爱心眼', '0', '♥'],
  ['star', '星星眼', '-', '★'], ['smile', '眯眼笑', '=', '☺'],
  ['cat', '猫猫形态', 'F1', '♧'], ['cake', '吃蛋糕', 'F2', '♜'],
  ['tea', '喝奶茶', 'F3', '◒'], ['awkward', '囧', 'F4', '囧'],
  ['pat', '摸头', 'F5', '♡'],
].map(([id, label, key, icon]) => ({ id, label, key, icon }));

/** Creates independent renderer state; expression changes never alter desktop preferences. */
export function createPetState() {
  return { expression: null, megaphone: false, gaze: { x: 0, y: 0 },
    target: { x: 0, y: 0 }, time: 0, blink: 0, nextBlink: 3.2, blinkAge: -1,
    hair: 0, hairVelocity: 0, actionAge: 0 };
}

/** Applies the original toggle-to-default semantics, with an independent megaphone switch. */
export function applyAction(state, action) {
  if (action.type === 'expression' && EXPRESSIONS.some(item => item.id === action.id)) {
    state.expression = state.expression === action.id ? null : action.id;
    state.actionAge = 0;
  } else if (action.type === 'toggle-megaphone') {
    state.megaphone = !state.megaphone;
    state.actionAge = 0;
  } else if (action.type === 'reset') {
    state.expression = null;
    state.megaphone = false;
    state.actionAge = 0;
  }
  return state;
}

/** Converts the legacy Space chord key into a semantic action without consuming typed keys. */
export function actionForKey(code) {
  if (code === 'KeyM') return { type: 'toggle-megaphone' };
  if (code === 'Backspace') return { type: 'reset' };
  const key = code.startsWith('Digit') ? code.slice(5) : code === 'Minus' ? '-' : code === 'Equal' ? '=' : code;
  const item = EXPRESSIONS.find(expression => expression.key === key);
  return item ? { type: 'expression', id: item.id } : null;
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
