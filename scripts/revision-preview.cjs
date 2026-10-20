/** Creates a compact contact sheet from the actual high-resolution expression captures. */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const faces = [
  ['default', '默认'], ['angry', '生气 · 空格 + 2'],
  ['sleep', '睡觉 · 空格 + 3'], ['dizzy', '晕 · 空格 + 5'],
  ['wink', 'Wink · 空格 + 6'], ['cry', '伤心 · 空格 + 7'],
  ['heart', '爱心眼 · 空格 + 8'], ['smile', '微笑 · 空格 + 9'],
];
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 720 }, deviceScaleFactor: 1 });
    const cards = faces.map(([id, label]) => {
      const data = fs.readFileSync(path.join(root, 'artifacts', 'expression-review', `face-${id}.png`)).toString('base64');
      return `<figure><img src="data:image/png;base64,${data}"><figcaption>${label}</figcaption></figure>`;
    }).join('');
    await page.setContent(`<!doctype html><html lang="zh"><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;padding:24px;background:#f5edf3;color:#57364c;font-family:'Segoe UI','Microsoft Yahei',sans-serif}
      h1{font-size:23px;margin:0 0 5px}p{font-size:13px;margin:0 0 20px;color:#8a667e}
      main{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}figure{margin:0;padding:8px;background:#fff;border-radius:12px}
      img{display:block;width:100%;aspect-ratio:524/368;object-fit:contain;background:#fffaf7}
      figcaption{font-size:14px;text-align:center;padding:11px 0 5px}
    </style><h1>表情调整 · 0.8.0</h1><p>实际桌宠渲染截图 · 参考图重绘睡觉、生气、晕 · 表情与动作独立 · 猫猫和眼镜可同时开启</p><main>${cards}</main></html>`);
    await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
    await page.screenshot({ path: path.join(root, 'artifacts', 'expression-preview.png'), fullPage: true });
    const combinations=[['full-sleep','睡觉 · 羊与 ZZZ'],['full-angry','生气 · 鼓脸'],['full-dizzy','晕 · 螺旋眼与装饰'],['combo-tea','猫猫 + 眼镜 + 生气 + 奶茶']];
    await page.setViewportSize({width:1240,height:600});
    await page.setContent(`<html lang="zh"><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;padding:24px;background:#f5edf3;color:#57364c;font-family:'Segoe UI','Microsoft Yahei',sans-serif}
      h1{font-size:22px;margin:0 0 6px}p{font-size:13px;margin:0 0 16px;color:#8a667e}
      main{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}figure{margin:0;background:#fff9fc;border-radius:12px;padding:8px}
      img{display:block;width:100%;height:410px;object-fit:contain}figcaption{text-align:center;font-size:13px;padding:8px 0}
    </style><h1>爱莉希雅 · 0.8.0</h1><p>表情独立切换，动作保持；猫猫与眼镜可同时开启。</p><main>${combinations.map(([id,label])=>`<figure><img src="data:image/png;base64,${fs.readFileSync(path.join(root,'artifacts','expression-review',id+'.png')).toString('base64')}"><figcaption>${label}</figcaption></figure>`).join('')}</main></html>`);
    await page.evaluate(()=>Promise.all([...document.images].map(image=>image.decode())));
    await page.screenshot({path:path.join(root,'artifacts','combination-preview.png'),fullPage:true});
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
