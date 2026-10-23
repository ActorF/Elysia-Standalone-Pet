'use strict';

/** Bounded real-GPU audit for tray motion preferences and their native hit envelope. */
const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('node:http');
const { chromium } = require('playwright');
const { DEFAULT_SETTINGS } = require('../electron/host-policy.cjs');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts', 'motion-settings-check.json');
const server = createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html><body></body></html>');
      return;
    }
    const filename = path.resolve(root, `.${pathname}`);
    if (!filename.startsWith(root + path.sep)) {
      response.writeHead(403).end();
      return;
    }
    response.setHeader('Content-Type', {
      '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png',
    }[path.extname(filename)] || 'application/octet-stream');
    response.end(fs.readFileSync(filename));
  } catch {
    response.writeHead(404).end();
  }
});

// A controllable animation clock makes IPC phase-continuity checks deterministic.
// This still imports the actual app and paints through its actual WebGL renderer.
function installDesktopBridge(defaults) {
  const callbacks = {}, frames = new Map();
  const settings = { ...defaults, eyeTracking: false, keyDisplay: false };
  const viewport = { width: 740, height: 800, characterX: 140, characterY: 0,
    characterWidth: 600, characterHeight: 800, clipped: false };
  let nextFrame = 0, now = null;
  const nativeRead = CanvasRenderingContext2D.prototype.getImageData;
  let readbacks = 0;
  CanvasRenderingContext2D.prototype.getImageData = function (...args) {
    readbacks++;
    return nativeRead.apply(this, args);
  };
  window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
  window.cancelAnimationFrame = id => frames.delete(id);
  window.__motionSettingsQA = {
    regions: [],
    readbacks: () => readbacks,
    pixels() {
      const canvas = document.querySelector('#pet');
      return nativeRead.call(canvas.getContext('2d'), 0, 0, canvas.width, canvas.height).data;
    },
    tick(milliseconds = 0) {
      now = (now ?? performance.now()) + milliseconds;
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(now);
    },
    set(patch) {
      Object.assign(settings, patch);
      callbacks.settings({ settings: { ...settings } });
    },
  };
  window.elysiaDesktop = {
    getState: async () => ({ settings: { ...settings }, viewport }),
    onPointer: callback => { callbacks.pointer = callback; },
    onDragState: callback => { callbacks.drag = callback; },
    onAction: callback => { callbacks.action = callback; },
    onSettings: callback => { callbacks.settings = callback; },
    onViewport: callback => { callbacks.viewport = callback; },
    onTypedKey: callback => { callbacks.typed = callback; },
    setAppearance() {}, dragStart() {}, dragEnd() {},
    setHitRegion: async region => { window.__motionSettingsQA.regions.push(region); return true; },
    setSettings: async patch => { Object.assign(settings, patch); return { settings: { ...settings } }; },
  };
}

