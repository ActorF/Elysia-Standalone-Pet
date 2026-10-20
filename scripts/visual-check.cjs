/** @fileoverview Checks the right-click-only controls and renderer in Chromium, saving visual QA evidence. */
const { createServer } = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { DEFAULT_SETTINGS, sanitizeSettings, sanitizeAppearance } = require('../electron/host-policy.cjs');
const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'artifacts');
fs.mkdirSync(destination, { recursive: true });
const types = { '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((request, response) => {
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  try { response.setHeader('Content-Type', types[path.extname(file)] || 'text/plain'); response.end(fs.readFileSync(file)); }
  catch { response.writeHead(404).end(); }
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 420, height: 560 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/renderer/index.html`);
    await page.waitForSelector('html[data-ready="true"]');
    const savedNames = [];
    const save = async (name, options = {}) => {
      const data = await page.evaluate(options => window.elysiaPreview.render(options), options);
      fs.writeFileSync(path.join(destination, name + '.png'), Buffer.from(data.split(',')[1], 'base64'));
      savedNames.push(name);
    };
    const snapshot = () => page.evaluate(() => { const {expression,pose,cat,glasses} = window.elysiaPreview.snapshot(); return {expression,pose,cat,glasses}; });
    await save('pet-default'); await save('pet-megaphone', { pose: 'megaphone' });
    assert.equal(await page.locator('#controls').isHidden(), true, 'Controls stay hidden on startup');
    await page.locator('#pet').hover();
    assert.equal(await page.locator('#stage button').count(), 0, 'The pet has no hover buttons');
    assert.equal(await page.locator('.quickbar').count(), 0, 'The former hover toolbar is removed from the DOM');
    assert.equal(await page.locator('#controls').isHidden(), true, 'Hovering does not open controls');
    await page.locator('#pet').click({ button: 'right' });
    assert.equal(await page.locator('#controls').isVisible(), true, 'Right-click opens the browser controls');
    assert.equal(await page.locator('[data-expression]').count(), 10);
    assert.equal(await page.locator('[data-skin]').count(), 2);
    assert.equal(await page.locator('[data-pose]').count(), 4);
    for (const removed of ['pat', 'squint', 'star', 'cat', 'glasses', 'cake', 'tea']) assert.equal(await page.locator(`[data-expression="${removed}"]`).count(), 0);
    await page.locator('[data-skin="cat"]').click();
    await page.locator('[data-skin="glasses"]').click();
    await page.locator('[data-pose="tea"]').click();
    for (const button of await page.locator('[data-expression]').all()) {
      const id = await button.getAttribute('data-expression');
      await button.click();
      assert.deepEqual(await snapshot(), { expression: id, pose: 'tea', cat: true, glasses: true }, 'Changing a face must retain the tea pose and both skins');
      await save('expression-' + id, { expression: id });
      await button.click();
      assert.deepEqual(await snapshot(), { expression: null, pose: 'tea', cat: true, glasses: true });
    }
    await page.locator('[data-expression="heart"]').click();
    for (const pose of ['idle', 'megaphone', 'cake', 'tea']) {
      await page.locator(`[data-pose="${pose}"]`).click();
      await page.locator(`[data-pose="${pose}"]`).click();
      assert.deepEqual(await snapshot(), { expression: 'heart', pose, cat: true, glasses: true }, 'Re-selecting a pose must keep that pose, face and skins');
      assert.equal(await page.locator('[data-pose][aria-pressed="true"]').count(), 1);
      await save('combination-' + pose, { expression: 'heart', pose, cat: true, glasses: true });
    }
    await page.locator('[data-skin="cat"]').click();
    assert.deepEqual(await snapshot(), { expression: 'heart', pose: 'tea', cat: false, glasses: true });
    assert.equal(await page.locator('[data-skin="cat"]').getAttribute('aria-checked'), 'false');
    assert.equal(await page.locator('[data-skin="glasses"]').getAttribute('aria-checked'), 'true');
    await page.locator('#reset').click();
    assert.deepEqual(await snapshot(), { expression: null, pose: 'idle', cat: false, glasses: false });
    await page.locator('[data-skin="glasses"]').focus();
    await page.keyboard.down('Space'); await page.keyboard.press('Digit1'); await page.keyboard.up('Space');
    assert.equal(await page.evaluate(() => window.elysiaPreview.snapshot().expression), 'blush', 'Space chord must not also click the focused expression button');
    assert.equal(await page.evaluate(() => window.elysiaPreview.snapshot().glasses), false);
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => window.elysiaPreview.snapshot().glasses), true, 'Space alone still activates the focused skin button');
    await page.keyboard.down('Space'); await page.keyboard.press('F1'); await page.keyboard.press('F5'); await page.keyboard.up('Space');
    assert.deepEqual(await snapshot(), { expression: 'blush', pose: 'cake', cat: true, glasses: true });
    await page.locator('#eyeTracking').focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#eyeTracking').isChecked(), false, 'Space alone toggles focused preferences');
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#eyeTracking').isChecked(), true);
    await page.locator('#reset').click();
    await page.locator('.panel-content').evaluate(element => element.scrollTop = 0);
    await page.screenshot({ path: path.join(destination, 'controls.png'), omitBackground: true, animations: 'disabled' });
    await page.locator('#close-controls').click();
    await page.keyboard.down('Space'); await page.keyboard.press('Digit6'); await page.keyboard.up('Space');
    assert.equal(await page.evaluate(() => window.elysiaPreview.snapshot().expression), 'wink');
    await page.locator('#pet').click();
    assert.equal(await page.evaluate(() => window.elysiaPreview.snapshot().expression), 'wink', 'Clicking the character no longer activates the removed head-pat expression');
    await page.mouse.move(410, 20);
    await page.waitForTimeout(200);
    const gaze = await page.evaluate(() => window.elysiaPreview.snapshot().gaze);
    assert.ok(gaze.x > 0 && gaze.y < 0);
    assert.equal(await page.evaluate(() => window.elysiaPreview.rendering.mode), 'rigid-layers');
    await page.screenshot({ path: path.join(destination, 'pet-live.png'), omitBackground: true });
    assert.deepEqual(errors, []);
    // Exercise the real renderer against a delayed host bridge. The settings store stays
    // outside the page so reloads model a fresh renderer / app launch with saved skins.
    const persistence = await browser.newPage({ viewport: { width: 420, height: 560 } });
    persistence.on('pageerror', error => errors.push(error.message));
    let persistedSettings = { ...DEFAULT_SETTINGS, cat: true, glasses: true };
    let menuAppearance;
    let initialSkinToggle = true;
    let pendingWrites = 0;
    const hostSnapshot = () => ({ settings: structuredClone(persistedSettings), hotkeys: { legacy: { active: false } } });
    await persistence.exposeFunction('testHostRead', async () => {
      const snapshot = hostSnapshot();
      await new Promise(resolve => setTimeout(resolve, 60));
      return snapshot;
    });
    await persistence.exposeFunction('testHostWrite', async patch => {
      pendingWrites++;
      persistedSettings = sanitizeSettings(patch, persistedSettings);
      const snapshot = hostSnapshot();
      // Let earlier toggles acknowledge after the final reset to probe stale replies.
      await new Promise(resolve => setTimeout(resolve, patch.cat || patch.glasses ? 50 : 5));
      pendingWrites--;
      return snapshot;
    });
    await persistence.exposeFunction('testHostAppearance', value => { menuAppearance = sanitizeAppearance(value); });
    await persistence.exposeFunction('testEarlyToggle', () => { const result = initialSkinToggle; initialSkinToggle = false; return result; });
    await persistence.addInitScript(() => {
      let onAction;
      window.elysiaDesktop = {
        getState: async () => {
          const snapshot = window.testHostRead();
          if (await window.testEarlyToggle()) onAction({type:'toggle-skin',id:'cat'});
          return snapshot;
        },
        onPointer() {}, onSettings() {}, onAction(callback) { onAction = callback; window.testAction = callback; },
        setSettings: patch => window.testHostWrite(patch), setAppearance: value => window.testHostAppearance(value),
        dragStart() {}, dragMove() {}, dragEnd() {}, showMenu() { onAction({type:'show-controls'}); }, quit() {},
      };
    });
    await persistence.goto(`http://127.0.0.1:${server.address().port}/renderer/index.html`);
    await persistence.waitForSelector('html[data-ready="true"]');
    const restored = await persistence.evaluate(() => window.elysiaPreview.snapshot());
    assert.equal(restored.cat, false, 'Startup shortcut toggles the saved enabled cat skin after restoration');
    assert.equal(restored.glasses, true, 'Unchanged saved glasses skin survives startup');
    await persistence.evaluate(() => {
      window.testAction({type:'toggle-skin',id:'cat'});
      window.testAction({type:'pose',id:'cake'});
      window.testAction({type:'expression',id:'angry'});
      window.testAction({type:'reset'});
    });
    await persistence.waitForTimeout(100);
    assert.equal(pendingWrites, 0);
    assert.equal(persistedSettings.cat, false); assert.equal(persistedSettings.glasses, false);
    assert.deepEqual(menuAppearance, { expression: null, pose: 'idle', cat: false, glasses: false }, 'Late acknowledgements cannot restore old skin switches after reset');
    await persistence.reload();
    await persistence.waitForSelector('html[data-ready="true"]');
    const afterRestart = await persistence.evaluate(() => window.elysiaPreview.snapshot());
    assert.equal(afterRestart.cat, false); assert.equal(afterRestart.glasses, false);
    assert.equal(afterRestart.pose, 'idle'); assert.equal(afterRestart.expression, null);
    await persistence.evaluate(() => { window.testAction({type:'toggle-skin',id:'cat'}); window.testAction({type:'toggle-skin',id:'glasses'}); });
    await persistence.waitForTimeout(100);
    await persistence.reload();
    await persistence.waitForSelector('html[data-ready="true"]');
    const enabledAfterRestart = await persistence.evaluate(() => window.elysiaPreview.snapshot());
    assert.equal(enabledAfterRestart.cat, true); assert.equal(enabledAfterRestart.glasses, true, 'Both enabled skins are restored on subsequent startup');
    await persistence.close();
    assert.deepEqual(errors, []);
    const contact = await browser.newPage({ viewport: { width: 1200, height: 1300 }, deviceScaleFactor: 1 });
    const names = savedNames;
    await contact.setContent(`<html><body style="margin:0;background:#f6eff6;font-family:'Segoe UI','Microsoft Yahei',sans-serif"><div style="padding:28px;display:grid;grid-template-columns:repeat(5,1fr);gap:12px">${names.map(name => `<figure style="margin:0;background:white;border-radius:15px;padding:10px;text-align:center"><img style="height:240px;max-width:100%;object-fit:contain" src="data:image/png;base64,${fs.readFileSync(path.join(destination, name + '.png')).toString('base64')}"><figcaption style="font-size:12px;color:#84617d">${name.replace('expression-', '')}</figcaption></figure>`).join('')}</div></body></html>`);
    await contact.locator('img').last().waitFor();
    await contact.screenshot({ path: path.join(destination, 'expressions-overview.png'), fullPage: true });
    const showcase = await browser.newPage({ viewport: { width: 1100, height: 850 }, deviceScaleFactor: 1 });
    await showcase.setContent(`<html><body style="margin:0;background:#f7eef5;color:#6f4f69;font-family:'Segoe UI','Microsoft Yahei',sans-serif"><div style="padding:45px 60px 0"><span style="font-size:12px;letter-spacing:5px;color:#b783a6">ELYSIA · DESKTOP COMPANION</span><h1 style="font-size:27px;font-weight:500;margin:12px 0">今天，也一起吧 ♡</h1><p style="font-size:12px;color:#a6859d">10 种表情 · 4 种动作 · 猫猫与眼镜独立切换</p></div><div style="display:flex;justify-content:center;gap:85px">${['pet-default','pet-megaphone'].map((name,i)=>`<figure style="margin:0;text-align:center"><img style="height:600px" src="data:image/png;base64,${fs.readFileSync(path.join(destination,name+'.png')).toString('base64')}"><figcaption style="font-size:13px;color:#a47898">${i ? '听我说呀！ / 空格 + F4' : '日常陪伴 / 空格 + F3'}</figcaption></figure>`).join('')}</div></body></html>`);
    await showcase.screenshot({ path: path.join(destination, 'preview.png') });
    console.log(JSON.stringify({ visual: 'ok', rightClickControls: true, hoverButtons: 0, expressions: 10, skins: 2, poses: 4, independentSelections: true, restoredSkins: true, resetRace: 'passed', browserErrors: errors, gaze, screenshots: destination }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
