/** @fileoverview Connects desktop IPC, expression controls, pointer dragging and the animated canvas. */
import { EXPRESSIONS, SKINS, POSES, createPetState, applyAction, actionForKey, advance } from './state.mjs';
import { loadCharacter, drawCharacter, RIG } from './faithful-character.mjs';
import { createPointerTracking } from './pointer-tracking.mjs';
import { createCharacterHitRegion,prepareCharacterHitRegions } from './hit-region.mjs';

const desktop = window.elysiaDesktop;
const state = createPetState();
const pointerTracking = createPointerTracking(state,RIG);
const canvas = document.querySelector('#pet');
const ctx = canvas.getContext('2d');
const panel = document.querySelector('#controls');
const toast = document.querySelector('#toast');
let settings = { eyeTracking: true, hairMotion: true, alwaysOnTop: true, clickThrough: false, legacyHotkeys: true, scale: 1, cat: false, glasses: false };
let hotkeys = {};
let toastTimer;
let dragging = null;
let characterAtlas=null,dragRenderPaused=false,redrawRequested=true,shapeScheduled=false;
let toastRegionVisible=false;
let spaceHeld = false;
let spaceTarget = null;
let spaceChordUsed = false;
let restoringAppearance = Boolean(desktop);
const pendingActions = [];

function pauseDragRendering(active){dragRenderPaused=Boolean(active);if(!dragRenderPaused)redrawRequested=true;}
function publishHitRegion(){
  if(!desktop?.setHitRegion)return Promise.resolve(false);
  const rects=[],width=innerWidth,height=innerHeight;
  if(characterAtlas){
    const shape=createCharacterHitRegion(characterAtlas,state,settings);
    const scale=Math.min(width/600,height/800),ox=(width-600*scale)/2,oy=(height-800*scale)/2;
    for(const rect of shape.rects)rects.push({x:ox+rect.x*scale,y:oy+rect.y*scale,width:rect.width*scale,height:rect.height*scale});
  }
  for(const node of [panel,document.querySelector('#loading'),toast]){
    if(node.hidden||(node===toast&&!toastRegionVisible))continue;
    const box=node.getBoundingClientRect(),pad=node===toast?8:3;
    if(box.width&&box.height)rects.push({x:box.x-pad,y:box.y-pad,width:box.width+pad*2,height:box.height+pad*2});
  }
  return Promise.resolve(desktop.setHitRegion({width,height,rects}));
}
function scheduleHitRegion(){
  if(shapeScheduled||!desktop?.setHitRegion)return;
  shapeScheduled=true;
  requestAnimationFrame(()=>{shapeScheduled=false;void publishHitRegion().catch(()=>{});});
}

function tell(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  toastRegionVisible=true;
  scheduleHitRegion();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {toast.classList.remove('visible');toastTimer=setTimeout(()=>{toastRegionVisible=false;scheduleHitRegion();},220);}, 1800);
}

function showControls(show = panel.hidden) {
  panel.hidden = !show;
  if (show) document.querySelector('#close-controls').focus();
  scheduleHitRegion();
}

function syncControls() {
  redrawRequested=true;scheduleHitRegion();
  for (const button of document.querySelectorAll('[data-expression]')) button.setAttribute('aria-pressed', String(state.expression === button.dataset.expression));
  for (const button of document.querySelectorAll('[data-skin]')) button.setAttribute('aria-checked', String(state[button.dataset.skin]));
  for (const button of document.querySelectorAll('[data-pose]')) button.setAttribute('aria-pressed', String(state.pose === button.dataset.pose));
  desktop?.setAppearance({ expression: state.expression, pose: state.pose, cat: state.cat, glasses: state.glasses });
  for (const id of ['eyeTracking', 'hairMotion', 'alwaysOnTop', 'legacyHotkeys', 'clickThrough']) document.getElementById(id).checked = settings[id];
  document.querySelector('#scale').value = settings.scale;
  document.querySelector('#scale-value').value = `${Math.round(settings.scale * 100)}%`;
  document.querySelector('#hotkey-status').textContent = !desktop
    ? '浏览器预览：空格 + 数字切换表情，空格 + F1–F6 切换装扮和动作。'
    : hotkeys.legacy?.error ? `全局快捷键暂不可用：${hotkeys.legacy.error}。仍可点击上方按钮。`
    : settings.legacyHotkeys ? '空格 + 数字再次按下恢复默认表情；装扮和动作保持。空格 + 退格全部重置。'
    : '全局快捷键已关闭；仍可点击上方按钮。';
}

function act(action) {
  // Restore saved skins first, then apply shortcuts that arrived while IPC was loading.
  if (restoringAppearance) { pendingActions.push(action); return; }
  if (action.type === 'toggle-controls') return showControls();
  if (action.type === 'show-controls') return showControls(true);
  applyAction(state, action);
  syncControls();
  if (action.type === 'toggle-skin' || action.type === 'reset') void updateSettings({ cat: state.cat, glasses: state.glasses });
  if (action.type === 'expression') tell(state.expression ? EXPRESSIONS.find(item => item.id === state.expression).label : '恢复默认表情');
  if (action.type === 'pose' && POSES.some(item => item.id === action.id)) tell(POSES.find(item => item.id === state.pose).label);
  if (action.type === 'toggle-skin' && SKINS.some(item => item.id === action.id)) tell(`${SKINS.find(item => item.id === action.id).label}已${state[action.id] ? '开启' : '关闭'}`);
  if (action.type === 'reset') tell('装扮、动作与表情已重置');
}

