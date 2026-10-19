/**
 * Captures large, individually inspectable expression faces and action sequences.
 * This is a visual-review aid, not a claim that screenshots automatically pass QA.
 * It only writes artifacts/expression-review and never modifies character assets.
 */
'use strict';
const { createServer } = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'artifacts', 'expression-review');
const requestedResolution = 2;
const frameTimes = [0, 0.4, 0.8, 1.2, 1.6, 2];
const faceCrop = { x: 168, y: 240, width: 262, height: 184 };
const actions = [
  { id: 'cake', label: '吃蛋糕：盘与手、叉子与手臂、入口位置', crop: { x: 115, y: 260, width: 330, height: 315 } },
  { id: 'tea', label: '奶茶：手指包杯、短吸管、杯口靠嘴', crop: { x: 160, y: 260, width: 295, height: 315 } },
  { id: 'cat', label: '猫猫：耳根、耳内、尾根与尾尖', crop: { x: 80, y: 35, width: 480, height: 735 } },
  { id: 'pat', label: '摸头：自然点头、发顶、单组闭眼，无额外手掌', crop: { x: 110, y: 40, width: 425, height: 385 } },
];
const mime = { '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + pathname);
    const relative = path.relative(root, file);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      response.writeHead(403).end(); return;
    }
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store');
    response.end(fs.readFileSync(file));
  } catch { response.writeHead(404).end(); }
});

const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
function savePng(filename, dataUrl) {
  assert.ok(dataUrl.startsWith('data:image/png;base64,'), `Expected PNG: ${filename}`);
  fs.writeFileSync(path.join(destination, filename), Buffer.from(dataUrl.split(',')[1], 'base64'));
}

async function contactSheet(browser, filename, title, subtitle, entries, { columns = 2, cellWidth = 510, imageHeight = 358 } = {}) {
  const page = await browser.newPage({ viewport: { width: columns * cellWidth + 60, height: 1000 }, deviceScaleFactor: 1 });
  try {
    await page.setContent(`<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;padding:24px;background:#eee9ee;color:#382534;font-family:'Segoe UI','Microsoft Yahei',sans-serif}
      h1{font-size:21px;font-weight:600;margin:0 0 7px}p{font-size:12px;color:#756471;margin:0 0 18px;line-height:1.6}
      .grid{display:grid;grid-template-columns:repeat(${columns},${cellWidth}px);gap:12px}
      figure{margin:0;background:#fff;border:1px solid #d9cdd7;border-radius:8px;padding:10px;overflow:hidden}
      .image{height:${imageHeight}px;display:flex;align-items:center;justify-content:center;background:#fffaf7}
      img{display:block;width:100%;height:100%;object-fit:contain}figcaption{font-size:14px;padding:9px 2px 3px}
    </style></head><body><h1>${escape(title)}</h1><p>${escape(subtitle)}</p><div class="grid">${entries.map(entry => `<figure><div class="image"><img src="${entry.data}"></div><figcaption>${escape(entry.label)}</figcaption></figure>`).join('')}</div></body></html>`);
    await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
    await page.screenshot({ path: path.join(destination, filename), fullPage: true });
  } finally { await page.close(); }
}

