/** Checks current source pixels without historical builds; never changes the running desktop pet. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createServer } = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'artifacts', 'face-integrity');
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const types = { '.html':'text/html', '.mjs':'text/javascript', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.json':'application/json' };
const server = createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    const relative = pathname.slice(1);
    const filename = path.resolve(root, relative);
    const relativeToRoot = path.relative(root, filename);
    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) throw new Error('Outside workspace');
    response.setHeader('Content-Type', types[path.extname(relative)] || 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store');
    response.end(fs.readFileSync(filename));
  } catch (error) { console.error('Asset request failed:', request.url, error.message); response.writeHead(404).end(); }
});

(async () => {
  fs.mkdirSync(destination, { recursive:true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless:true, channel:'msedge' });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport:{ width:600, height:800 }, deviceScaleFactor:1 });
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if(response.status()>=400) console.error('HTTP',response.status(),response.url()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/renderer/index.html`);
    await page.waitForSelector('html[data-ready="true"]');
    await page.locator('#pet').click({ button:'right' });
    // Click the actual styled UI labels; the decorative switch overlays inputs.
    for (const id of ['hairMotion','eyeTracking']) {
      if (await page.locator('#'+id).isChecked()) await page.locator('label').filter({has:page.locator('#'+id)}).click();
    }
    const uiSettings = { hairMotion:await page.locator('#hairMotion').isChecked(), eyeTracking:await page.locator('#eyeTracking').isChecked() };
    const result = await page.evaluate(async () => {
      const current = await import('/renderer/faithful-character.mjs');
      const { EXPRESSIONS } = await import('/renderer/state.mjs');
      const rigs = await current.loadCharacter();
      const W=1090, H=1443, checks=[], pngs={};
      const settings={hairMotion:false,eyeTracking:false};
      const state=(expression=null,blink=0)=>({expression,blink,megaphone:false,time:0,gaze:{x:0,y:0},target:{x:0,y:0},hair:0,actionAge:0});
      const canvas=(width=W,height=H)=>{const c=document.createElement('canvas');c.width=width;c.height=height;return c;};
      const pixels=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      const normalize=image=>{const c=canvas();c.getContext('2d').drawImage(image,0,0,W,H);return c;};
      const decode=async src=>{const image=new Image();image.src=src;await image.decode();return image;};
      const record=(name,passed,details)=>checks.push({name,passed,...details});
      const crop=(source,x,y,w,h)=>{const c=canvas(w,h);c.getContext('2d').drawImage(source,x,y,w,h,0,0,w,h);return c.toDataURL();};
      function frame(module,rig,expression=null,blink=0) {
        const stage=canvas(600,800);module.drawCharacter(stage.getContext('2d'),rig,state(expression,blink),settings);
        return {stage,source:rig.cache.get(`${expression??'neutral'}:${blink?'blink':'open'}`)};
      }
      // Independently chosen, small allowed regions inside the original irises,
      // plus the complete mouth. No eye outline, lash or cheek is inside them.
      const allowed=[{name:'left-pupil',x:414,y:565,rx:32,ry:33},{name:'right-pupil',x:648,y:526,rx:33,ry:33},{name:'mouth',x:537,y:634,rx:52,ry:41}];
      const inside=(x,y,r)=>((x+.5-r.x)/r.rx)**2+((y+.5-r.y)/r.ry)**2<=1;
      function compare(a,b,regions=[]) {
        if(a.width!==b.width||a.height!==b.height)throw new Error('Unequal canvas dimensions');
        const pa=pixels(a),pb=pixels(b),counts=regions.map(()=>0);
        let changedPixels=0,changedChannels=0,outsideChangedPixels=0,maxDelta=0,outsideMaxDelta=0,minX=a.width,minY=a.height,maxX=-1,maxY=-1;
        for(let i=0;i<pa.length;i+=4) {
          let changed=false,pixelMaxDelta=0;
          for(let channel=0;channel<4;channel++) {const delta=Math.abs(pa[i+channel]-pb[i+channel]);if(delta){changed=true;changedChannels++;maxDelta=Math.max(maxDelta,delta);pixelMaxDelta=Math.max(pixelMaxDelta,delta);}}
          if(!changed)continue;
          changedPixels++;const p=i/4,x=p%a.width,y=Math.floor(p/a.width);
          minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
          let accepted=false;regions.forEach((region,index)=>{if(inside(x,y,region)){counts[index]++;accepted=true;}});
          if(!accepted){outsideChangedPixels++;outsideMaxDelta=Math.max(outsideMaxDelta,pixelMaxDelta);}
        }
        return {changedPixels,changedChannels,outsideChangedPixels,outsideMaxDelta,maxDelta,bbox:changedPixels?[minX,minY,maxX+1,maxY+1]:null,regions:regions.map((region,index)=>({...region,changedPixels:counts[index]}))};
      }
      const neutral=frame(current,rigs),heart=frame(current,rigs,'heart');
      const heartDiff=compare(neutral.source,heart.source,allowed);
      record('heart changes only two pupil interiors and mouth',heartDiff.outsideChangedPixels===0,heartDiff);
      record('both pupil regions and mouth visibly change',heartDiff.regions.every(region=>region.changedPixels>300),{regions:heartDiff.regions});
      const heartPixels=pixels(heart.source),neutralPixels=pixels(neutral.source);
      const hearts=allowed.slice(0,2).map(region=>{
        let pink=0,newPink=0;
        for(let y=Math.floor(region.y-region.ry);y<=region.y+region.ry;y++)for(let x=Math.floor(region.x-region.rx);x<=region.x+region.rx;x++) {
          if(!inside(x,y,region))continue;const i=(y*W+x)*4;
          const isPink=heartPixels[i]>210&&heartPixels[i+2]>145&&heartPixels[i]-heartPixels[i+1]>14&&heartPixels[i+3]>220;
          const wasPink=neutralPixels[i]>210&&neutralPixels[i+2]>145&&neutralPixels[i]-neutralPixels[i+1]>14&&neutralPixels[i+3]>220;
          if(isPink)pink++;if(isPink&&!wasPink)newPink++;
        }
        return {name:region.name,pinkPixels:pink,newPinkPixels:newPink};
      });
      record('two pink hearts are not a no-op',hearts.every(eye=>eye.newPinkPixels>250),{eyes:hearts});

      const uiFrames=[];
      for(const id of [null,'heart']) {
        const image=await decode(window.elysiaPreview.render(id,false,0,2));
        const c=canvas(image.width,image.height);c.getContext('2d').drawImage(image,0,0);uiFrames.push(c);
        pngs[`ui-${id||'default'}.png`]=c.toDataURL();
      }
      const uiAllowed=allowed.map(r=>({...r,x:(current.RIG.x+current.RIG.scale*r.x)*2,y:(current.RIG.y+current.RIG.scale*r.y)*2,rx:r.rx*current.RIG.scale*2+3,ry:r.ry*current.RIG.scale*2+3}));
      const uiDiff=compare(uiFrames[0],uiFrames[1],uiAllowed);
      record('UI preview also confines heart changes to allowed regions',uiDiff.outsideChangedPixels===0&&uiDiff.changedPixels>1000,uiDiff);

      const blink=frame(current,rigs,null,1),heartBlink=frame(current,rigs,'heart',1);
      const blinkHeartDiff=compare(blink.source,heartBlink.source,[allowed[2]]);
      // The clean PNG has alpha=254 in parts of its skin, so compositing can leave
      // one-channel rounding differences. Report every pixel, allowing only 1/255
      // here; the open-heart exterior and pat source comparisons remain strict-zero.
      record('heart blink removes pupil detail within 1/255 compositing precision',blinkHeartDiff.outsideMaxDelta<=1&&blinkHeartDiff.changedPixels>300,{tolerance:1,...blinkHeartDiff});
      const mouthRect=[503,611,69,50],mouthOpen=canvas(69,50),mouthClosed=canvas(69,50);
      mouthOpen.getContext('2d').drawImage(heart.source,...mouthRect,0,0,69,50);
      mouthClosed.getContext('2d').drawImage(heartBlink.source,...mouthRect,0,0,69,50);
      const mouthBlinkDiff=compare(mouthOpen,mouthClosed);
      record('heart mouth stays pixel-identical during blink',mouthBlinkDiff.changedPixels===0,{rectangle:mouthRect,...mouthBlinkDiff});
      pngs['heart-mouth-open.png']=mouthOpen.toDataURL();pngs['heart-mouth-blink.png']=mouthClosed.toDataURL();
      for(const [id,source] of [['default',neutral.source],['heart',heart.source],['blink',blink.source],['heart-blink',heartBlink.source]])pngs[`face-${id}.png`]=crop(source,300,365,470,340);

      const pat=frame(current,rigs,'pat'),expectedPat=normalize(rigs.images.pat),patSourceDiff=compare(pat.source,expectedPat);
      record('pat source exactly equals normalized v5 asset',patSourceDiff.changedPixels===0,patSourceDiff);
      const expectedPatStage=canvas(600,800),pc=expectedPatStage.getContext('2d');
      const meshPat=rigs.mesh.draw(expectedPat,'independent-pat-expected',state('pat'),settings,false);
      pc.translate(current.RIG.x,current.RIG.y);pc.scale(current.RIG.scale,current.RIG.scale);pc.drawImage(meshPat,0,0,W,H);
      const patStageDiff=compare(pat.stage,expectedPatStage);
      record('pat final stage has no extra hand or other external overlay',patStageDiff.changedPixels===0,patStageDiff);
      pngs['pat-stage.png']=pat.stage.toDataURL();

      const allExpressions=[];
      for(const {id} of EXPRESSIONS) {
        const rendered=frame(current,rigs,id),data=pixels(rendered.source);let nontransparentPixels=0;
        for(let i=3;i<data.length;i+=4)if(data[i])nontransparentPixels++;
        allExpressions.push({id,width:rendered.source.width,height:rendered.source.height,nontransparentPixels});
      }
      record('all 17 expressions render nonempty full source frames',allExpressions.length===17&&allExpressions.every(x=>x.width===W&&x.height===H&&x.nontransparentPixels>300000),{expressions:allExpressions});

      // End-cap style is a visual check; save current artwork for inspection
      // without depending on discarded expression assets or older executables.
      for(const id of ['sleep','squint','wink','pat']) {
        pngs[`face-${id}.png`]=crop(normalize(rigs.images[id]),300,365,470,340);
      }
      return {checks,pngs,heartAllowedRegions:allowed,hearts,allExpressions,visualReviewRequired:['closed-eye end caps','expression appearance']};
    });
    const {pngs,...measurements}=result;
    for(const [name,data]of Object.entries(pngs))fs.writeFileSync(path.join(destination,name),Buffer.from(data.split(',')[1],'base64'));
    const report={generatedAt:new Date().toISOString(),version:JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version,rendererSha256:sha256(path.join(root,'renderer','faithful-character.mjs')),uiSettings,browserErrors:errors,...measurements};
    report.passed=report.checks.every(check=>check.passed)&&errors.length===0&&!uiSettings.hairMotion&&!uiSettings.eyeTracking;
    fs.writeFileSync(path.join(destination,'results.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,failed:report.checks.filter(check=>!check.passed),heart:report.checks[0],browserErrors:errors,destination}));
    if(!report.passed)process.exitCode=1;
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