function controlButton(item, kind) {
  const button = document.createElement('button');
  button.className = kind === 'skin' ? 'skin-toggle' : 'expression';
  button.dataset[kind] = item.id;
  if (kind === 'skin') { button.setAttribute('role', 'switch'); button.setAttribute('aria-checked', 'false'); }
  else button.setAttribute('aria-pressed', 'false');
  button.setAttribute('aria-label', `${item.label}，空格加 ${item.key}`);
  const symbol = document.createElement('span'); symbol.className = 'symbol'; symbol.textContent = item.icon;
  const label = document.createElement('span'); label.className = 'label'; label.textContent = item.label;
  const key = document.createElement('kbd'); key.textContent = item.key;
  button.append(symbol, label, key);
  if (kind === 'skin') { const indicator = document.createElement('i'); indicator.className = 'switch'; button.append(indicator); }
  button.addEventListener('click', () => act({ type: kind === 'skin' ? 'toggle-skin' : kind, id: item.id }));
  document.querySelector(`#${kind}-grid`).append(button);
}
for (const item of EXPRESSIONS) controlButton(item, 'expression');
for (const item of SKINS) controlButton(item, 'skin');
for (const item of POSES) controlButton(item, 'pose');

document.querySelector('#close-controls').onclick = () => showControls(false);
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

canvas.addEventListener('pointermove', event => {
  // Use the newest coalesced hardware point locally as well as in preview.
  // Waiting for a round trip through the host adds avoidable cursor latency.
  const samples=event.getCoalescedEvents?.();
  const latest=samples?.length?samples[samples.length-1]:event;
  pointerTracking.sample({localX:latest.clientX,localY:latest.clientY,width:innerWidth,height:innerHeight,
    sampledAt:performance.timeOrigin+latest.timeStamp});
});
canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  // The host samples the latest native cursor while captured. Sending every
  // renderer delta would queue obsolete positions during a busy paint.
  dragging = { pointerId:event.pointerId };
  pauseDragRendering(true);
  canvas.setPointerCapture(event.pointerId);
  desktop?.dragStart();
});
canvas.addEventListener('pointerup', event => {
  if (dragging) desktop?.dragEnd();
  dragging = null;
  pauseDragRendering(false);
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
});
canvas.addEventListener('lostpointercapture', () => { dragging = null;pauseDragRendering(false);desktop?.dragEnd(); });
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
window.addEventListener('blur', () => { spaceHeld = false; spaceTarget = null; if (dragging) desktop?.dragEnd(); dragging = null;pauseDragRendering(false); });

if (desktop) {
  desktop.onPointer(event => pointerTracking.sample(event));
  desktop.onDragState?.(active=>pauseDragRendering(active));
  desktop.onAction(act);
  desktop.onSettings(snapshot => { settings = snapshot.settings; hotkeys = snapshot.hotkeys; syncControls(); });
  const snapshot = await desktop.getState();
  settings = snapshot.settings; hotkeys = snapshot.hotkeys;
  state.cat = settings.cat === true; state.glasses = settings.glasses === true;
  restoringAppearance = false;
  for (const action of pendingActions.splice(0)) act(action);
}
syncControls();

try {
  const atlas = await loadCharacter(state);
  await prepareCharacterHitRegions(atlas,settings);
  characterAtlas=atlas;
  document.querySelector('#loading').hidden = true;
  // Match canvas backing resolution to the display without changing the rig's logical coordinates.
  const resize = () => {
    scheduleHitRegion();
    const scale = Math.min(innerWidth / 600, innerHeight / 800) * devicePixelRatio;
    const width=Math.round(600*scale),height=Math.round(800*scale);
    if(canvas.width===width&&canvas.height===height)return;
    canvas.width=width;canvas.height=height;
    ctx.setTransform(canvas.width / 600, 0, 0, canvas.height / 800, 0, 0);
    redrawRequested=true;scheduleHitRegion();
  };
  window.addEventListener('resize', resize); resize();
  let previous = performance.now();
  function frame(now) {
    const elapsed=(now-previous)/1000;previous=now;
    // While held, let Windows move the already-composited bitmap. Repainting
    // all layers at 160Hz competes with native window movement and causes stalls.
    if(!dragRenderPaused||redrawRequested){
      advance(state,dragRenderPaused?0:elapsed,settings);
      drawCharacter(ctx,atlas,state,settings);redrawRequested=false;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  await publishHitRegion();
  // Read-only diagnostics make screenshot tests deterministic without exposing Node or arbitrary IPC.
  window.elysiaPreview = {
    rendering: { mode: atlas.renderer.mode, eyeTracking: atlas.renderer.eyeTrackingAvailable },
    snapshot: () => JSON.parse(JSON.stringify(state)),
    render: (expressionOrOptions, megaphone = false, time = 0, resolutionScale = 1) => {
      const options = expressionOrOptions && typeof expressionOrOptions === 'object' ? expressionOrOptions : { expression: expressionOrOptions, pose: megaphone ? 'megaphone' : 'idle', time };
      const preview = createPetState();
      if (EXPRESSIONS.some(item => item.id === options.expression)) preview.expression = options.expression;
      if (POSES.some(item => item.id === options.pose)) preview.pose = options.pose;
      preview.cat = options.cat === true; preview.glasses = options.glasses === true;
      preview.blink = Number.isFinite(options.blink) ? Math.min(1, Math.max(0, options.blink)) : 0;
      preview.time = Number.isFinite(options.time) ? options.time : 0;
      const factor = Math.min(3, Math.max(1, Number(options.resolutionScale ?? resolutionScale) || 1));
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