async function captureMotion(page, browser) {
  await page.setViewportSize({ width: 900, height: 1200 });
  await page.evaluate(() => {
    document.querySelector('#reset').click();
    for (const id of ['hairMotion', 'eyeTracking']) {
      const input = document.getElementById(id);
      if (!input.checked) input.click();
    }
  });
  // Hold the pointer still, close to the reference eye midpoint throughout capture.
  await page.mouse.move(438, 489);
  await page.waitForTimeout(200);
  const captured = await page.evaluate(async () => {
    const canvas = document.querySelector('#pet');
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mime) throw new Error('WebM recording is unavailable in this Chromium');
    const stream = canvas.captureStream(30), recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6000000 });
    const chunks = [], frames = [], targets = [0, 1.2, 2.4, 3.6, 4.8, 6];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    const stopped = new Promise((resolve, reject) => { recorder.onstop = resolve; recorder.onerror = event => reject(event.error || new Error('Recording failed')); });
    recorder.start(1000);
    const started = performance.now();
    await new Promise(resolve => {
      function step() {
        const elapsed = (performance.now() - started) / 1000;
        while (frames.length < targets.length && elapsed >= targets[frames.length]) {
          frames.push({ requested: targets[frames.length], elapsed, state: window.elysiaPreview.snapshot(), data: canvas.toDataURL() });
        }
        if (elapsed >= 6) resolve(); else requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
    recorder.stop(); await stopped; stream.getTracks().forEach(track => track.stop());
    const video = await new Promise(resolve => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(new Blob(chunks, { type: mime }));
    });
    return { mime, video, frames, width: canvas.width, height: canvas.height };
  });
  fs.writeFileSync(path.join(destination, 'idle-six-seconds.webm'), Buffer.from(captured.video.split(',')[1], 'base64'));
  const regions = [
    { id: 'upper-hair', title: '上半头发连续运动：发顶、左右发束与轮廓', x: 95, y: 40, width: 445, height: 285 },
    { id: 'bangs', title: '刘海连续运动：发带连接、发梢与眼部遮挡', x: 175, y: 135, width: 270, height: 210 },
    { id: 'hair', title: '后发连续运动：发根、外轮廓与衣服连接', x: 387, y: 350, width: 175, height: 285 },
    { id: 'cloth', title: '衣摆连续运动：褶皱、遮挡与接缝', x: 70, y: 440, width: 245, height: 310 },
    { id: 'legs', title: '双腿连续运动：裙摆连接与鞋的轮廓', x: 230, y: 560, width: 210, height: 225 },
  ];
  const fullEntries = [];
  for (let index = 0; index < captured.frames.length; index++) {
    const frame = captured.frames[index];
    savePng(`idle-frame-${index}.png`, frame.data);
    fullEntries.push({ data: frame.data, label: `t = ${frame.elapsed.toFixed(2)} s` });
  }
  await contactSheet(browser, 'idle-six-seconds.png', '真实连续运行 6 秒：指针固定，只有待机动作',
    '对应 idle-six-seconds.webm。逐帧检查动作是否沿部件旋转，以及轮廓、接缝是否撕裂或呈波纹。', fullEntries,
    { columns: 3, cellWidth: 368, imageHeight: 480 });
  for (const region of regions) {
    const entries = [];
    for (let index = 0; index < captured.frames.length; index++) {
      const frame = captured.frames[index];
      const data = await page.evaluate(async ({ data, region }) => {
        const image = new Image(); image.src = data; await image.decode();
        const sx = image.width / 600, sy = image.height / 800;
        const crop = document.createElement('canvas'); crop.width = Math.round(region.width * sx); crop.height = Math.round(region.height * sy);
        crop.getContext('2d').drawImage(image, region.x * sx, region.y * sy, region.width * sx, region.height * sy, 0, 0, crop.width, crop.height);
        return crop.toDataURL();
      }, { data: frame.data, region });
      savePng(`idle-${region.id}-${index}.png`, data);
      entries.push({ data, label: `t = ${frame.elapsed.toFixed(2)} s` });
    }
    await contactSheet(browser, `idle-${region.id}.png`, region.title, '同一真实运行视频的局部放大；各时间点未重新启动动画。', entries,
      { columns: 3, cellWidth: 368, imageHeight: 365 });
  }
  const summary = { durationSeconds: 6, mime: captured.mime, width: captured.width, height: captured.height,
    frames: captured.frames.map(({ data, ...frame }) => frame), regions, visualReviewRequired: true };
  fs.writeFileSync(path.join(destination, 'idle-six-seconds.json'), JSON.stringify(summary, null, 2) + '\n');
  return summary;
}

