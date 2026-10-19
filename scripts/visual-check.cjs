/** @fileoverview Checks the right-click-only controls and renderer in Chromium, saving visual QA evidence. */
const { createServer } = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
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
    const save = async (name, expression = null, horn = false) => {
      const data = await page.evaluate(([expression, horn]) => window.elysiaPreview.render(expression, horn), [expression, horn]);
      fs.writeFileSync(path.join(destination, name + '.png'), Buffer.from(data.split(',')[1], 'base64'));
    };
    await save('pet-default'); await save('pet-megaphone', null, true);
    assert.equal(await page.locator('#controls').isHidden(), true, 'Controls stay hidden on startup');
    await page.locator('#pet').hover();
    assert.equal(await page.locator('#stage button').count(), 0, 'The pet has no hover buttons');
    assert.equal(await page.locator('.quickbar').count(), 0, 'The former hover toolbar is removed from the DOM');
    assert.equal(await page.locator('#controls').isHidden(), true, 'Hovering does not open controls');
    await page.locator('#pet').click({ button: 'right' });
    assert.equal(await page.locator('#controls').isVisible(), true, 'Right-click opens the browser controls');
    assert.equal(await page.locator('[data-expression]').count(), 17);
    for (const button of await page.locator('[data-expression]').all()) {
      const id = await button.getAttribute('data-expression');
      await button.click();
      assert.equal(await page.evaluate(() => window.elysiaPreview.snapshot().expression), id);
      await save('expression-' + id, id);
      await button.click();
      assert.equal(await page.evaluate(() => window.elysiaPreview.snapshot().expression), null);
    }
    await page.locator('#megaphone').click();
    assert.equal(await page.evaluate(() => window.elysiaPreview.snapshot().megaphone), true);
    await page.locator('#reset').click();
    assert.equal(await page.evaluate(() => window.elysiaPreview.snapshot().megaphone), false);
    await page.locator('[data-expression="glasses"]').focus();
    await page.keyboard.down('Space'); await page.keyboard.press('Digit2'); await page.keyboard.up('Space');
    assert.equal(await page.evaluate(() => window.elysiaPreview.snapshot().expression), 'blush', 'Space chord must not also click the focused expression button');
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => window.elysiaPreview.snapshot().expression), 'glasses', 'Space alone still activates the focused button');
    await page.locator('#eyeTracking').focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#eyeTracking').isChecked(), false, 'Space alone toggles focused preferences');
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#eyeTracking').isChecked(), true);
    await page.locator('#reset').click();
    await page.locator('.panel-content').evaluate(element => element.scrollTop = 0);
    await page.screenshot({ path: path.join(destination, 'controls.png'), omitBackground: true });
    await page.locator('#close-controls').click();
    await page.keyboard.down('Space'); await page.keyboard.press('Digit8'); await page.keyboard.up('Space');
    assert.equal(await page.evaluate(() => window.elysiaPreview.snapshot().expression), 'wink');
    await page.mouse.move(410, 20);
    await page.waitForTimeout(200);
    const gaze = await page.evaluate(() => window.elysiaPreview.snapshot().gaze);
    assert.ok(gaze.x > 0 && gaze.y < 0);
    assert.equal(await page.evaluate(() => window.elysiaPreview.acceleration.normal), true);
    await page.screenshot({ path: path.join(destination, 'pet-live.png'), omitBackground: true });
    assert.deepEqual(errors, []);
    const contact = await browser.newPage({ viewport: { width: 1200, height: 1300 }, deviceScaleFactor: 1 });
    const names = ['pet-default', 'pet-megaphone', ...fs.readdirSync(destination).filter(name => name.startsWith('expression-') && name.endsWith('.png')).map(name => name.slice(0, -4))];
    await contact.setContent(`<html><body style="margin:0;background:#f6eff6;font-family:'Segoe UI','Microsoft Yahei',sans-serif"><div style="padding:28px;display:grid;grid-template-columns:repeat(5,1fr);gap:12px">${names.map(name => `<figure style="margin:0;background:white;border-radius:15px;padding:10px;text-align:center"><img style="height:240px;max-width:100%;object-fit:contain" src="data:image/png;base64,${fs.readFileSync(path.join(destination, name + '.png')).toString('base64')}"><figcaption style="font-size:12px;color:#84617d">${name.replace('expression-', '')}</figcaption></figure>`).join('')}</div></body></html>`);
    await contact.locator('img').last().waitFor();
    await contact.screenshot({ path: path.join(destination, 'expressions-overview.png'), fullPage: true });
    const showcase = await browser.newPage({ viewport: { width: 1100, height: 850 }, deviceScaleFactor: 1 });
    await showcase.setContent(`<html><body style="margin:0;background:#f7eef5;color:#6f4f69;font-family:'Segoe UI','Microsoft Yahei',sans-serif"><div style="padding:45px 60px 0"><span style="font-size:12px;letter-spacing:5px;color:#b783a6">ELYSIA · DESKTOP COMPANION</span><h1 style="font-size:27px;font-weight:500;margin:12px 0">今天，也一起吧 ♡</h1><p style="font-size:12px;color:#a6859d">Q 版站姿 · 鼠标眼神跟随 · 发丝轻摆 · 17 种表情</p></div><div style="display:flex;justify-content:center;gap:85px">${['pet-default','pet-megaphone'].map((name,i)=>`<figure style="margin:0;text-align:center"><img style="height:600px" src="data:image/png;base64,${fs.readFileSync(path.join(destination,name+'.png')).toString('base64')}"><figcaption style="font-size:13px;color:#a47898">${i ? '听我说呀！ / 空格 + M' : '日常陪伴 / 默认站姿'}</figcaption></figure>`).join('')}</div></body></html>`);
    await showcase.screenshot({ path: path.join(destination, 'preview.png') });
    console.log(JSON.stringify({ visual: 'ok', rightClickControls: true, hoverButtons: 0, expressions: 17, browserErrors: errors, gaze, screenshots: destination }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
