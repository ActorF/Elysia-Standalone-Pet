// Independent transparent Electron host. Character animation lives entirely in the local renderer.
'use strict';
const { app, BrowserWindow, Menu, Tray, nativeImage, screen, ipcMain, globalShortcut, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { DEFAULT_SETTINGS, EXPRESSION_KEYS, SKIN_KEYS, POSE_KEYS, sanitizeAppearance, sanitizeSettings, dimensions, freeBounds, restoreBounds, recoverBounds, actionForKey, isLocalResource } = require('./host-policy.cjs');
const { trayPng } = require('./tray-icon.cjs');
const {createDesktopPointer,POINTER_INTERVAL_MS}=require('./desktop-pointer.cjs');
const {createDragLifecycle}=require('./drag-lifecycle.cjs');
const {createTopmostController}=require('./window-layer.cjs');

const root = path.resolve(__dirname, '..');
const rendererUrl = pathToFileURL(path.join(root, 'renderer', 'index.html')).href;
const smokeNativeHotkeys = process.argv.includes('--smoke-native-hotkeys');
const isSmokeTest = process.argv.includes('--smoke-test') || smokeNativeHotkeys;
if (isSmokeTest) app.setPath('userData', path.join(app.getPath('temp'), 'elysia-pet-host-smoke'));
let pet, tray, settingsFile, pointerTimer, saveTimer, desktopPointer, dragLifecycle, topmost, legacyProcess;
let preferences = { ...DEFAULT_SETTINGS };
let appearance = sanitizeAppearance();
let savedPosition = null;
let quitting = false;
const hotkeys = { legacy: { active: false, error: null }, alternate: { active: false, failed: [] }, recovery: false };

function state() { return { settings: { ...preferences }, hotkeys: structuredClone(hotkeys) }; }
function send(channel, data) {
  if (pet && !pet.isDestroyed() && !pet.webContents.isDestroyed()) pet.webContents.send(channel, data);
}
function publishSettings() { send('pet:settings', state()); }
function action(typeOrAction) { send('pet:action', typeof typeOrAction === 'string' ? { type: typeOrAction } : typeOrAction); }
function placePet(position) {
  // Keep the configured DIP size. Recycling getBounds() through setPosition()
  // can progressively enlarge a frameless window at fractional Windows DPI.
  const target=freeBounds({...dimensions(preferences.scale),x:position.x,y:position.y});
  pet.setBounds(target,false);
  const actual=pet.getBounds(),from=screen.getDisplayMatching(actual),to=screen.getDisplayMatching(target);
  if(from.id!==to.id&&Math.abs(from.scaleFactor-to.scaleFactor)>.01
    &&(Math.abs(actual.x-target.x)>2||Math.abs(actual.y-target.y)>2)){
    // Electron can retain the previous monitor's DPI conversion at a seam.
    // Cross that seam synchronously, then reapply the exact intended bounds.
    pet.setBounds(freeBounds({...target,x:target.x+2*(target.x-actual.x),y:target.y+2*(target.y-actual.y)}),false);
    pet.setBounds(target,false);
  }
}
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!settingsFile) return;
    try {
      const bounds = pet && !pet.isDestroyed() ? pet.getBounds() : savedPosition;
      const payload = { settings: preferences, position: bounds ? { x: bounds.x, y: bounds.y } : null };
      fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
      fs.writeFileSync(settingsFile + '.tmp', JSON.stringify(payload, null, 2));
      fs.renameSync(settingsFile + '.tmp', settingsFile);
    } catch (error) { console.error('Could not save pet preferences:', error.message); }
  }, 120);
}
function loadSettings() {
  try {
    const stored = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    preferences = sanitizeSettings(stored.settings);
    if (stored.position && Number.isFinite(stored.position.x) && Number.isFinite(stored.position.y)) savedPosition = stored.position;
  } catch { /* First start or invalid preferences uses safe defaults. */ }
  // A fresh launch is always interactive; the tray can re-enable click-through.
  preferences.clickThrough = false;
}
function recover(showControls = true) {
  if (!pet || pet.isDestroyed()) return;
  updateSettings({ clickThrough: false });
  dragLifecycle?.cancelDrag();
  if (pet.isMinimized()) pet.restore();
  placePet(recoverBounds(pet.getBounds(), screen.getAllDisplays()));
  pet.show();
  pet.focus();
  if (showControls) action('show-controls');
}
function updateSettings(patch) {
  const previous = preferences;
  preferences = sanitizeSettings(patch && typeof patch === 'object' ? patch : {}, preferences);
  if (pet && !pet.isDestroyed()) {
    topmost?.setEnabled(preferences.alwaysOnTop);
    if (preferences.clickThrough) dragLifecycle?.endDrag();
    pet.setIgnoreMouseEvents(preferences.clickThrough, { forward: true });
    if (preferences.scale !== previous.scale) {
      const old = pet.getBounds();
      const size = dimensions(preferences.scale);
      const bounds = { ...size, x: old.x + old.width - size.width, y: old.y + old.height - size.height };
      dragLifecycle?.cancelDrag();
      placePet(freeBounds(bounds));
    }
  }
  if (preferences.legacyHotkeys !== previous.legacyHotkeys) configureLegacyHotkeys();
  if (preferences.alternateHotkeys !== previous.alternateHotkeys) configureAlternateHotkeys();
  saveSettings();
  publishSettings();
  return state();
}

