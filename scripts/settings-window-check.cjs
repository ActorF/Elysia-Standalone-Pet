'use strict';

// Browser interaction/visual QA only. Native window isolation is covered by
// electron/settings-window-smoke.cjs using the real Electron IPC and filesystem.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createServer } = require('node:http');
const { chromium } = require('playwright');
const { DEFAULT_SETTINGS, sanitizeSettings } = require('../electron/host-policy.cjs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts', 'settings-window-check');
const report = { passed: false, kind: 'browser UI with mock host; native lifecycle tested separately', checks: [], screenshots: [] };
const server = createServer(async (request, response) => {
  try {
    const filename = path.resolve(root, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`);
    if (!filename.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    const data = await fs.readFile(filename);
    response.setHeader('Content-Type', { '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png' }[path.extname(filename)] || 'application/octet-stream');
    response.end(data);
  } catch { response.writeHead(404).end(); }
});

async function main() {
  await fs.mkdir(output, { recursive: true });
  const { createPetState, applyAction, EXPRESSIONS, POSES } = await import(pathToFileURL(path.join(root, 'renderer', 'state.mjs')).href);
  const pet = createPetState();
  let settings = { ...DEFAULT_SETTINGS }, rejectNext = false;
  const calls = [], errors = [];
  const snapshot = () => ({ settings: { ...settings }, appearance: { expression: pet.expression, pose: pet.pose, cat: pet.cat, glasses: pet.glasses }, hotkeys: { legacy: { active: true, error: null }, alternate: { active: false, failed: [] } } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 600, height: 741 }, deviceScaleFactor: 1 });
    page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('__mockSettingsHost', async (method, value) => {
      calls.push({ method, value });
      if (rejectNext && method !== 'getState') { rejectNext = false; throw new Error('QA simulated save failure'); }
      if (method === 'setSettings') settings = sanitizeSettings(value, settings);
      if (method === 'action') {
        applyAction(pet, value);
        settings = sanitizeSettings({ cat: pet.cat, glasses: pet.glasses }, settings);
      }
      if (method === 'resize') settings = sanitizeSettings({ scale: value }, settings);
      if (method === 'recover') settings = sanitizeSettings({ clickThrough: false, ...(value ? { scale: 1 } : {}) }, settings);
      return snapshot();
    });
    await page.addInitScript(() => {
      const listeners = new Set(), windowListeners = new Set(), windowControls = [];
      let windowState = { maximized: false };
      const publish = state => { for (const callback of listeners) callback(structuredClone(state)); };
      const publishWindowState = state => {
        windowState = { maximized: state.maximized === true };
        for (const callback of windowListeners) callback(structuredClone(windowState));
      };
      const invoke = async (method, value) => {
        const state = await window.__mockSettingsHost(method, value);
        if (method !== 'getState') publish(state);
        return method === 'action' ? true : state;
      };
      window.__settingsQA = { publish, windowControls, publishWindowState };
      window.elysiaSettings = Object.freeze({
        getState: () => invoke('getState'), setSettings: patch => invoke('setSettings', patch),
        action: action => invoke('action', action), resize: scale => invoke('resize', scale),
        recover: (resetScale = false) => invoke('recover', resetScale),
        // Native preload uses send; this stub records intent without closing the QA page.
        windowControl: action => {
          windowControls.push(action); void window.__mockSettingsHost('windowControl', action);
          if (action === 'toggle-maximize') publishWindowState({ maximized: !windowState.maximized });
        },
        getWindowState: async () => structuredClone(windowState),
        onWindowState: callback => { windowListeners.add(callback); return () => windowListeners.delete(callback); },
        onState: callback => { listeners.add(callback); return () => listeners.delete(callback); },
      });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/renderer/settings.html`);
    await page.waitForSelector('html[data-ready="true"]');
    const settled = async () => { await page.waitForFunction(() => document.querySelector('#save-status').textContent === '自动保存'); };
    const check = (name, details = {}) => report.checks.push({ name, passed: true, ...details });
    const tab = async name => { await page.locator(`[data-tab="${name}"]`).click(); assert.equal(await page.locator(`[data-tab="${name}"]`).getAttribute('aria-selected'), 'true'); };
    const selected = async (type, id) => assert.equal(await page.locator(`.choice[data-action="${type}"][data-id="${id}"]`).getAttribute('aria-pressed'), 'true');
    const choose = async (type, id) => { await page.locator(`.choice[data-action="${type}"][data-id="${id}"]`).click(); await settled(); await selected(type, id); };
    const toggle = async (key, value) => { await page.locator(`[name="${key}"]`).setChecked(value); await settled(); assert.equal(settings[key], value); };
    const number = async (key, value, expected) => {
      const input = page.locator(`[name="${key}Value"]`);
      await input.fill(String(value)); await input.press('Tab'); await settled();
      assert.equal(settings[key], expected ?? value);
    };
    const capture = async name => {
      await page.locator('main').evaluate(node => { node.scrollTop = 0; });
      const filename = path.join(output, `${name}.png`);
      await page.screenshot({ path: filename, animations: 'disabled' }); report.screenshots.push(filename);
    };
    const layout = async name => {
      const value = await page.evaluate(() => {
        const footer = document.querySelector('footer').getBoundingClientRect();
        const tabbar = document.querySelector('.tabs').getBoundingClientRect();
        return { width: innerWidth, height: innerHeight, bodyWidth: document.documentElement.scrollWidth,
          footer: { top: footer.top, bottom: footer.bottom }, tabbar: { top: tabbar.top, bottom: tabbar.bottom } };
      });
      assert.ok(value.bodyWidth <= value.width, `${name} must have no horizontal scroll`);
      assert.ok(value.footer.top >= value.tabbar.bottom && value.footer.bottom <= value.height + 1, `${name} recovery footer must remain visible`);
      check(name, value);
    };

    const chrome = await page.evaluate(() => {
      const header = document.querySelector('.page-header');
      const region = node => getComputedStyle(node).getPropertyValue('-webkit-app-region');
      return { header: region(header), controls: [...document.querySelectorAll('[data-window-control]')].map(button => ({
        action: button.dataset.windowControl, region: region(button), text: button.textContent.trim(),
        label: button.getAttribute('aria-label'),
        visibleIcons: [...button.querySelectorAll('svg')].filter(svg => { const rect = svg.getBoundingClientRect(); return rect.width > 0 && rect.height > 0 && getComputedStyle(svg).visibility !== 'hidden'; }).length,
      })) };
    });
    assert.equal(chrome.header, 'drag', 'Frameless header must provide a native drag region');
    assert.deepEqual(chrome.controls.map(button => button.action).sort(), ['close', 'minimize', 'toggle-maximize']);
    for (const button of chrome.controls) {
      assert.equal(button.region, 'no-drag', `${button.action} must remain clickable inside the drag header`);
      assert.equal(button.text, '', `${button.action} must show an SVG icon without visible label text`);
      assert.equal(button.visibleIcons, 1, `${button.action} must show exactly one visible icon`);
    }
    assert.deepEqual(chrome.controls.map(button => button.label), ['最小化', '最大化', '关闭']);
    const maximizeButton = page.locator('[data-window-control="toggle-maximize"]');
    const verifyMaximized = async maximized => {
      assert.equal(await maximizeButton.getAttribute('data-maximized'), String(maximized));
      assert.equal(await maximizeButton.getAttribute('aria-label'), maximized ? '还原' : '最大化');
      assert.equal(await maximizeButton.getAttribute('title'), maximized ? '还原' : '最大化');
      assert.equal(await maximizeButton.locator('.restore-icon').isVisible(), maximized);
      assert.equal(await maximizeButton.locator('.maximize-icon').isVisible(), !maximized);
    };
    await verifyMaximized(false);
    await page.locator('[data-window-control="minimize"]').click();
    await maximizeButton.click(); await verifyMaximized(true);
    await maximizeButton.click(); await verifyMaximized(false);
    await page.locator('[data-window-control="close"]').click();
    const expectedWindowCalls = ['minimize', 'toggle-maximize', 'toggle-maximize', 'close'];
    assert.deepEqual(await page.evaluate(() => window.__settingsQA.windowControls), expectedWindowCalls);
    await page.evaluate(() => window.elysiaSettings.getState());
    assert.deepEqual(calls.filter(call => call.method === 'windowControl').map(call => call.value), expectedWindowCalls);
    assert.deepEqual(snapshot().settings, DEFAULT_SETTINGS);
    check('frameless titlebar is draggable; three visible SVG controls are no-drag and route minimize/maximize/restore/close', chrome);
    // Native titlebar double-clicks and OS window events arrive through this channel.
    await page.evaluate(() => window.__settingsQA.publishWindowState({ maximized: true })); await verifyMaximized(true);
    await page.evaluate(() => window.__settingsQA.publishWindowState({ maximized: false })); await verifyMaximized(false);
    assert.deepEqual(await page.evaluate(() => window.__settingsQA.windowControls), expectedWindowCalls);
    assert.deepEqual(snapshot().settings, DEFAULT_SETTINGS);
    check('external window-state events switch maximize/restore icon and accessible label without changing preferences or sending commands');

    assert.equal(await page.locator('.choice[data-action="expression"]').count(), 10);
    assert.equal(await page.locator('.choice[data-action="pose"]').count(), 4);
    await layout('default window layout'); await capture('appearance-default');
    await choose('pose', 'tea');
    for (const expression of EXPRESSIONS) { await choose('expression', expression.id); assert.equal(pet.pose, 'tea'); }
    await page.locator('[data-action="neutral"]').click(); await settled(); assert.equal(pet.expression, null); assert.equal(pet.pose, 'tea');
    await toggle('cat', true); await toggle('glasses', true);
    for (const pose of POSES) { await choose('pose', pose.id); assert.equal(pet.cat, true); assert.equal(pet.glasses, true); }
    await choose('expression', 'heart');
    check('all 10 expressions and 4 poses route independently; skins remain simultaneously enabled');
    await capture('appearance-selected');

    // Exercise the same state notification used after hotkeys and pet actions.
    applyAction(pet, { type: 'expression', id: 'smile' });
    await page.evaluate(state => window.__settingsQA.publish(state), snapshot());
    await selected('expression', 'smile'); await selected('pose', 'tea');
    assert.equal(await page.locator('[name="cat"]').isChecked(), true);
    check('external hotkey state notification updates selected face without resetting pose or skins');
    await page.locator('[data-action="reset"]').click(); await settled();
    assert.deepEqual(snapshot().appearance, { expression: null, pose: 'idle', cat: false, glasses: false });
    check('appearance reset clears only expression, skins and pose');

    await tab('animation');
    await toggle('eyeTracking', false); await number('eyeWarpStrength', 0, 0); await number('eyeWarpStrength', 200, 2); await number('eyeWarpStrength', 137, 1.37);
    await toggle('eyeTracking', true);
    await number('motionAmplitude', 0, 0); await number('motionAmplitude', 200, 2); await number('motionAmplitude', 85, .85);
    await number('motionSpeed', .25); await number('motionSpeed', 3); await number('motionSpeed', 1.35);
    await toggle('hairMotion', false); await toggle('hairMotion', true); await toggle('keyDisplay', false); await toggle('keyDisplay', true);
    await page.locator('[name="motionAmplitude"]').fill('113'); await page.locator('[name="motionAmplitude"]').blur();
    await page.waitForFunction(() => document.querySelector('[name="motionAmplitudeValue"]').value === '113');
    await page.waitForFunction(async () => (await window.elysiaSettings.getState()).settings.motionAmplitude === 1.13);
    await settled(); assert.equal(settings.motionAmplitude, 1.13);
    check('sliders and numeric fields route percentage and speed values, extrema and independent toggles');
    await capture('animation-controls');
    await page.getByRole('button', { name: '恢复默认眼睛跟随幅度', exact: true }).click();
    await page.getByRole('button', { name: '恢复默认摆动幅度', exact: true }).click();
    await page.getByRole('button', { name: '恢复默认摆动速度', exact: true }).click(); await settled();
    assert.deepEqual([settings.eyeWarpStrength, settings.motionAmplitude, settings.motionSpeed], [1, 1, 1]);
    check('individual defaults restore each animation parameter');

    await tab('desktop');
    await page.locator('[name="taskbarInFront"][value="true"]').check(); await settled(); assert.equal(settings.taskbarInFront, true);
    await toggle('alwaysOnTop', false); assert.equal(await page.locator('[name="taskbarInFront"]').first().isDisabled(), true);
    await toggle('alwaysOnTop', true); assert.equal(await page.locator('[name="taskbarInFront"]').first().isDisabled(), false);
    await page.locator('[name="taskbarInFront"][value="false"]').check(); await settled(); assert.equal(settings.taskbarInFront, false);
    await toggle('legacyHotkeys', false); await toggle('alternateHotkeys', true);
    await toggle('clickThrough', true);
    await page.locator('[data-recover="false"]').click(); await settled(); assert.equal(settings.clickThrough, false);
    check('taskbar order, topmost, shortcuts and recovery remain usable after click-through');

    for (const [percent, expected] of [[1, .01], [123.5, 1.235], [100000, 1000]]) {
      await page.locator('#scale-percent').fill(String(percent)); await page.locator('#size-form [type="submit"]').click(); await settled(); assert.equal(settings.scale, expected);
    }
    await page.locator('[data-scale="2"]').click(); await settled(); assert.equal(settings.scale, 2);
    await page.locator('[data-resize-factor="1.1"]').click(); await settled(); assert.equal(settings.scale, 2.2);
    await page.locator('[data-resize-factor="0.9090909090909091"]').click(); await settled(); assert.equal(settings.scale, 2);
    await page.locator('[data-recover="true"]').click(); await settled(); assert.equal(settings.scale, 1);
    check('size accepts 1%, fractional and 100000%; presets, adjustments and restore route correctly');
    await capture('desktop-controls');

    rejectNext = true;
    await page.locator('[data-scale="2"]').click();
    await page.waitForSelector('#error-message:not([hidden])');
    assert.match(await page.locator('#error-message').textContent(), /simulated save failure/);
    assert.equal(settings.scale, 1);
    await page.locator('[data-scale="2"]').click(); await settled(); assert.equal(settings.scale, 2);
    assert.equal(await page.locator('#error-message').isHidden(), true);
    check('failed save displays error and next valid command recovers');

    settings = sanitizeSettings({ motionAmplitude: .72, motionSpeed: 1.8, eyeWarpStrength: .63, scale: 1.25 }, settings);
    await page.locator('h1').click();
    await page.evaluate(state => window.__settingsQA.publish(state), snapshot());
    assert.equal(await page.locator('#scale-percent').inputValue(), '125');
    await tab('animation');
    assert.equal(await page.locator('[name="motionAmplitudeValue"]').inputValue(), '72');
    assert.equal(await page.locator('[name="motionSpeedValue"]').inputValue(), '1.8');
    assert.equal(await page.locator('[name="eyeWarpStrengthValue"]').inputValue(), '63');
    check('external preference broadcasts keep inactive controls synchronized');

    await page.locator('[data-tab="animation"]').focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('[data-tab="desktop"]').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Home'); assert.equal(await page.locator('[data-tab="appearance"]').getAttribute('aria-selected'), 'true');
    check('keyboard tab navigation selects and focuses panels');

    await page.setViewportSize({ width: 500, height: 500 });
    for (const name of ['appearance', 'animation', 'desktop']) { await tab(name); await layout(`minimum client layout: ${name}`); await capture(`${name}-compact`); }
    await page.setViewportSize({ width: 900, height: 800 }); await tab('appearance'); await layout('large window layout'); await capture('appearance-large');
    assert.deepEqual(errors, []); check('no uncaught page errors');
    report.calls = calls; report.passed = true;
  } catch (error) { report.error = error.stack; process.exitCode = 1; }
  finally {
    if (browser) await browser.close(); await new Promise(resolve => server.close(resolve));
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, screenshots: report.screenshots, error: report.error || null, report: path.join(output, 'report.json') }, null, 2));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
