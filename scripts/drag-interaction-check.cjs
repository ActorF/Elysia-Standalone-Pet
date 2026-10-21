/** Browser integration checks for held dragging, redraw exceptions and release recovery. */
'use strict';
const { createServer } = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { DEFAULT_SETTINGS } = require('../electron/host-policy.cjs');

const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'artifacts', 'drag-interaction-check.json');
const types = { '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  try { response.setHeader('Content-Type', types[path.extname(file)] || 'text/plain'); response.end(fs.readFileSync(file)); }
  catch { response.writeHead(404).end(); }
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const report = { checks: [], errors: [] };
  try {
    const page = await browser.newPage({ viewport: { width: 420, height: 560 }, deviceScaleFactor: 2 });
    page.on('pageerror', error => report.errors.push(error.message));
    await page.addInitScript(settings => {
      const host = { settings: { ...settings }, hotkeys: { legacy: { active: false } } };
      const callbacks = {};
      const metrics = () => ({ frames: 0, clears: 0, draws: 0, resets: 0 });
      const qa = window.__dragQA = {
        metrics: metrics(), starts: 0, ends: 0, gotCapture: 0, lostCapture: 0, dragStates: [], hitRegions: [], appearances: [], active: false, pointerId: null,
        reset() { this.metrics = metrics(); },
        action(value) { callbacks.action(value); },
        dragState(active) { this.active = active; this.dragStates.push(active); callbacks.dragState(active); },
        pointer(value) { callbacks.pointer(value); },
      };
      const raf = window.requestAnimationFrame;
      window.requestAnimationFrame = function(callback) {
        return raf.call(this, timestamp => {
          if (callback.name === 'frame') qa.metrics.frames++;
          callback(timestamp);
        });
      };
      for (const [method, counter] of [['clearRect', 'clears'], ['drawImage', 'draws']]) {
        const original = CanvasRenderingContext2D.prototype[method];
        CanvasRenderingContext2D.prototype[method] = function(...args) {
          if (this.canvas.id === 'pet') qa.metrics[counter]++;
          return original.apply(this, args);
        };
      }
      for (const name of ['width', 'height']) {
        const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, name);
        Object.defineProperty(HTMLCanvasElement.prototype, name, {
          ...original,
          set(value) {
            if (this.id === 'pet') qa.metrics.resets++;
            return original.set.call(this, value);
          },
        });
      }
      document.addEventListener('pointerdown', event => { qa.pointerId = event.pointerId; }, true);
      document.addEventListener('gotpointercapture', () => qa.gotCapture++, true);
      document.addEventListener('lostpointercapture', () => qa.lostCapture++, true);
      window.elysiaDesktop = {
        getState: async () => structuredClone(host),
        onPointer(callback) { callbacks.pointer = callback; },
        onDragState(callback) { callbacks.dragState = callback; },
        onAction(callback) { callbacks.action = callback; },
        onSettings(callback) { callbacks.settings = callback; },
        setSettings: async patch => { Object.assign(host.settings, patch); return structuredClone(host); },
        setAppearance(value) { qa.appearances.push(structuredClone(value)); },
        setHitRegion: async value => { qa.hitRegions.push(structuredClone(value)); return true; },
        dragStart() { qa.starts++; qa.dragState(true); },
        dragEnd() { qa.ends++; qa.dragState(false); },
        showMenu() { throw new Error('Character interaction must never open a menu'); },
        quit() {},
      };
    }, DEFAULT_SETTINGS);
    await page.goto(`http://127.0.0.1:${server.address().port}/renderer/index.html`);
    await page.waitForSelector('html[data-ready="true"]', { timeout: 30000 });
    await page.waitForFunction(() => window.__dragQA.hitRegions.some(region => region.rects.length > 0));

    const reset = () => page.evaluate(() => window.__dragQA.reset());
    const snapshot = () => page.evaluate(() => ({ ...window.__dragQA.metrics, time: window.elysiaPreview.snapshot().time, state: window.elysiaPreview.snapshot(), hitRegion: window.__dragQA.hitRegions.at(-1) }));
    async function pausedCheck(name, work = () => page.waitForTimeout(500)) {
      await reset();
      const before = await snapshot();
      await work();
      const after = await snapshot();
      assert.equal(after.clears, 0, `${name}: held character must not redraw`);
      assert.equal(after.draws, 0, `${name}: held character must reuse its existing bitmap`);
      assert.equal(after.resets, 0, `${name}: canvas dimensions must remain intact`);
      assert.equal(after.time, before.time, `${name}: motion time pauses while held`);
      assert.ok(after.frames >= 3, `${name}: rAF must continue so release stays responsive`);
      report.checks.push({ name, ...after, state: undefined, hitRegion: undefined });
    }
    async function resumedCheck(name, release) {
      await reset();
      const before = await snapshot();
      await release();
      await page.waitForFunction(() => window.__dragQA.metrics.clears >= 3, undefined, { timeout: 5000 });
      const after = await snapshot();
      assert.ok(after.time > before.time, `${name}: animation time must resume`);
      report.checks.push({ name, ...after, state: undefined, hitRegion: undefined });
    }
    async function heldRedrawCheck(name, action, assertState) {
      await reset();
      const before = await snapshot();
      await page.evaluate(value => window.__dragQA.action(value), action);
      await page.waitForFunction(() => window.__dragQA.metrics.clears >= 1);
      await page.waitForTimeout(200);
      const after = await snapshot();
      assert.equal(after.clears, 1, `${name}: update once, then hold the changed appearance`);
      assert.equal(after.time, before.time, `${name}: appearance changes must not restart motion while held`);
      assertState(after.state);
      report.checks.push({ name, ...after, state: undefined, hitRegion: undefined });
    }
    const hold = async () => {
      await page.mouse.move(210, 220);
      await page.mouse.down();
      // Pointer capture becomes active on the next real pointer event.
      await page.mouse.move(211, 221);
      await page.waitForFunction(() => window.__dragQA.active);
    };

    await hold();
    await pausedCheck('held for 500ms');
    await pausedCheck('rapid held cursor burst', async () => {
      for (let i = 0; i < 48; i++) await page.mouse.move(i % 2 ? 380 : 35, 45 + (i * 43) % 450);
      await page.waitForTimeout(100);
    });
    await heldRedrawCheck('expression refresh', { type: 'expression', id: 'blush' }, state => assert.equal(state.expression, 'blush'));
    await heldRedrawCheck('pose refresh', { type: 'pose', id: 'tea' }, state => assert.equal(state.pose, 'tea'));
    await heldRedrawCheck('glasses refresh', { type: 'toggle-skin', id: 'glasses' }, state => assert.equal(state.glasses, true));
    await pausedCheck('same-size resize notifications', async () => {
      await page.evaluate(() => { for (let i = 0; i < 25; i++) window.dispatchEvent(new Event('resize')); });
      await page.waitForTimeout(200);
    });
    await reset();
    const beforeResize = await snapshot();
    await page.setViewportSize({ width: 480, height: 640 });
    await page.waitForFunction(() => window.__dragQA.metrics.clears >= 1);
    await page.waitForTimeout(200);
    const resized = await snapshot();
    assert.equal(resized.clears, 1, 'Actual scale change redraws exactly once while held');
    assert.equal(resized.resets, 2, 'Actual scale change replaces both backing dimensions once');
    assert.equal(resized.time, beforeResize.time);
    assert.equal(resized.hitRegion.width, 600); assert.equal(resized.hitRegion.height, 800);
    assert.equal(resized.hitRegion.space, 'character', 'Shape stays in canonical coordinates across viewport resizing');
    report.checks.push({ name: 'actual viewport resize', ...resized, state: undefined, hitRegion: undefined });
    await pausedCheck('removed panel actions stay inert while held', async () => {
      await page.evaluate(() => window.__dragQA.action({ type: 'show-controls' }));
      await page.waitForTimeout(100);
      await page.evaluate(() => window.__dragQA.action({ type: 'toggle-controls' }));
      await page.waitForTimeout(100);
      assert.equal(await page.locator('#controls, button, input, .panel').count(), 0, 'Removed panel actions cannot recreate settings UI');
    });
    await resumedCheck('pointer release resumes', () => page.mouse.up());

    await hold();
    await pausedCheck('second hold', () => page.waitForTimeout(120));
    await resumedCheck('native cancellation resumes', () => page.evaluate(() => window.__dragQA.dragState(false)));
    await page.mouse.up();
    await hold();
    await resumedCheck('window blur resumes', () => page.evaluate(() => window.dispatchEvent(new Event('blur'))));
    await page.mouse.up();
    await hold();
    await resumedCheck('lost pointer capture resumes', async () => {
      await page.evaluate(() => document.querySelector('#pet').releasePointerCapture(window.__dragQA.pointerId));
      await page.mouse.move(215, 225);
    });
    await page.mouse.up();

    report.host = await page.evaluate(() => ({ starts: window.__dragQA.starts, ends: window.__dragQA.ends, gotCapture: window.__dragQA.gotCapture, lostCapture: window.__dragQA.lostCapture, dragStates: window.__dragQA.dragStates, hitRegionUpdates: window.__dragQA.hitRegions.length }));
    assert.ok(report.host.starts >= 4);
    assert.deepEqual(report.errors, []);
    report.status = 'passed';
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, checks: report.checks.map(({ name, frames, clears, draws, resets }) => ({ name, frames, clears, draws, resets })), host: report.host, errors: report.errors }));
  } catch (error) {
    report.status = 'failed'; report.failure = error.message;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, JSON.stringify(report, null, 2));
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