function configureLegacyHotkeys() {
  const previousProcess = legacyProcess;
  legacyProcess = null;
  if (previousProcess) previousProcess.kill();
  hotkeys.legacy = { active: false, error: null };
  if (!preferences.legacyHotkeys) { publishSettings(); return; }
  if (process.platform !== 'win32') {
    hotkeys.legacy.error = '原版 Space 组合键仅支持 Windows；可启用备用快捷键。';
    publishSettings(); return;
  }
  let script = path.join(__dirname, 'legacy-hotkeys.ps1');
  if (app.isPackaged) script = script.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-ParentProcessId', String(process.pid)], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  legacyProcess = child;
  let pending = '';
  let failure = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (text) => {
    if (legacyProcess !== child) return;
    pending += text;
    const lines = pending.split(/\r?\n/); pending = lines.pop();
    for (const line of lines) {
      if (line.trim() === 'READY') {
        hotkeys.legacy = { active: true, error: null }; publishSettings(); continue;
      }
      const mapped = actionForKey(line.trim());
      if (mapped) action(mapped);
    }
    if (pending.length > 1024) pending = '';
  });
  child.stderr.on('data', (text) => { failure = (failure + text).slice(-2000); });
  child.on('error', () => {
    if (legacyProcess !== child) return;
    hotkeys.legacy = { active: false, error: '无法启动原版快捷键监听；可启用备用快捷键。' }; publishSettings();
  });
  child.on('exit', (code) => {
    if (legacyProcess !== child || quitting) return;
    legacyProcess = null;
    hotkeys.legacy = { active: false, error: `原版快捷键监听已停止（${code ?? 'unknown'}）${failure ? '，请启用备用快捷键。' : '。'}` };
    publishSettings();
  });
}

const alternateBindings = [];
function configureAlternateHotkeys() {
  for (const binding of alternateBindings.splice(0)) globalShortcut.unregister(binding);
  hotkeys.alternate = { active: false, failed: [] };
  if (!preferences.alternateHotkeys) return;
  for (const key of [...Object.keys(EXPRESSION_KEYS), ...Object.keys(SKIN_KEYS), ...Object.keys(POSE_KEYS), 'Backspace']) {
    const accelerator = `CommandOrControl+Alt+${key}`;
    try {
      if (globalShortcut.register(accelerator, () => action(actionForKey(key)))) alternateBindings.push(accelerator);
      else hotkeys.alternate.failed.push(accelerator);
    } catch { hotkeys.alternate.failed.push(accelerator); }
  }
  hotkeys.alternate.active = alternateBindings.length > 0;
}

const labels = {
  glasses: '眼镜', blush: '害羞', angry: '生气', sleep: '睡觉', surprise: '惊讶',
  dizzy: '晕', wink: 'Wink', cry: '伤心', heart: '爱心眼', smile: '微笑',
  cat: '猫猫形态', idle: '日常待机', megaphone: '听我说呀！', cake: '吃蛋糕', tea: '喝奶茶', awkward: '囧',
};
function buildMenu() {
  return Menu.buildFromTemplate([
    { label: '显示 / 恢复操作 (Ctrl+Alt+P)', click: () => recover() },
    { label: '表情说明与设置', click: () => { recover(false); action('show-controls'); } },
    { label: '表情（数字区）', submenu: Object.entries(EXPRESSION_KEYS).map(([key, id]) => ({ label: `${labels[id]}  Space+${key}`, type: 'checkbox', checked: appearance.expression === id, click: () => action({ type: 'expression', id }) })) },
    { label: '装扮开关（F1–F2）', submenu: Object.entries(SKIN_KEYS).map(([key, id]) => ({ label: `${labels[id]}  Space+${key}`, type: 'checkbox', checked: appearance[id], click: () => action({ type: 'toggle-skin', id }) })) },
    { label: '动作四选一（F3–F6）', submenu: Object.entries(POSE_KEYS).map(([key, id]) => ({ label: `${labels[id]}  Space+${key}`, type: 'radio', checked: appearance.pose === id, click: () => action({ type: 'pose', id }) })) },
    { label: '全部重置 (Space+Backspace)', click: () => action('reset') },
    { type: 'separator' },
    { label: '始终置顶', type: 'checkbox', checked: preferences.alwaysOnTop, click: (item) => updateSettings({ alwaysOnTop: item.checked }) },
    { label: '点击穿透（托盘或 Ctrl+Alt+P 恢复）', type: 'checkbox', checked: preferences.clickThrough, click: (item) => updateSettings({ clickThrough: item.checked }) },
    { label: 'Space 全局组合键', type: 'checkbox', checked: preferences.legacyHotkeys, click: (item) => updateSettings({ legacyHotkeys: item.checked }) },
    { label: '备用 Ctrl+Alt 全局组合键', type: 'checkbox', checked: preferences.alternateHotkeys, click: (item) => updateSettings({ alternateHotkeys: item.checked }) },
    { label: '大小', submenu: [0.6, 0.8, 1, 1.2, 1.4, 1.6].map((scale) => ({ label: `${Math.round(scale * 100)}%`, type: 'radio', checked: preferences.scale === scale, click: () => updateSettings({ scale }) })) },
    { type: 'separator' },
    { label: '退出桌宠', click: () => app.quit() },
  ]);
}
function showMenu() { buildMenu().popup({ window: pet }); }

