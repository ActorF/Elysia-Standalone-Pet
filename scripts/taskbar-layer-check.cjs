/** Native Windows integration for taskbar-relative layering. Run with Node. */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  if (!process.argv[index + 1] || process.argv[index + 1].startsWith('--')) throw new Error(`${name} requires a path.`);
  return process.argv[index + 1];
}
const appArchive = argument('--app-archive');
if (appArchive && !path.isAbsolute(appArchive)) throw new Error('--app-archive must be an absolute app.asar path.');
const runtimeRoot = appArchive || root;
const reportPath = path.resolve(argument('--report') || path.join(root, 'artifacts', 'taskbar-layer-check.json'));
const workerFlag = '--taskbar-layer-check-worker';
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function launch() {
  if (process.platform !== 'win32') throw new Error('This native integration check requires Windows.');
  const executable = require('electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [__filename, workerFlag, ...process.argv.slice(2)], { env, windowsHide: true, stdio: 'inherit' });
  child.once('error', error => { console.error(error); process.exitCode = 1; });
  child.once('exit', code => { process.exitCode = code ?? 1; });
}

function startProbe(hwnd) {
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(__dirname, 'taskbar-order-probe.ps1'), '-TargetHwnd', hwnd, '-OwnerProcessId', String(process.pid)],
  { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let sequence = 0, stderr = '', closed = false, readyResolve, readyReject;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const startupTimer = setTimeout(() => readyReject(new Error('Win32 probe startup timed out.')), 15000);
  function rejectPending(error) {
    readyReject(error);
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
    pending.clear();
  }
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-5000); });
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', line => {
    let response;
    try { response = JSON.parse(line.replace(/^\uFEFF/, '')); }
    catch { rejectPending(new Error(`Invalid probe response: ${line}`)); return; }
    if (response.ready) { clearTimeout(startupTimer); readyResolve(); return; }
    const item = pending.get(response.sequence);
    if (!item) return;
    clearTimeout(item.timer); pending.delete(response.sequence);
    if (response.error) item.reject(new Error(response.error)); else item.resolve(response.snapshot);
  });
  child.once('error', rejectPending);
  child.once('exit', code => {
    clearTimeout(startupTimer);
    if (!closed) rejectPending(new Error(`Win32 probe exited (${code}): ${stderr}`));
  });
  return {
    ready,
    async read(action = 'snapshot', peerHwnd = null) {
      await ready;
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Win32 probe response timed out.')); }, 5000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ sequence: id, action, peerHwnd }) + '\n');
      });
    },
    async close() {
      closed = true; clearTimeout(startupTimer); child.stdin.end();
      if (child.exitCode === null) await Promise.race([
        new Promise(resolve => child.once('exit', resolve)), delay(1000),
      ]);
      if (child.exitCode === null) child.kill();
      lines.close();
    },
  };
}

