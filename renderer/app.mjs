/** @fileoverview Connects desktop IPC, expression controls, pointer dragging and the animated canvas. */
import { EXPRESSIONS, createPetState, applyAction, actionForKey, advance } from './state.mjs';
import { loadCharacter, drawCharacter, RIG } from './faithful-character.mjs';

const desktop = window.elysiaDesktop;
const state = createPetState();
const canvas = document.querySelector('#pet');
const ctx = canvas.getContext('2d');
const panel = document.querySelector('#controls');
const toast = document.querySelector('#toast');
let settings = { eyeTracking: true, hairMotion: true, alwaysOnTop: true, clickThrough: false, legacyHotkeys: true, scale: 1 };
let hotkeys = {};
let toastTimer;
let dragging = null;
let spaceHeld = false;
let spaceTarget = null;
let spaceChordUsed = false;

function tell(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 1800);
}

function showControls(show = panel.hidden) {
  panel.hidden = !show;
  if (show) document.querySelector('#close-controls').focus();
}

function syncControls() {
  for (const button of document.querySelectorAll('[data-expression]')) button.setAttribute('aria-pressed', String(state.expression === button.dataset.expression));
  document.querySelector('#megaphone').setAttribute('aria-pressed', String(state.megaphone));
  for (const id of ['eyeTracking', 'hairMotion', 'alwaysOnTop', 'legacyHotkeys', 'clickThrough']) document.getElementById(id).checked = settings[id];
  document.querySelector('#scale').value = settings.scale;
  document.querySelector('#scale-value').value = `${Math.round(settings.scale * 100)}%`;
  document.querySelector('#hotkey-status').textContent = !desktop
    ? '浏览器预览：按住空格切换表情；完整桌面功能请使用启动桌宠。'
    : hotkeys.legacy?.error ? `原版快捷键暂不可用：${hotkeys.legacy.error}。仍可点击上方按钮。`
    : settings.legacyHotkeys ? '再次按相同组合恢复默认。空格 + M 切换喇叭，空格 + 退格重置。'
    : '原版全局快捷键已关闭；仍可点击表情按钮。';
}

function act(action) {
  if (action.type === 'toggle-controls') return showControls();
  if (action.type === 'show-controls') return showControls(true);
  applyAction(state, action);
  syncControls();
  if (action.type === 'expression') tell(state.expression ? EXPRESSIONS.find(item => item.id === state.expression).label : '恢复默认');
  if (action.type === 'toggle-megaphone') tell(state.megaphone ? '听我说呀！' : '收起小喇叭');
  if (action.type === 'reset') tell('恢复默认');
}

for (const expression of EXPRESSIONS) {
  const button = document.createElement('button');
  button.className = 'expression';
  button.dataset.expression = expression.id;
  button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-label', `${expression.label}，空格加 ${expression.key}`);
  const symbol = document.createElement('span'); symbol.className = 'symbol'; symbol.textContent = expression.icon;
  const label = document.createElement('span'); label.className = 'label'; label.textContent = expression.label;
  const key = document.createElement('kbd'); key.textContent = expression.key;
  button.append(symbol, label, key);
  button.addEventListener('click', () => act({ type: 'expression', id: expression.id }));
  document.querySelector('#expression-grid').append(button);
}

document.querySelector('#close-controls').onclick = () => showControls(false);
document.querySelector('#megaphone').onclick = () => act({ type: 'toggle-megaphone' });
document.querySelector('#reset').onclick = () => act({ type: 'reset' });
document.querySelector('#quit').onclick = () => desktop?.quit();

async function updateSettings(patch) {
  try {
    if (desktop) {
      const result = await desktop.setSettings(patch);
      if (result?.settings) { settings = result.settings; hotkeys = result.hotkeys ?? hotkeys; }
      else settings = { ...settings, ...patch };
    } else settings = { ...settings, ...patch };
    syncControls();
  } catch (error) { tell(`设置未保存：${error.message}`); syncControls(); }
}

for (const id of ['eyeTracking', 'hairMotion', 'alwaysOnTop', 'legacyHotkeys', 'clickThrough']) {
  document.getElementById(id).addEventListener('change', async event => {
    const checked = event.target.checked;
    await updateSettings({ [id]: checked });
    if (id === 'clickThrough' && checked && settings.clickThrough) { showControls(false); tell('Ctrl + Alt + P 恢复操作'); }
  });
}
document.querySelector('#scale').addEventListener('input', event => {
  document.querySelector('#scale-value').value = `${Math.round(Number(event.target.value) * 100)}%`;
});
document.querySelector('#scale').addEventListener('change', event => updateSettings({ scale: Number(event.target.value) }));