(async () => {
  fs.mkdirSync(destination, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 600, height: 800 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/renderer/index.html`);
    await page.waitForSelector('html[data-ready="true"]');
    const expressions = await page.evaluate(async () => (await import('./state.mjs')).EXPRESSIONS.map(({ id, label }) => ({ id, label })));
    assert.equal(expressions.length, 17, 'Review must cover all original expressions');
    if (process.argv.includes('--motion-only')) {
      const motion = await captureMotion(page, browser);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ capture: 'ok', motionSeconds: motion.durationSeconds, size: [motion.width, motion.height], visualReviewRequired: true, destination }));
      return;
    }

    // API: render(expression, megaphone, time, resolutionScale). Older previews
    // may ignore resolutionScale; record actual dimensions instead of pretending
    // an enlarged low-resolution crop contains more source detail.
    async function render(expression, time = 0, megaphone = false, crop = faceCrop) {
      return page.evaluate(async ({ expression, time, megaphone, crop, requestedResolution }) => {
        const data = await window.elysiaPreview.render(expression, megaphone, time, requestedResolution);
        const image = new Image(); image.src = data; await image.decode();
        const sx = image.naturalWidth / 600, sy = image.naturalHeight / 800;
        const cropped = document.createElement('canvas');
        cropped.width = Math.round(crop.width * sx); cropped.height = Math.round(crop.height * sy);
        const context = cropped.getContext('2d');
        context.drawImage(image, crop.x * sx, crop.y * sy, crop.width * sx, crop.height * sy, 0, 0, cropped.width, cropped.height);
        return { full: data, crop: cropped.toDataURL(), width: image.naturalWidth, height: image.naturalHeight };
      }, { expression, time, megaphone, crop, requestedResolution });
    }

    const faceEntries = [];
    const manifest = { generatedAt: new Date().toISOString(), visualReviewRequired: true, requestedResolution, faceCrop, expressions: [], actions: [], browserErrors: errors };
    for (const item of [{ id: null, label: '默认原画（比对基准）' }, ...expressions]) {
      const id = item.id || 'default';
      const rendered = await render(item.id);
      savePng(`full-${id}.png`, rendered.full);
      savePng(`face-${id}.png`, rendered.crop);
      faceEntries.push({ label: `${item.label} · ${id}`, data: rendered.crop });
      manifest.expressions.push({ id, label: item.label, width: rendered.width, height: rendered.height, full: `full-${id}.png`, face: `face-${id}.png` });
    }
    for (let index = 0; index < 3; index++) {
      await contactSheet(browser, `faces-${index + 1}.png`, `表情面部放大检查 ${index + 1} / 3`,
        '逐项检查原眉眼残留、双重睫毛、肤色补丁边缘、倾角、线宽与口型；关闭表情应恢复默认原画。', faceEntries.slice(index * 6, index * 6 + 6));
    }

    const horn = await render(null, 0, true);
    savePng('full-megaphone.png', horn.full); savePng('face-megaphone.png', horn.crop);
    for (const action of actions) {
      const entries = [];
      for (let index = 0; index < frameTimes.length; index++) {
        const time = frameTimes[index];
        const rendered = await render(action.id, time, false, action.crop);
        const name = `motion-${action.id}-${index}`;
        savePng(`${name}-full.png`, rendered.full); savePng(`${name}.png`, rendered.crop);
        entries.push({ label: `${action.id} · t = ${time.toFixed(1)} s`, data: rendered.crop });
      }
      await contactSheet(browser, `action-${action.id}.png`, action.label,
        '检查动作整段的遮挡关系与接触位置，不能仅凭单个时间点判定通过。', entries,
        { columns: 3, cellWidth: 368, imageHeight: action.id === 'cat' ? 530 : 365 });
      manifest.actions.push({ id: action.id, crop: action.crop, times: frameTimes, sheet: `action-${action.id}.png` });
    }
    // Capture actual live blink frames, because deterministic time previews do not
    // set blink state. This catches unrelated mouth/face changes during eye closure.
    const blinkEntries = [];
    manifest.blinks = [];
    for (const expression of [null, 'glasses', 'blush']) {
      const pair = await page.evaluate(async ({ expression, crop }) => {
        document.querySelector('#reset').click();
        if (expression) document.querySelector(`[data-expression="${expression}"]`).click();
        const capture = closed => new Promise((resolve, reject) => {
          const deadline = performance.now() + 12000;
          function check() {
            const state = window.elysiaPreview.snapshot();
            if (closed ? state.blink > .85 : state.blink < .01) {
              resolve({ full: document.querySelector('#pet').toDataURL(), blink: state.blink, time: state.time });
            } else if (performance.now() > deadline) reject(new Error('Live blink frame did not arrive'));
            else requestAnimationFrame(check);
          }
          requestAnimationFrame(check);
        });
        const open = await capture(false), closed = await capture(true);
        for (const item of [open, closed]) {
          const image = new Image(); image.src = item.full; await image.decode();
          const sx = image.naturalWidth / 600, sy = image.naturalHeight / 800;
          const canvas = document.createElement('canvas'); canvas.width = Math.round(crop.width * sx); canvas.height = Math.round(crop.height * sy);
          canvas.getContext('2d').drawImage(image, crop.x * sx, crop.y * sy, crop.width * sx, crop.height * sy, 0, 0, canvas.width, canvas.height);
          item.crop = canvas.toDataURL();
        }
        return { open, closed };
      }, { expression, crop: faceCrop });
      const id = expression || 'default';
      for (const status of ['open', 'closed']) {
        savePng(`blink-${id}-${status}.png`, pair[status].crop);
        blinkEntries.push({ label: `${id} · ${status} · blink=${pair[status].blink.toFixed(2)}`, data: pair[status].crop });
      }
      manifest.blinks.push({ id, open: { time: pair.open.time, blink: pair.open.blink }, closed: { time: pair.closed.time, blink: pair.closed.blink } });
    }
    await contactSheet(browser, 'blink-mouth-check.png', '实时眨眼对照：闭眼不能改变原有口型',
      '左列睁眼、右列实际眨眼。检查眼睛之外的嘴、腮红、眉与肤色是否无意闪变。', blinkEntries);
    assert.deepEqual(errors, [], 'Renderer raised errors during expression capture');
    fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(JSON.stringify({ capture: 'ok', expressions: expressions.length, faceSheets: 3, actionSheets: actions.length, actualResolution: [manifest.expressions[0].width, manifest.expressions[0].height], visualReviewRequired: true, destination }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