function registerIpc() {
  const trusted = (event) => pet && !pet.isDestroyed() && event.sender === pet.webContents && event.senderFrame === pet.webContents.mainFrame;
  ipcMain.handle('pet:get-state', (event) => trusted(event) ? state() : null);
  ipcMain.handle('pet:set-settings', (event, patch) => trusted(event) ? updateSettings(patch) : null);
  ipcMain.on('pet:set-appearance', (event, value) => { if (trusted(event)) appearance = sanitizeAppearance(value); });
  ipcMain.on('pet:pointer-received', (event, sequence) => { if (trusted(event) && Number.isSafeInteger(sequence)) desktopPointer?.acknowledge(sequence); });
  ipcMain.on('pet:drag-start', (event) => { if (trusted(event) && !preferences.clickThrough) dragLifecycle?.startDrag(); });
  ipcMain.on('pet:drag-end', (event) => { if (trusted(event)) dragLifecycle?.endDrag(); });
  ipcMain.on('pet:menu', (event) => { if (trusted(event)) showMenu(); });
  ipcMain.on('pet:quit', (event) => { if (trusted(event)) app.quit(); });
}

async function createWindow() {
  const primary = screen.getPrimaryDisplay().workArea;
  const size = dimensions(preferences.scale);
  const desired = { ...size, x: savedPosition?.x ?? primary.x + primary.width - size.width - 24, y: savedPosition?.y ?? primary.y + primary.height - size.height - 12 };
  pet = new BrowserWindow({
    ...restoreBounds(desired, screen.getAllDisplays()),
    show: false, frame: false, thickFrame: false, transparent: true, backgroundColor: '#00000000',
    resizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: preferences.alwaysOnTop, skipTaskbar: true, hasShadow: false,
    title: 'Elysia Desktop Pet', icon: nativeImage.createFromBuffer(trayPng()),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, devTools: !app.isPackaged },
  });
  topmost=createTopmostController(pet,{enabled:preferences.alwaysOnTop});
  desktopPointer=createDesktopPointer({
    readCursor:()=>screen.getCursorScreenPoint(),getBounds:()=>pet.getBounds(),
    setPosition:(x,y)=>placePet({x,y}),
    sendPointer:payload=>send('pet:pointer',payload),onDragEnd:saveSettings,
  });
  dragLifecycle=createDragLifecycle({window:pet,pointer:desktopPointer,readCursor:()=>screen.getCursorScreenPoint()});
  pet.webContents.on('did-finish-load',()=>desktopPointer?.reset());
  pet.setMenu(null);
  pet.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  pet.webContents.on('will-navigate', (event, url) => { if (url !== rendererUrl) event.preventDefault(); });
  pet.webContents.on('will-attach-webview', (event) => event.preventDefault());
  // The renderer owns the character's right-click gesture and sends a single pet:menu IPC.
  pet.on('move', saveSettings);
  pet.on('closed', () => { dragLifecycle?.dispose();topmost?.dispose();desktopPointer?.reset();pet = null; if (!quitting) app.quit(); });
  pet.once('ready-to-show', () => { if (!isSmokeTest) pet.showInactive(); });
  await pet.loadURL(rendererUrl);
  pointerTimer = setInterval(() => {
    if (pet && !pet.isDestroyed()) desktopPointer.sample();
  }, POINTER_INTERVAL_MS);
  if (isSmokeTest) {
    await pet.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const deadline=Date.now()+15000;const timer=setInterval(()=>{if(document.documentElement.dataset.ready==='true'){clearInterval(timer);resolve(true)}else if(Date.now()>deadline){clearInterval(timer);reject(new Error('Renderer did not become ready'))}},50)})`);
    if (smokeNativeHotkeys) {
      const deadline = Date.now() + 10000;
      while (!hotkeys.legacy.active && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
      if (!hotkeys.legacy.active) throw new Error('Passive hotkey listener did not become ready');
      pet.show(); pet.focus();
      const handle = pet.getNativeWindowHandle();
      const nativeHandle = handle.length >= 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
      await new Promise((resolve, reject) => {
        const injector = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'smoke-hotkey-input.ps1'), '-ExpectedWindow', nativeHandle], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        const timeout = setTimeout(() => { injector.kill(); reject(new Error('Native input test timed out')); }, 10000);
        injector.stderr.on('data', (chunk) => { output += chunk.toString(); });
        injector.on('error', (error) => { clearTimeout(timeout); reject(error); });
        injector.on('exit', (code) => { clearTimeout(timeout); if (code === 0) resolve(); else reject(new Error(`Native input test refused / failed: ${output}`)); });
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      const expression = await pet.webContents.executeJavaScript('window.elysiaPreview.snapshot().expression');
      if (expression !== 'blush') throw new Error(`Native Space+1 did not toggle once: ${expression}`);
    }
    const renderer = await pet.webContents.executeJavaScript(`(async () => ({bridge:typeof window.elysiaDesktop, node:typeof window.require, title:document.title, rendering:window.elysiaPreview.rendering, state:await window.elysiaDesktop.getState()}))()`);
    const webPreferences = pet.webContents.getLastWebPreferences();
    if (!renderer.state?.settings || renderer.node !== 'undefined' || !webPreferences.sandbox || !webPreferences.contextIsolation || webPreferences.nodeIntegration) {
      throw new Error('Desktop host isolation / preload smoke check failed');
    }
    if (renderer.rendering?.mode !== 'rigid-layers') {
      throw new Error('Desktop character layered rendering smoke check failed');
    }
    const desktopChecks=smokeNativeHotkeys?null:require('./desktop-smoke.cjs').checkDesktopWindow({window:pet,pointer:desktopPointer,topmost,place:placePet,displays:screen.getAllDisplays()});
    console.log(JSON.stringify({ smoke: 'ok', nativeSpaceChord: smokeNativeHotkeys ? 'passed-on-own-foreground-window' : 'not-requested', renderer, desktopChecks, bounds: pet.getBounds(), security: { sandbox: webPreferences.sandbox, contextIsolation: webPreferences.contextIsolation, nodeIntegration: webPreferences.nodeIntegration } }));
    app.quit();
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => recover());
  app.whenReady().then(async () => {
    settingsFile = path.join(app.getPath('userData'), 'settings.json');
    loadSettings();
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !isLocalResource(details.url, root) && !details.url.startsWith('data:') && !details.url.startsWith('blob:') });
    });
    registerIpc();
    tray = new Tray(nativeImage.createFromBuffer(trayPng()));
    tray.setToolTip('爱莉希雅桌宠 · Ctrl+Alt+P 恢复操作');
    tray.on('click', () => recover());
    tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
    hotkeys.recovery = globalShortcut.register('CommandOrControl+Alt+P', () => recover());
    configureAlternateHotkeys();
    configureLegacyHotkeys();
    await createWindow();
    const constrainToScreen = () => { if (pet && !pet.isDestroyed()) { dragLifecycle?.cancelDrag();placePet(restoreBounds(pet.getBounds(),screen.getAllDisplays()));topmost?.refresh(); } };
    screen.on('display-removed', constrainToScreen);
    screen.on('display-metrics-changed', constrainToScreen);
  }).catch((error) => { console.error(error); app.exit(1); });
}
app.on('before-quit', () => {
  quitting = true;
  clearInterval(pointerTimer);
  dragLifecycle?.dispose();
  topmost?.dispose();
  desktopPointer?.reset();
  clearTimeout(saveTimer);
  if (pet && !pet.isDestroyed()) {
    try {
      const { x, y } = pet.getBounds();
      fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
      fs.writeFileSync(settingsFile, JSON.stringify({ settings: preferences, position: { x, y } }, null, 2));
    } catch { /* Shutdown must still release input listeners. */ }
  }
  if (legacyProcess) legacyProcess.kill();
  legacyProcess = null;
  globalShortcut.unregisterAll();
  if (tray) tray.destroy();
});
app.on('window-all-closed', () => app.quit());
