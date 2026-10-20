/** Verifies prop-pose fabric colours and alpha without modifying any source image. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createServer } = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'artifacts', 'outfit-integrity');
const mime = { '.html':'text/html', '.mjs':'text/javascript', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.json':'application/json' };
const server = createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/__outfit_audit.html') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><meta charset="utf-8"><title>Outfit integrity audit</title>');
      return;
    }
    if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    const file = path.resolve(root, pathname.slice(1));
    const relative = path.relative(root, file);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      response.writeHead(403).end(); return;
    }
    response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store');
    response.end(fs.readFileSync(file));
  } catch { response.writeHead(404).end(); }
});
const savePng = (filename, url) => fs.writeFileSync(path.join(destination, filename), Buffer.from(url.split(',')[1], 'base64'));
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

(async () => {
  fs.mkdirSync(destination, { recursive:true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless:true, channel:'msedge' });
  try {
    const page = await browser.newPage();
    const browserErrors = [];
    page.on('pageerror', error => browserErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/__outfit_audit.html`);
    const result = await page.evaluate(async () => {
      const { harmonizePoseOutfit } = await import('/renderer/outfit-palette.mjs');
      const { loadCharacter } = await import('/renderer/faithful-character.mjs');
      const W=1090, H=1443;
      const makeCanvas = () => { const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;return canvas; };
      const pixels = canvas => canvas.getContext('2d').getImageData(0,0,W,H).data;
      const load = async name => {
        const image=new Image();image.src=`/assets/v3/character-${name}.png`;await image.decode();
        const canvas=makeCanvas();canvas.getContext('2d',{willReadFrequently:true}).drawImage(image,0,0,W,H);return canvas;
      };
      function sample(data, rectangle, accepts) {
        const colours=[[],[],[]], [x0,y0,width,height]=rectangle;
        for(let y=y0;y<y0+height;y++)for(let x=x0;x<x0+width;x++) {
          const offset=(y*W+x)*4, [r,g,b,a]=data.subarray(offset,offset+4);
          if(a<245 || !accepts(r,g,b))continue;
          for(let channel=0;channel<3;channel++)colours[channel].push(data[offset+channel]);
        }
        if(colours[0].length<1000)throw new Error('Insufficient fabric samples');
        return { count:colours[0].length, median:colours.map(values=>values.sort((a,b)=>a-b)[values.length>>1]) };
      }
      // Independent interior sample regions exclude buttons, skin and outlines.
      const sampleAll = data => ({
        stockings:sample(data,[420,1090,220,200],(r,g,b)=>r>55&&r<130&&g>35&&g<110&&b>55&&b<135&&r-g>7&&r-g<32&&Math.abs(r-b)<20),
        dress:sample(data,[455,890,140,100],(r,g,b)=>b>r+10&&b>g+10&&b<150&&g>25),
      });
      const inside = (x,y,points) => {
        let contained=false;
        for(let i=0,j=points.length-1;i<points.length;j=i++) {
          const [ax,ay]=points[j], [bx,by]=points[i];
          if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)contained=!contained;
        }
        return contained;
      };
      const propRegions = {
        tea:[[520,660],[598,644],[632,680],[641,769],[617,787],[552,784]],
        cake:[[298,746],[350,680],[425,682],[484,780],[475,807],[303,807]],
        cat:[[793,970],[1089,950],[1089,1240],[795,1240]],
        megaphone:[[30,485],[150,480],[390,626],[394,704],[380,735],[388,806],[304,816],[289,737],[26,758]],
      };
      const crop = canvas => {
        const output=document.createElement('canvas');output.width=590;output.height=650;
        output.getContext('2d').drawImage(canvas,240,780,590,650,0,0,590,650);return output.toDataURL();
      };
      const neutral=await load('neutral'), target=sampleAll(pixels(neutral));
      const loaded=await loadCharacter(), poses=[];
      for(const name of Object.keys(propRegions)) {
        const before=await load(name), a=pixels(before), after=harmonizePoseOutfit(before,neutral), b=pixels(after);
        const integrated=pixels(loaded.images[name]);
        let alphaChanged=0, outsideChanged=0, propChanged=0, changedPixels=0;
        let maxChange=0, maxOutsideChange=0, maxPropChange=0;
        const difference=makeCanvas(), context=difference.getContext('2d'), diff=context.createImageData(W,H);
        for(let offset=0;offset<a.length;offset+=4) {
          const p=offset/4,x=p%W,y=Math.floor(p/W);
          if(a[offset+3]!==b[offset+3])alphaChanged++;
          let amount=0;
          for(let channel=0;channel<3;channel++) {
            amount=Math.max(amount,Math.abs(a[offset+channel]-b[offset+channel]));
          }
          if(!amount)continue;
          changedPixels++;maxChange=Math.max(maxChange,amount);
          if(x<300||x>=785||y<815||y>=1425) { outsideChanged++;maxOutsideChange=Math.max(maxOutsideChange,amount); }
          if(inside(x,y,propRegions[name])) { propChanged++;maxPropChange=Math.max(maxPropChange,amount); }
          // Highlight real correction; a 1/255 canvas conversion is reported in
          // JSON but omitted from this visual difference map for readability.
          if(amount>1)diff.data.set([255,60,100,Math.min(255,50+amount*20)],offset);
        }
        context.putImageData(diff,0,0);
        const beforeColours=sampleAll(a), afterColours=sampleAll(b), runtimeColours=sampleAll(integrated);
        const coloursMatch = colours => Object.keys(target).every(material=>colours[material].median.every((value,i)=>Math.abs(value-target[material].median[i])<=1));
        const checks={
          returnsSeparateCanvas:after!==before,
          identicalAlpha:alphaChanged===0,
          outsideClothesWithinRounding:maxOutsideChange<=1,
          propsWithinRounding:maxPropChange<=1,
          medianColoursMatch:coloursMatch(afterColours),
          runtimePaletteMatchesReference:coloursMatch(runtimeColours),
        };
        poses.push({ name,checks,alphaChanged,outsideChanged,propChanged,changedPixels,maxChange,maxOutsideChange,maxPropChange,
          beforeColours,afterColours,runtimeColours,
          pngs:{before:before.toDataURL(),after:after.toDataURL(),difference:difference.toDataURL(),beforeCrop:crop(before),afterCrop:crop(after)} });
      }
      return { target,neutral:neutral.toDataURL(),poses };
    });

    for(const pose of result.poses)for(const [kind,png] of Object.entries(pose.pngs))savePng(`${pose.name}-${kind}.png`,png);
    savePng('neutral.png',result.neutral);
    const report={generatedAt:new Date().toISOString(),version:JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,
      calibrationSha256:sha256(path.join(root,'renderer','outfit-palette.mjs')),browserErrors,roundingTolerance:1,
      target:result.target,poses:result.poses.map(({pngs,...pose})=>pose),visualReviewRequired:['fabric shading and transition edges','hands and props','unchanged garment patterns']};
    report.passed=browserErrors.length===0&&report.poses.every(pose=>Object.values(pose.checks).every(Boolean));
    fs.writeFileSync(path.join(destination,'results.json'),JSON.stringify(report,null,2)+'\n');

    const sheet=await browser.newPage({viewport:{width:1530,height:470},deviceScaleFactor:1});
    await sheet.setContent('<style>body{margin:15px;background:#faf1f6;font:16px Segoe UI}main{display:grid;grid-template-columns:repeat(5,290px);gap:10px}figure{margin:0;background:white;text-align:center}img{display:block;width:290px;height:auto}p{margin:8px}</style><main>'+
      [{name:'neutral reference',pngs:{after:result.neutral}},...result.poses].map(pose=>`<figure><img src="${pose.pngs.after}"><p>${pose.name}</p></figure>`).join('')+'</main>');
    await sheet.evaluate(()=>Promise.all([...document.images].map(image=>image.decode())));
    await sheet.screenshot({path:path.join(destination,'full-after.png'),fullPage:true});
    await sheet.setViewportSize({width:1230,height:780});
    await sheet.setContent('<style>body{margin:15px;background:#faf1f6;font:16px Segoe UI}main{display:grid;grid-template-columns:repeat(4,295px);gap:6px}figure{margin:0;background:white;text-align:center}img{display:block;width:295px;height:auto}p{margin:8px}</style><main>'+
      result.poses.flatMap(pose=>[{label:pose.name+' before',data:pose.pngs.beforeCrop},{label:pose.name+' after',data:pose.pngs.afterCrop}]).map(item=>`<figure><img src="${item.data}"><p>${item.label}</p></figure>`).join('')+'</main>');
    await sheet.evaluate(()=>Promise.all([...document.images].map(image=>image.decode())));
    await sheet.screenshot({path:path.join(destination,'outfit-before-after.png'),fullPage:true});
    console.log(JSON.stringify({passed:report.passed,poses:report.poses.map(pose=>({name:pose.name,checks:pose.checks,afterColours:pose.afterColours})),browserErrors,destination}));
    if(!report.passed)process.exitCode=1;
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
