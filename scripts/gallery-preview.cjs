/** Creates README galleries from the current renderer, without editing character artwork. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'docs', 'media');
const english = process.argv.includes('--language=en');
const localized = (chinese, translation) => english ? translation : chinese;
const galleryFilename = name => `${name}${english ? '.en' : ''}.png`;
const expressionLabels = { blush: 'Blush', angry: 'Angry', sleep: 'Sleep', surprise: 'Surprised',
  dizzy: 'Dizzy', wink: 'Wink', cry: 'Sad', heart: 'Heart eyes', smile: 'Smile', awkward: 'Awkward' };
const poseLabels = { idle: 'Idle', megaphone: 'Megaphone', cake: 'Cake', tea: 'Bubble tea' };
const mime = { '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + pathname), relative = path.relative(root, file);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      response.writeHead(403).end(); return;
    }
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store'); response.end(fs.readFileSync(file));
  } catch { response.writeHead(404).end(); }
});
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
function savePng(filename, data) {
  assert.ok(data.startsWith('data:image/png;base64,'), `Expected PNG: ${filename}`);
  fs.writeFileSync(path.join(destination, filename), Buffer.from(data.split(',')[1], 'base64'));
}
async function gallery(browser, filename, title, subtitle, entries, imageHeight) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 100 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setContent(`<!doctype html><html lang="${english ? 'en' : 'zh-CN'}"><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;padding:40px;background:#faf8fb;color:#392c43;font-family:'Microsoft YaHei UI','Microsoft YaHei','Segoe UI',sans-serif}
      header{display:flex;align-items:flex-end;justify-content:space-between;gap:32px;margin-bottom:28px}.brand{font-size:11px;font-weight:600;letter-spacing:3px;color:#a3698c;margin-bottom:10px}
      h1{margin:0;font-size:29px;letter-spacing:1px;font-weight:600}p{margin:0 0 3px;color:#7a6d82;font-size:15px;line-height:1.7;max-width:620px;text-align:right}
      main{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}figure{margin:0;padding:10px 10px 19px;border:1px solid #e9e1ec;border-radius:18px;background:#fff;overflow:hidden}
      .image{height:${imageHeight}px;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#fffbfd,#f8f7fc);border-radius:11px}
      img{display:block;width:100%;height:100%;object-fit:contain}figcaption{text-align:center;margin-top:15px;font-size:17px;font-weight:600}
      .key{display:block;margin-top:6px;font-size:13px;line-height:1.5;font-weight:400;color:#86758d}.note{padding:26px;display:flex;flex-direction:column;justify-content:center;color:#766480;line-height:1.9;font-size:16px;background:#f2edf6}
      .note strong{color:#594164;font-size:20px;font-weight:500;margin-bottom:14px}.note span{font-size:14px}
    </style><header><div><div class="brand">${localized('Elysia_desktop_pet · 爱莉希雅桌宠', 'Elysia_desktop_pet · Elysia Desktop Pet')}</div><h1>${escape(title)}</h1></div><p>${escape(subtitle)}</p></header><main>${entries.map(entry => entry.note
      ? `<figure class="note"><strong>${escape(entry.label)}</strong><span>${escape(entry.note)}</span></figure>`
      : `<figure><div class="image"><img src="${entry.data}" alt="${escape(entry.label)}"></div><figcaption>${escape(entry.label)}<span class="key">${escape(entry.key || '')}</span></figcaption></figure>`).join('')}</main></html>`);
    await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
    await page.screenshot({ path: path.join(destination, filename), fullPage: true });
    assert.deepEqual(errors, [], `Gallery raised errors: ${filename}`);
  } finally { await page.close(); }
}
async function captureMotion(page) {
  await page.setViewportSize({ width: 900, height: 1200 });
  await page.mouse.move(438, 489); await page.waitForTimeout(200);
  const captured = await page.evaluate(async () => {
    const canvas = document.querySelector('#pet');
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mime) throw new Error('WebM recording is unavailable');
    const stream = canvas.captureStream(30), recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6000000 }), chunks = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    const stopped = new Promise((resolve, reject) => {
      recorder.onstop = resolve; recorder.onerror = event => reject(event.error || new Error('Recording failed'));
    });
    recorder.start(1000); await new Promise(resolve => setTimeout(resolve, 8000));
    recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop());
    const data = await new Promise(resolve => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(new Blob(chunks, { type: mime }));
    });
    return { data, width: canvas.width, height: canvas.height, mime };
  });
  fs.writeFileSync(path.join(destination, 'idle.webm'), Buffer.from(captured.data.split(',')[1], 'base64'));
  return { durationSeconds: 8, width: captured.width, height: captured.height, mime: captured.mime };
}
(async () => {
  fs.mkdirSync(destination, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 600, height: 800 }, deviceScaleFactor: 1 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/renderer/index.html`);
    await page.waitForSelector('html[data-ready="true"]');
    const { expressions, poses } = await page.evaluate(async () => {
      const { EXPRESSIONS, POSES } = await import('./state.mjs'); return { expressions: EXPRESSIONS, poses: POSES };
    });
    assert.equal(expressions.length, 10, 'README must show all ten selectable expressions');
    assert.equal(poses.length, 4, 'README must show all four poses');
    async function render(options, crop = null) {
      return page.evaluate(async ({ options, crop }) => {
        const data = window.elysiaPreview.render({ ...options, time: 0, resolutionScale: 2 });
        if (!crop) return data;
        const image = new Image(); image.src = data; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = crop.width * 2; canvas.height = crop.height * 2;
        canvas.getContext('2d').drawImage(image, crop.x * 2, crop.y * 2, crop.width * 2, crop.height * 2, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL();
      }, { options, crop });
    }
    if (!english) savePng('character.png', await render({}));
    const faces = [];
    // Include sheep / dizzy decorations, along with both eyes, eyebrows and mouth.
    const head = { x: 55, y: 0, width: 545, height: 445 };
    faces.push({ label: localized('默认', 'Default'), key: localized('再按当前表情键可恢复', 'Press the active shortcut again'), data: await render({}, head) });
    for (const expression of expressions) faces.push({ label: english ? expressionLabels[expression.id] : expression.label, key: `Space + ${expression.key}`, data: await render({ expression: expression.id }, head) });
    faces.push({ label: localized('自由搭配', 'Mix and match'), note: localized('表情、装扮与动作独立切换。再次按下当前表情键，恢复默认表情；当前动作与装扮继续保留。', 'Expressions, accessories and actions are independent. Press the active expression shortcut again to return to the default face. Your action and accessories stay selected.') });
    await gallery(browser, galleryFilename('expressions'), localized('默认 + 10 种表情', 'Default + 10 expressions'), localized('数字键切换心情，也可从托盘菜单选择。', 'Choose a mood with number shortcuts or the tray menu.'), faces, 260);
    const forms = [
      { label: localized('普通形态', 'Original'), key: localized('两个装扮开关均关闭', 'Both accessories off'), options: {} },
      { label: localized('猫猫形态', 'Cat form'), key: 'Space + F1', options: { cat: true } },
      { label: localized('眼镜', 'Glasses'), key: 'Space + F2', options: { glasses: true } },
      { label: localized('猫猫 + 眼镜', 'Cat form + glasses'), key: localized('Space + F1 / F2 可同时开启', 'Enable both: Space + F1 / F2'), options: { cat: true, glasses: true } },
    ];
    for (const form of forms) form.data = await render(form.options);
    await gallery(browser, galleryFilename('forms'), localized('两种装扮，四种搭配', 'Two toggles, four looks'), localized('猫猫与眼镜是独立开关，切换表情和动作时保持。', 'Cat form and glasses stay on across expressions and actions.'), forms, 430);
    const actions = [];
    for (const pose of poses) actions.push({ label: english ? poseLabels[pose.id] : pose.label, key: `Space + ${pose.key}`, data: await render({ pose: pose.id }) });
    await gallery(browser, galleryFilename('actions'), localized('四种动作', 'Four actions'), localized('待机、喇叭、蛋糕与奶茶，任选一种持续展示。', 'Choose idle, megaphone, cake or bubble tea to keep on display.'), actions, 430);
    const motion = !english && process.argv.includes('--motion') ? await captureMotion(page) : null;
    assert.deepEqual(errors, [], 'Renderer raised errors during README capture');
    console.log(JSON.stringify({ capture: 'ok', selectableExpressions: expressions.length, forms: forms.length, poses: poses.length,
      language: english ? 'en' : 'zh-CN', files: [...(english ? [] : ['character.png']), ...['expressions', 'forms', 'actions'].map(galleryFilename)], motion, destination }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