async function worker() {
  const { app, BrowserWindow, screen } = require('electron');
  const { createTopmostController, REASSERT_INTERVAL_MS } = require(path.join(runtimeRoot, 'electron', 'window-layer.cjs'));
  const { createTaskbarOrderer } = require(path.join(runtimeRoot, 'electron', 'taskbar-order.cjs'));
  const temporaryProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'elysia-taskbar-check-'));
  app.setPath('userData', temporaryProfile);
  app.disableHardwareAcceleration();
  app.on('window-all-closed', () => {});
  const report = {
    status: 'running', startedAt: new Date().toISOString(), electron: process.versions.electron,
    platform: process.platform, controller: 'electron/window-layer.cjs',
    appArchive, runtimeRoot,
    scope: 'Only the isolated test window is reordered. Native probe is read-only; no input is injected.',
    checks: [], samples: [], errors: [], focusEvents: 0,
  };
  let window, controller, probe, sibling, siblingOrderer, baselineForeground;
  const nativeHandle = win => {
    const handle = win.getNativeWindowHandle();
    return '0x' + (handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString(16);
  };
  function check(name, passed, details) { report.checks.push({ name, passed: Boolean(passed), ...(details ? { details } : {}) }); }
  async function sample(label, expected = {}) {
    const started = Date.now();
    let snapshot = await probe.read();
    // The secondary-taskbar helper needs one PowerShell/Add-Type startup.
    // Require actual native convergence, rather than assuming a fixed delay.
    if (expected.order === 'below') {
      while (Date.now() - started < 5000 && !(snapshot.target?.topmost && snapshot.taskbars.length &&
          snapshot.taskbars.every(taskbar => snapshot.target.rank > taskbar.rank))) {
        await delay(50); snapshot = await probe.read();
      }
    }
    if (!baselineForeground) baselineForeground = snapshot.foreground.hwnd;
    const state = { label, ...snapshot, convergenceMs: Date.now() - started, electronVisible: window.isVisible(), electronAlwaysOnTop: window.isAlwaysOnTop(),
      enabled: controller?.enabled ?? false, taskbarInFront: controller?.taskbarInFront ?? null };
    report.samples.push(state);
    check(`${label}: complete native window walk`, snapshot.chainComplete && snapshot.target !== null);
    check(`${label}: test window never became foreground`, snapshot.foreground.hwnd !== snapshot.target?.hwnd);
    check(`${label}: foreground unchanged`, snapshot.foreground.hwnd === baselineForeground,
      snapshot.foreground.hwnd === baselineForeground ? undefined : 'External focus changes also fail this check; inspect samples before attributing them to the app.');
    if ('visible' in expected) check(`${label}: visibility`, snapshot.target?.visible === expected.visible && window.isVisible() === expected.visible);
    if ('topmost' in expected) check(`${label}: actual WS_EX_TOPMOST`, snapshot.target?.topmost === expected.topmost);
    if (expected.order) {
      check(`${label}: a visible Windows taskbar was found`, snapshot.taskbars.length > 0);
      for (const taskbar of snapshot.taskbars) {
        const passed = expected.order === 'above' ? snapshot.target.rank < taskbar.rank : snapshot.target.rank > taskbar.rank;
        check(`${label}: ${expected.order} ${taskbar.className} ${taskbar.hwnd}`, passed,
          { targetRank: snapshot.target.rank, taskbarRank: taskbar.rank, taskbarTopmost: taskbar.topmost });
      }
    }
    return state;
  }
  const settle = () => delay(60);
  const maintenance = () => delay(REASSERT_INTERVAL_MS + 250);
  try {
    await app.whenReady();
    report.displays = screen.getAllDisplays().map(({ id, bounds, scaleFactor }) => ({ id, bounds, scaleFactor }));
    const bounds = screen.getPrimaryDisplay().bounds;
    window = new BrowserWindow({ x: bounds.x + 8, y: bounds.y + 8, width: 32, height: 32,
      show: false, opacity: 0, frame: false, transparent: true, focusable: false, skipTaskbar: true,
      resizable: false, minimizable: false, maximizable: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    window.setIgnoreMouseEvents(true);
    window.on('focus', () => { report.focusEvents++; });
    const hwnd = nativeHandle(window);
    report.targetHwnd = hwnd;
    probe = startProbe(hwnd);
    await probe.ready;
    await sample('hidden baseline', { visible: false, topmost: false });
    controller = createTopmostController(window, { enabled: true, taskbarInFront: true,
      onError: error => report.errors.push(error.stack || error.message) });
    await sample('below-taskbar preference before showing', { visible: false, topmost: true });
    window.showInactive(); await settle();
    await sample('below-taskbar initial show', { visible: true, topmost: true, order: 'below' });
    await maintenance();
    await sample('below-taskbar periodic maintenance', { visible: true, topmost: true, order: 'below' });

    // Perturb only our own HWND to prove the timer repairs its ordering.
    window.moveTop();
    await sample('below-taskbar test-only displacement', { visible: true, topmost: true });
    await maintenance();
    await sample('below-taskbar timer repair', { visible: true, topmost: true, order: 'below' });

    // A second invisible, non-focusable window owned by this test simulates a
    // topmost app between the taskbars and pet. Use the same production helper
    // for insertion, then stop its maintenance so the pet must recover above it.
    sibling = new BrowserWindow({ x: bounds.x + 8, y: bounds.y + 8, width: 32, height: 32,
      show: false, opacity: 0, frame: false, transparent: true, focusable: false, skipTaskbar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    sibling.setIgnoreMouseEvents(true); sibling.on('focus', () => { report.focusEvents++; });
    sibling.setAlwaysOnTop(true, 'screen-saver'); sibling.showInactive();
    const peerHwnd = nativeHandle(sibling);
    siblingOrderer = createTaskbarOrderer(sibling, { onError: error => report.errors.push(error.stack || error.message) });
    let obstructionObserved = false;
    for (let attempt = 0; attempt < 3 && !obstructionObserved; attempt++) {
      siblingOrderer.start();
      const deadline = Date.now() + 5000;
      while (!siblingOrderer.running && Date.now() < deadline) { await delay(10); siblingOrderer.start(); }
      check(`sibling insertion ${attempt + 1}: helper reached READY`, siblingOrderer.running);
      const obstructed = await probe.read('snapshot', peerHwnd);
      report.samples.push({ label: 'test-owned sibling insertion', ...obstructed });
      obstructionObserved = obstructed.peer?.topmost && obstructed.peer.rank < obstructed.target.rank &&
        obstructed.taskbars.every(taskbar => taskbar.rank < obstructed.peer.rank);
      siblingOrderer.stop();
      if (!obstructionObserved) await delay(150);
    }
    check('test-owned sibling was observed between taskbars and pet', obstructionObserved);
    await delay(350);
    const recovered = await probe.read('snapshot', peerHwnd);
    report.samples.push({ label: 'pet recovers above test-owned sibling', ...recovered });
    check('pet returns above competing topmost sibling while below all taskbars', recovered.target.topmost &&
      recovered.peer?.topmost && recovered.target.rank < recovered.peer.rank &&
      recovered.taskbars.every(taskbar => taskbar.rank < recovered.target.rank));
    check('sibling test did not change foreground', recovered.foreground.hwnd === baselineForeground);
    siblingOrderer.dispose(); sibling.destroy(); sibling = null;

    controller.setTaskbarInFront(false); await settle();
    await sample('above-taskbar preference switch', { visible: true, topmost: true, order: 'above' });
    await maintenance();
    await sample('above-taskbar periodic maintenance', { visible: true, topmost: true, order: 'above' });
    window.setAlwaysOnTop(true, 'floating');
    await sample('above-taskbar test-only displacement', { visible: true, topmost: true });
    await maintenance();
    await sample('above-taskbar timer repair', { visible: true, topmost: true, order: 'above' });

    window.hide(); await maintenance();
    await sample('hidden stays hidden across timer interval', { visible: false, topmost: true });
    controller.setTaskbarInFront(true); await settle();
    await sample('hidden preference switch stays hidden', { visible: false, topmost: true });
    window.showInactive(); await settle();
    await sample('show restores below-taskbar preference', { visible: true, topmost: true, order: 'below' });

    controller.setEnabled(false); await settle();
    await sample('always-on-top disabled', { visible: true, topmost: false });
    controller.setTaskbarInFront(false);
    await sample('disabled preference switch above', { visible: true, topmost: false });
    controller.setTaskbarInFront(true);
    await sample('disabled preference switch below', { visible: true, topmost: false });
    check('taskbar preference cannot reenable always-on-top', controller.enabled === false && controller.taskbarInFront === true);
    await maintenance();
    await sample('disabled remains non-topmost across timer interval', { visible: true, topmost: false });
    controller.setEnabled(true); await settle();
    await sample('reenabling restores stored taskbar preference', { visible: true, topmost: true, order: 'below' });

    const rememberedPreference = controller.taskbarInFront;
    controller.dispose();
    controller = createTopmostController(window, { enabled: true, taskbarInFront: rememberedPreference,
      onError: error => report.errors.push(error.stack || error.message) });
    await settle();
    await sample('new controller restores passed saved preference', { visible: true, topmost: true, order: 'below' });
    controller.setTaskbarInFront(false); await settle();
    await sample('final switch above all visible taskbars', { visible: true, topmost: true, order: 'above' });
    controller.setTaskbarInFront(true); await settle();
    await sample('exit path with active below-taskbar helper', { visible: true, topmost: true, order: 'below' });
    const activeHelpers = await probe.read('helpers');
    report.activeHelpersBeforeDisposal = activeHelpers;
    check('exit path has an active helper owned by this test PID', activeHelpers.length === 1);
    controller.dispose(); window.hide(); await settle();
    await sample('disposed and hidden', { visible: false, topmost: false });
    check('test window received zero focus events', report.focusEvents === 0);
  } catch (error) {
    report.errors.push(error.stack || String(error));
  } finally {
    controller?.dispose();
    siblingOrderer?.dispose();
    if (probe) {
      try {
        const started = Date.now();
        let remaining = await probe.read('helpers');
        while (remaining.length && Date.now() - started < 5000) { await delay(50); remaining = await probe.read('helpers'); }
        report.helperCleanup = { ownerProcessId: process.pid, elapsedMs: Date.now() - started, remaining };
        check('all taskbar helpers owned by this test exited after disposal', remaining.length === 0);
      } catch (error) { report.errors.push(error.stack || String(error)); }
    }
    if (sibling && !sibling.isDestroyed()) sibling.destroy();
    if (window && !window.isDestroyed()) window.destroy();
    await probe?.close();
    report.finishedAt = new Date().toISOString();
    report.failedChecks = report.checks.filter(item => !item.passed);
    report.status = report.errors.length || report.failedChecks.length ? 'failed' : 'passed';
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ status: report.status, checks: report.checks.length,
      failed: report.failedChecks.length, errors: report.errors, report: reportPath }));
    // Remove only this script's explicitly created temporary profile.
    if (path.dirname(temporaryProfile) === os.tmpdir() && path.basename(temporaryProfile).startsWith('elysia-taskbar-check-')) {
      try { fs.rmSync(temporaryProfile, { recursive: true, force: true }); } catch {}
    }
    app.exit(report.status === 'passed' ? 0 : 1);
  }
}

if (process.versions.electron && process.argv.includes(workerFlag)) {
  worker().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  launch();
}