function pointer(localX, localY, width, height) {
  // Canvas uses object-fit: contain; subtract any letterbox before deriving the eye anchor.
  const scale = Math.min(width / 600, height / 800);
  const ox = (width - 600 * scale) / 2, oy = (height - 800 * scale) / 2;
  state.target.x = (localX - ox - RIG.gazeX * scale) / (230 * scale);
  state.target.y = (localY - oy - RIG.gazeY * scale) / (240 * scale);
}

canvas.addEventListener('pointermove', event => {
  if (!desktop) pointer(event.clientX, event.clientY, innerWidth, innerHeight);
  if (dragging && desktop) {
    const dx = event.screenX - dragging.x, dy = event.screenY - dragging.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) dragging.moved = true;
    desktop.dragMove({ dx, dy });
  }
});
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  dragging = { x: event.screenX, y: event.screenY, moved: false };
  canvas.setPointerCapture(event.pointerId);
  desktop?.dragStart();
});
canvas.addEventListener('pointerup', event => {
  const moved = dragging?.moved;
  if (dragging) desktop?.dragEnd();
  dragging = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (!moved && event.button === 0) act({ type: 'expression', id: 'pat' });
});
canvas.addEventListener('lostpointercapture', () => { dragging = null; desktop?.dragEnd(); });
canvas.addEventListener('contextmenu', event => { event.preventDefault(); desktop ? desktop.showMenu() : showControls(true); });
canvas.addEventListener('wheel', event => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  updateSettings({ scale: Math.min(1.6, Math.max(.6, settings.scale + (event.deltaY < 0 ? .05 : -.05))) });
}, { passive: false });

document.addEventListener('keydown', event => {
  if (event.code === 'Escape') { showControls(false); return; }
  if (event.code === 'Space') {
    // Delay button activation until keyup: Space is also the original expression chord prefix.
    event.preventDefault();
    if (!spaceHeld) { spaceTarget = event.target.closest?.('button, input[type="checkbox"]') ?? null; spaceChordUsed = false; }
    spaceHeld = true;
    return;
  }
  const chord = spaceHeld ? actionForKey(event.code) : null;
  if (chord) { spaceChordUsed = true; event.preventDefault(); }
  // A native passive listener already sees focused-window keys. Dispatching here too would toggle twice.
  if (desktop && settings.legacyHotkeys && hotkeys.legacy?.active) return;
  if (chord && !event.repeat) act(chord);
});
document.addEventListener('keyup', event => {
  if (event.code !== 'Space') return;
  event.preventDefault();
  if (spaceHeld && !spaceChordUsed && spaceTarget === document.activeElement) spaceTarget?.click();
  spaceHeld = false; spaceTarget = null;
});
window.addEventListener('blur', () => { spaceHeld = false; spaceTarget = null; if (dragging) desktop?.dragEnd(); dragging = null; });

if (desktop) {
  desktop.onPointer(event => pointer(event.localX, event.localY, event.width, event.height));
  desktop.onAction(act);
  desktop.onSettings(snapshot => { settings = snapshot.settings; hotkeys = snapshot.hotkeys; syncControls(); });
  const snapshot = await desktop.getState();
  settings = snapshot.settings; hotkeys = snapshot.hotkeys;
}
syncControls();

try {
  const atlas = await loadCharacter();
  document.querySelector('#loading').hidden = true;
  // Match canvas backing resolution to the display without changing the rig's logical coordinates.
  const resize = () => {
    const scale = Math.min(innerWidth / 600, innerHeight / 800) * devicePixelRatio;
    canvas.width = Math.round(600 * scale); canvas.height = Math.round(800 * scale);
    ctx.setTransform(canvas.width / 600, 0, 0, canvas.height / 800, 0, 0);
  };
  window.addEventListener('resize', resize); resize();
  let previous = performance.now();
  function frame(now) {
    advance(state, (now - previous) / 1000, settings); previous = now;
    drawCharacter(ctx, atlas, state, settings);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  // Read-only diagnostics make screenshot tests deterministic without exposing Node or arbitrary IPC.
  window.elysiaPreview = {
    acceleration: { normal: atlas.normal.accelerated, megaphone: atlas.megaphone.accelerated },
    snapshot: () => JSON.parse(JSON.stringify(state)),
    render: (expression, megaphone = false, time = 0, resolutionScale = 1) => {
      const preview = createPetState(); preview.expression = expression; preview.megaphone = megaphone;
      preview.time = Number.isFinite(time) ? time : 0;
      const factor = Math.min(3, Math.max(1, Number(resolutionScale) || 1));
      const target = document.createElement('canvas'); target.width = 600 * factor; target.height = 800 * factor;
      const previewContext = target.getContext('2d'); previewContext.scale(factor, factor);
      drawCharacter(previewContext, atlas, preview, settings);
      return target.toDataURL();
    },
  };
  document.documentElement.dataset.ready = 'true';
} catch (error) {
  document.querySelector('#loading').textContent = `人物素材加载失败：${error.message}。请完整保留 assets 文件夹。`;
}