async function auditGpu(page) {
  return page.evaluate(async () => {
    const { loadCharacter, drawCharacter } = await import('/renderer/faithful-character.mjs');
    const { createCharacterHitRegion, prepareCharacterHitRegions } = await import('/renderer/hit-region.mjs');
    const { createPetState, advance } = await import('/renderer/state.mjs');
    const atlas = await loadCharacter();
    const probe = document.createElement('canvas').getContext('webgl');
    const debug = probe?.getExtension('WEBGL_debug_renderer_info');
    const renderer = debug ? probe.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null;
    const checks = [], coverage = [], speedEquivalence = [];
    const check = (name, passed, details = {}) => checks.push({ name, passed: Boolean(passed), ...details });
    const gpu = { accelerated: atlas.mesh.accelerated, renderer };
    check('WebGL mesh uses the hardware GPU', gpu.accelerated && renderer
      && !/swiftshader|llvmpipe|software|basic render/i.test(renderer), gpu);
    if (!checks[0].passed) return { passed: false, checks, gpu, coverage, frames: 0 };

    const width = 600, height = 800, amplitudes = [0, .5, 1, 2];
    const poses = ['idle', 'megaphone', 'cake', 'tea'];
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const nativeRead = CanvasRenderingContext2D.prototype.getImageData;
    const counters = { canvas2d: 0, webgl: 0 };
    const patched = [];
    function monitor(prototype, name, key) {
      if (!prototype?.[name]) return;
      const original = prototype[name];
      patched.push(() => { prototype[name] = original; });
      prototype[name] = function (...args) { counters[key]++; return original.apply(this, args); };
    }
    monitor(CanvasRenderingContext2D.prototype, 'getImageData', 'canvas2d');
    monitor(window.WebGLRenderingContext?.prototype, 'readPixels', 'webgl');
    monitor(window.WebGL2RenderingContext?.prototype, 'readPixels', 'webgl');
    // Only the audit reads the finished frame. Exclude those reads from the
    // application counters, so cached settings changes cannot hide a readback.
    const capture = (state, settings) => {
      drawCharacter(ctx, atlas, state, settings);
      return nativeRead.call(ctx, 0, 0, width, height).data;
    };
    function differentPixels(a, b) {
      let different = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) different++;
      }
      return different;
    }
    function occupancy(region) {
      const mask = new Uint8Array(width * height);
      for (const rect of region.rects) {
        for (let y = Math.max(0, rect.y); y < Math.min(height, rect.y + rect.height); y++) {
          mask.fill(1, y * width + Math.max(0, rect.x), y * width + Math.min(width, rect.x + rect.width));
        }
      }
      return mask;
    }
    // Mesh peaks/troughs, zero crossings and intermediate phases. Decorations
    // use a different frequency, so their own peaks/troughs are added below.
    const phases = [0, Math.PI / 4, Math.PI / 2, Math.PI, 5 * Math.PI / 4, 3 * Math.PI / 2, 2 * Math.PI]
      .map(angle => angle / .9);
    const uniqueRegions = new Set();
    let frames = 0, zeroAmplitudeDifferences = 0, buildWallMs = 0;
    try {
      for (const amplitude of amplitudes) {
        for (const pose of poses) for (const cat of [false, true]) for (const expression of [null, 'sleep', 'dizzy']) {
          const state = { ...createPetState(), pose, cat, expression, glasses: true };
          const settings = { hairMotion: true, eyeTracking: true, motionAmplitude: amplitude, motionSpeed: 1 };
          const start = performance.now();
          const region = createCharacterHitRegion(atlas, state, settings);
          const buildMs = performance.now() - start;
          buildWallMs += buildMs; uniqueRegions.add(region);
          const mask = occupancy(region);
          const samples = phases.map(time => ({ time, gaze: { x: 0, y: 0 }, blink: 0 }));
          if (expression) for (const time of [Math.PI / 2 / .8, 3 * Math.PI / 2 / .8]) {
            samples.push({ time, gaze: { x: 0, y: 0 }, blink: 0 });
          }
          for (const x of [-1, 1]) for (const y of [-1, 1]) {
            samples.push({ time: x > 0 ? Math.PI / 2 / .9 : 3 * Math.PI / 2 / .9,
              gaze: { x, y }, blink: x === y ? 1 : 0 });
          }
          let missingPixels = 0, firstMissing = null, minVisiblePixels = Infinity, still = null;
          for (let sample = 0; sample < samples.length; sample++) {
            Object.assign(state, samples[sample], { motionTime: samples[sample].time });
            const pixels = capture(state, settings);
            if (amplitude === 0 && samples[sample].gaze.x === 0) {
              if (still) zeroAmplitudeDifferences += differentPixels(still, pixels);
              else still = pixels;
            }
            let visible = 0;
            for (let pixel = 0; pixel < mask.length; pixel++) {
              const alpha = pixels[pixel * 4 + 3];
              if (alpha < 4) continue;
              visible++;
              if (!mask[pixel]) {
                missingPixels++;
                firstMissing ??= { x: pixel % width, y: Math.floor(pixel / width), alpha, sample, ...samples[sample] };
              }
            }
            minVisiblePixels = Math.min(minVisiblePixels, visible); frames++;
          }
          const repeat = createCharacterHitRegion(atlas, { ...state, time: 999, motionTime: 333, glasses: false },
            { ...settings, motionSpeed: 3 });
          coverage.push({ amplitude, pose, cat, expression, frames: samples.length, missingPixels, firstMissing,
            minVisiblePixels, stable: repeat === region, rectangles: region.rects.length,
            area: mask.reduce((sum, value) => sum + value, 0), buildMs });
        }
        console.log(`motion settings: GPU coverage completed for amplitude ${amplitude}`);
      }
      check('Every rendered alpha >= 4 pixel stays in the native region',
        coverage.every(item => item.missingPixels === 0 && item.minVisiblePixels > 1000),
        { failures: coverage.filter(item => item.missingPixels || item.minVisiblePixels <= 1000) });
      check('Amplitude zero keeps body and sleep/dizzy decorations still', zeroAmplitudeDifferences === 0,
        { differentPixels: zeroAmplitudeDifferences });
      check('Time, speed, gaze and glasses reuse the cached region', coverage.every(item => item.stable));
      check('Every amplitude has a distinct cached region for each tested appearance', uniqueRegions.size === coverage.length,
        { uniqueRegions: uniqueRegions.size, appearances: coverage.length });
      const idleAreas = amplitudes.map(amplitude => coverage.find(item => item.amplitude === amplitude
        && item.pose === 'idle' && !item.cat && item.expression === null).area);
      check('Larger amplitudes expand the native motion envelope', idleAreas[0] < idleAreas[3]
        && idleAreas.every((area, i) => !i || area >= idleAreas[i - 1]), { amplitudes, areas: idleAreas });

      const readbacksAfterBuild = { ...counters };
      const cachedStart = performance.now();
      for (const amplitude of amplitudes) await prepareCharacterHitRegions(atlas,
        { motionAmplitude: amplitude, motionSpeed: .25 });
      const targetPhase = 2.25;
      for (const pose of poses) for (const cat of [false, true]) {
        const expression = pose === 'tea' ? 'sleep' : pose === 'cake' ? 'dizzy' : null;
        const state = { ...createPetState(), pose, cat, expression, motionTime: targetPhase, time: 987 };
        const settings = { hairMotion: true, eyeTracking: false, motionAmplitude: 2, motionSpeed: 1 };
        const region = createCharacterHitRegion(atlas, state, settings);
        const baseline = capture(state, settings);
        for (const speed of [.25, .5, 1, 2, 3]) {
          const next = { ...settings, motionSpeed: speed };
          const fixedClockDifference = differentPixels(baseline, capture(state, next));
          const previewDifference = differentPixels(baseline,
            capture({ ...state, motionTime: null, time: targetPhase / speed }, next));
          speedEquivalence.push({ pose, cat, expression, speed, fixedClockDifference, previewDifference,
            sameRegion: region === createCharacterHitRegion(atlas, state, next) });
        }
      }
      const cachedMs = performance.now() - cachedStart;
      check('Speed changes preserve pixels at equal motionTime and preview time * speed',
        speedEquivalence.every(item => item.fixedClockDifference === 0 && item.previewDifference === 0),
        { failures: speedEquivalence.filter(item => item.fixedClockDifference || item.previewDifference) });
      check('Speed changes do not rebuild a region or read back application pixels',
        speedEquivalence.every(item => item.sameRegion) && counters.canvas2d === readbacksAfterBuild.canvas2d
        && counters.webgl === readbacksAfterBuild.webgl,
        { before: readbacksAfterBuild, after: { ...counters }, cachedMs });

      const state = createPetState();
      check('New states defer their motion clock until their first advance', state.motionTime === null);
      state.time = 37.5; state.nextBlink = Infinity;
      advance(state, 0, { motionSpeed: 1 });
      let expected = 37.5, maxPhaseError = 0, changedAtSwitch = 0;
      const switches = [];
      for (const speed of [.25, 3, .5, 2, 1]) {
        const before = state.motionTime;
        advance(state, 0, { motionSpeed: speed });
        const after = state.motionTime;
        changedAtSwitch += Math.abs(after - before);
        for (let i = 0; i < 12; i++) {
          advance(state, .016, { motionSpeed: speed });
          expected += .016 * speed;
          maxPhaseError = Math.max(maxPhaseError, Math.abs(state.motionTime - expected));
        }
        switches.push({ speed, before, after, end: state.motionTime });
      }
      check('Continuous speed changes integrate without a phase jump', changedAtSwitch === 0 && maxPhaseError < 1e-10,
        { changedAtSwitch, maxPhaseError, switches });
      const offState = { ...createPetState(), pose: 'tea', cat: true, expression: 'sleep', motionTime: 4 };
      check('The existing motion toggle overrides amplitude for pixels and region',
        differentPixels(capture(offState, { hairMotion: false, motionAmplitude: 2 }),
          capture(offState, { hairMotion: true, motionAmplitude: 0 })) === 0
        && createCharacterHitRegion(atlas, offState, { hairMotion: false, motionAmplitude: 2 })
          === createCharacterHitRegion(atlas, offState, { motionAmplitude: 0 }));

      return { passed: checks.every(item => item.passed), checks, gpu, coverage, speedEquivalence, frames,
        cache: { observedUniqueRegions: uniqueRegions.size, buildWallMs,
          maxBuildMs: Math.max(...coverage.map(item => item.buildMs)),
          initialBuildReadbacks: readbacksAfterBuild, afterSpeedChangesReadbacks: { ...counters }, cachedMs } };
    } finally {
      for (const restore of patched.reverse()) restore();
      probe.getExtension('WEBGL_lose_context')?.loseContext();
    }
  });
}

