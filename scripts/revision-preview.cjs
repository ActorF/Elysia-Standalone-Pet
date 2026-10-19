/** Creates a compact contact sheet from the actual high-resolution expression captures. */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const faces = [
  ['default', '默认 · 保留原图眼睛'], ['heart', '爱心眼 · 空格 + 0'],
  ['sleep', '睡觉 · 空格 + 4'], ['squint', '眯眼 · 空格 + 6'],
  ['wink', 'Wink · 空格 + 8'], ['pat', '摸头 · 空格 + F5'],
];
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 720 }, deviceScaleFactor: 1 });
    const cards = faces.map(([id, label]) => {
      const data = fs.readFileSync(path.join(root, 'artifacts', 'expression-review', `face-${id}.png`)).toString('base64');
      return `<figure><img src="data:image/png;base64,${data}"><figcaption>${label}</figcaption></figure>`;
    }).join('');
    await page.setContent(`<!doctype html><html lang="zh"><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;padding:24px;background:#f5edf3;color:#57364c;font-family:'Segoe UI','Microsoft Yahei',sans-serif}
      h1{font-size:23px;margin:0 0 5px}p{font-size:13px;margin:0 0 20px;color:#8a667e}
      main{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}figure{margin:0;padding:8px;background:#fff;border-radius:12px}
      img{display:block;width:100%;aspect-ratio:524/368;object-fit:contain;background:#fffaf7}
      figcaption{font-size:14px;text-align:center;padding:11px 0 5px}
    </style><h1>表情调整 · 0.5.0</h1><p>实际桌宠渲染截图 · 原眼轮廓与心形瞳孔 · 闭眼两端线宽 · 摸头表情不再附加手掌</p><main>${cards}</main></html>`);
    await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
    await page.screenshot({ path: path.join(root, 'artifacts', 'expression-preview.png'), fullPage: true });
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
