/** Creates the README key-cloud gallery from the live renderer, without changing character assets. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs/media/key-cloud.png');
const mime = { '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript', '.png': 'image/png' };
const server = createServer((request, response) => {
  try {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    const relative = path.relative(root, file);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      response.writeHead(403).end(); return;
    }
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.end(fs.readFileSync(file));
  } catch { response.writeHead(404).end(); }
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 740, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/renderer/index.html`);
    await page.waitForSelector('html[data-ready="true"]');
    const entries = [
      { pose: 'idle', key: 'A', label: '日常待机', english: 'Idle', description: '手心上方 · Above the palm' },
      { pose: 'tea', key: '!', label: '喝奶茶', english: 'Bubble tea', description: '手心上方 · Above the palm' },
      { pose: 'cake', key: '9', label: '吃蛋糕', english: 'Cake', description: '手心上方 · Above the palm' },
      { pose: 'megaphone', key: '?', cat: true, label: '听我说呀！', english: 'Megaphone', description: '向外飘出 · Outward flight' },
    ];
    for (const entry of entries) {
      entry.data = await page.evaluate(options => window.elysiaPreview.render({
        ...options, time: 0, keyAge: 0, resolutionScale: 2,
      }), { pose: entry.pose, key: entry.key, cat: entry.cat === true });
    }

    const sheet = await browser.newPage({ viewport: { width: 1080, height: 100 }, deviceScaleFactor: 1 });
    await sheet.setContent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;padding:28px;background:#faf8fb;color:#392c43;font-family:'Microsoft YaHei UI','Microsoft YaHei','Segoe UI',sans-serif}
      main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}
      figure{margin:0;border:1px solid #e9e1ec;border-radius:20px;padding:18px;background:#fff}
      .art{height:430px;display:flex;align-items:center;justify-content:center;border-radius:12px;background:linear-gradient(150deg,#fffbfd,#f8f7fc)}
      img{display:block;height:430px;width:auto;max-width:100%;object-fit:contain}
      figcaption{text-align:center;padding:16px 0 4px}h2{margin:0;font-size:22px;font-weight:600}
      h2 span{font-size:18px;font-weight:400;color:#82718a;margin-left:10px}
      p{margin:7px 0 0;font-size:15px;color:#82718a;line-height:1.5}
    </style><main>${entries.map(entry => `<figure><div class="art"><img src="${entry.data}" alt="${entry.english}"></div><figcaption><h2>${entry.label}<span>${entry.english}</span></h2><p>${entry.description}</p></figcaption></figure>`).join('')}</main></html>`);
    await sheet.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
    const geometry = await sheet.evaluate(() => ({
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      images: [...document.images].map(image => ({ width: image.getBoundingClientRect().width, height: image.getBoundingClientRect().height, sourceWidth: image.naturalWidth, sourceHeight: image.naturalHeight })),
    }));
    assert.equal(geometry.pageWidth, geometry.viewportWidth, 'Gallery must not overflow horizontally');
    assert.equal(new Set(geometry.images.map(image => image.height / image.sourceHeight)).size, 1, 'All four characters use the same scale');
    assert.deepEqual(errors, [], 'Renderer errors during gallery capture');
    await sheet.screenshot({ path: output, fullPage: true });
    console.log(JSON.stringify({ output: path.relative(root, output), layout: '2 × 2', ...geometry }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