async function auditApp(browser, baseUrl) {
  const page = await browser.newPage({ viewport: { width: 740, height: 800 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(installDesktopBridge, DEFAULT_SETTINGS);
    await page.goto(`${baseUrl}/renderer/index.html`);
    await page.waitForSelector('html[data-ready="true"]', { timeout: 120000 });
    const result = await page.evaluate(() => {
      const qa = window.__motionSettingsQA, preview = window.elysiaPreview, checks = [], updates = [];
      const check = (name, passed, details = {}) => checks.push({ name, passed: Boolean(passed), ...details });
      const differences = (a, b) => {
        let count = 0;
        for (let i = 0; i < a.length; i += 4) {
          if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) count++;
        }
        return count;
      };
      const latestRegion = () => qa.regions.at(-1);
      const area = region => region.rects.reduce((sum, rect) => sum + rect.width * rect.height, 0);
      qa.tick(0);
      check('Desktop defaults arrive in the app', preview.settings().motionAmplitude === 1
        && preview.settings().motionSpeed === 1);
      qa.set({ motionAmplitude: 0 }); qa.tick(0);
      // Repeated diagnostic reads can make Chromium migrate a Canvas2D backing
      // surface. Warm that path before comparing pixels across animation time;
      // the character mesh itself remains hardware WebGL throughout.
      qa.pixels(); qa.pixels(); qa.pixels(); qa.tick(0);
      const zeroPixels = qa.pixels();
      const zeroBefore = preview.snapshot();
      const zeroArea = area(latestRegion());
      // Stay below the first blink; natural blink timing is not a sway setting.
      for (let i = 0; i < 25; i++) qa.tick(40);
      const zeroDifferences = differences(zeroPixels, qa.pixels());
      check('IPC amplitude zero freezes the rendered app', zeroDifferences === 0,
        { differentPixels: zeroDifferences, before: zeroBefore, after: preview.snapshot() });
      const zeroAtPhase = qa.pixels();
      qa.set({ motionAmplitude: 2 }); qa.tick(0);
      const largeArea = area(latestRegion());
      check('IPC amplitude changes reach the GPU and expand the native region',
        preview.settings().motionAmplitude === 2 && differences(zeroAtPhase, qa.pixels()) > 0 && largeArea > zeroArea,
        { zeroArea, largeArea });
      for (const amplitude of [.5, 1, 2]) {
        qa.set({ motionAmplitude: amplitude }); qa.tick(0);
        check(`IPC amplitude ${amplitude} is received`, preview.settings().motionAmplitude === amplitude);
      }
      const readbacksBefore = qa.readbacks();
      const regionBefore = JSON.stringify(latestRegion());
      let maxPhaseError = 0, zeroDeltaPixelChanges = 0;
      for (const speed of [.25, 3, .5, 1]) {
        const before = preview.snapshot().motionTime, pixels = qa.pixels();
        qa.set({ motionSpeed: speed }); qa.tick(0);
        const after = preview.snapshot().motionTime;
        const changedPixels = differences(pixels, qa.pixels());
        zeroDeltaPixelChanges += changedPixels;
        const sameRegion = JSON.stringify(latestRegion()) === regionBefore;
        qa.tick(16);
        const advanced = preview.snapshot().motionTime;
        maxPhaseError = Math.max(maxPhaseError, Math.abs(advanced - (before + .016 * speed)));
        updates.push({ speed, received: preview.settings().motionSpeed, before, after, advanced, changedPixels, sameRegion });
      }
      check('IPC speed changes retain phase and pixels until the next elapsed frame',
        updates.every(item => item.received === item.speed && item.before === item.after)
        && zeroDeltaPixelChanges === 0 && maxPhaseError < 1e-9, { maxPhaseError, zeroDeltaPixelChanges });
      check('IPC speed changes reuse hit geometry without additional readbacks',
        updates.every(item => item.sameRegion) && qa.readbacks() === readbacksBefore,
        { readbacksBefore, readbacksAfter: qa.readbacks(), publishedRegions: qa.regions.length });
      return { passed: checks.every(item => item.passed), checks, updates, rendering: preview.rendering,
        uniquePublishedRegions: new Set(qa.regions.map(region => JSON.stringify(region))).size };
    });
    return { ...result, errors, passed: result.passed && errors.length === 0 };
  } finally {
    await page.close();
  }
}

(async () => {
  const started = performance.now();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const errors = [];
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const page = await browser.newPage({ viewport: { width: 600, height: 800 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'log') console.log(message.text()); });
    await page.goto(baseUrl);
    const gpu = await auditGpu(page);
    await page.close();
    const app = await auditApp(browser, baseUrl);
    const passed = gpu.passed && app.passed && errors.length === 0;
    const result = { passed, elapsedMs: performance.now() - started, gpu, app, browserErrors: errors };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ passed, frames: gpu.frames, appearances: gpu.coverage.length,
      cache: gpu.cache, appChecks: app.checks.length, elapsedMs: result.elapsedMs,
      failures: [...gpu.checks, ...app.checks].filter(check => !check.passed), output }));
    if (!passed) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => server.close());
