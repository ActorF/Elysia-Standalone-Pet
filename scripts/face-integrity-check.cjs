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
      const state=(expression=null,blink=0,megaphone=false)=>({expression,blink,megaphone,time:0,gaze:{x:0,y:0},target:{x:0,y:0},hair:0,actionAge:0});
      const canvas=(width=W,height=H)=>{const c=document.createElement('canvas');c.width=width;c.height=height;return c;};
      const pixels=c=>c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      const decode=async src=>{const image=new Image();image.src=src;await image.decode();return image;};
      const record=(name,passed,details)=>checks.push({name,passed,...details});
      const crop=(source,x,y,w,h)=>{const c=canvas(w,h);c.getContext('2d').drawImage(source,x,y,w,h,0,0,w,h);return c.toDataURL();};
      const normalize=image=>{const result=canvas();result.getContext('2d').drawImage(image,0,0,W,H);return result;};
      function frame(module,rig,expression=null,blink=0,horn=false) {
        const stage=canvas(600,800);module.drawCharacter(stage.getContext('2d'),rig,state(expression,blink,horn),settings);
        const prefix=horn?'horn':expression??'neutral';
        return {stage,source:rig.cache.get(`${prefix}:${blink?'blink':'open'}`)||rig.cache.get(`${prefix}:open`)};
      }
      // Independently chosen, small allowed regions inside the original irises,
      // plus the complete mouth. No eye outline, lash or cheek is inside them.
      const allowed=[{name:'left-pupil',x:414,y:565,rx:32,ry:33},{name:'right-pupil',x:648,y:526,rx:33,ry:33},{name:'mouth',x:537,y:634,rx:52,ry:41}];
      const inside=(x,y,r)=>r.width===undefined
        ? ((x+.5-r.x)/r.rx)**2+((y+.5-r.y)/r.ry)**2<=1
        : x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height;
      function compare(a,b,regions=[],fromY=0) {
        if(a.width!==b.width||a.height!==b.height)throw new Error('Unequal canvas dimensions');
        const pa=pixels(a),pb=pixels(b),counts=regions.map(()=>0);
        let changedPixels=0,changedChannels=0,outsideChangedPixels=0,maxDelta=0,outsideMaxDelta=0,minX=a.width,minY=a.height,maxX=-1,maxY=-1;
        for(let i=fromY*a.width*4;i<pa.length;i+=4) {
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
      function compareRectangle(a,b,rectangle,tolerance=0,filter=null) {
        const pa=pixels(a),pb=pixels(b),[x,y,width,height]=rectangle;
        let changedPixels=0,beyondTolerance=0,maxDelta=0,totalDelta=0,testedPixels=0,minX=W,minY=H,maxX=-1,maxY=-1;
        for(let py=y;py<y+height;py++)for(let px=x;px<x+width;px++) {
          const i=(py*W+px)*4;if(filter&&!filter(px,py,pa,i))continue;let delta=0;testedPixels++;
          for(let channel=0;channel<4;channel++) {
            const difference=Math.abs(pa[i+channel]-pb[i+channel]);delta=Math.max(delta,difference);totalDelta+=difference;
          }
          if(delta)changedPixels++;if(delta>tolerance){beyondTolerance++;minX=Math.min(minX,px);minY=Math.min(minY,py);maxX=Math.max(maxX,px);maxY=Math.max(maxY,py);}maxDelta=Math.max(maxDelta,delta);
        }
        return {rectangle,tolerance,testedPixels,changedPixels,beyondTolerance,maxDelta,beyondToleranceBounds:beyondTolerance?[minX,minY,maxX+1,maxY+1]:null,meanChannelDelta:totalDelta/(testedPixels*4)};
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
      // here; the open-heart exterior and common-body comparisons remain strict-zero.
      record('heart blink removes pupil detail within 1/255 compositing precision',blinkHeartDiff.outsideMaxDelta<=1&&blinkHeartDiff.changedPixels>300,{tolerance:1,...blinkHeartDiff});
      const mouthRect=[503,611,69,50],mouthOpen=canvas(69,50),mouthClosed=canvas(69,50);
      mouthOpen.getContext('2d').drawImage(heart.source,...mouthRect,0,0,69,50);
      mouthClosed.getContext('2d').drawImage(heartBlink.source,...mouthRect,0,0,69,50);
      const mouthBlinkDiff=compare(mouthOpen,mouthClosed);
      record('heart mouth stays pixel-identical during blink',mouthBlinkDiff.changedPixels===0,{rectangle:mouthRect,...mouthBlinkDiff});
      pngs['heart-mouth-open.png']=mouthOpen.toDataURL();pngs['heart-mouth-blink.png']=mouthClosed.toDataURL();
      for(const [id,source] of [['default',neutral.source],['heart',heart.source],['blink',blink.source],['heart-blink',heartBlink.source]])pngs[`face-${id}.png`]=crop(source,300,365,470,340);

      const pat=frame(current,rigs,'pat');
      // This generously bounded face rectangle is independent of the runtime's
      // skin mask. Everything around it must be the original shared character.
      const faceRegion={name:'face and forehead',x:280,y:295,width:535,height:410};
      const patSourceDiff=compare(neutral.source,pat.source,[faceRegion]);
      record('pat preserves the exterior within 1/255 alpha readback precision',patSourceDiff.outsideMaxDelta<=1,{tolerance:1,...patSourceDiff});
      const expectedPatStage=canvas(600,800),pc=expectedPatStage.getContext('2d');
      const meshPat=rigs.mesh.draw(pat.source,'independent-pat-expected',state('pat'),settings,false);
      pc.translate(current.RIG.x,current.RIG.y);pc.scale(current.RIG.scale,current.RIG.scale);pc.drawImage(meshPat,0,0,W,H);
      const patStageDiff=compare(pat.stage,expectedPatStage);
      record('pat final stage has no extra hand or other external overlay',patStageDiff.changedPixels===0,patStageDiff);
      pngs['pat-stage.png']=pat.stage.toDataURL();

      const allExpressions=[],commonBodies=[];
      const props=new Set(['cat','cake','tea']);
      const bodyRectangle=[0,710,W,H-710];
      for(const {id} of EXPRESSIONS) {
        const rendered=frame(current,rigs,id),data=pixels(rendered.source);let nontransparentPixels=0;
        for(let i=3;i<data.length;i+=4)if(data[i])nontransparentPixels++;
        allExpressions.push({id,width:rendered.source.width,height:rendered.source.height,nontransparentPixels});
        pngs[`face-${id}.png`]=crop(rendered.source,300,365,470,340);
        if(!props.has(id)) {
          // Read source RGBA directly. Drawing into a second crop canvas can
          // round translucent edge channels and is not a source-pixel check.
          const difference=compare(neutral.source,rendered.source,[],710);
          commonBodies.push({id,...difference});
          record(`${id}: clothing and stockings exactly match neutral RGBA`,difference.changedPixels===0,{rectangle:bodyRectangle,...difference});
        }
      }
      record('all 17 expressions render nonempty full source frames',allExpressions.length===17&&allExpressions.every(x=>x.width===W&&x.height===H&&x.nontransparentPixels>300000),{expressions:allExpressions});
      record('all 14 non-prop expressions were checked for identical body colors',commonBodies.length===14,{ids:commonBodies.map(item=>item.id)});

      for(const id of ['sleep','squint','pat','smile']) {
        const open=frame(current,rigs,id,0),closed=frame(current,rigs,id,1),difference=compare(open.stage,closed.stage);
        record(`${id}: automatic blinking does not replace an already closed expression`,difference.changedPixels===0,difference);
      }

      // The user approved a single painted closed-eye design. Compare actual
      // rendered source regions with that art; do not impose an older stroke,
      // eyebrow-coordinate or expression-specific drawing convention.
      const canonicalClosed=normalize(await decode('/assets/v6/character-closed.png'));
      // Stop the right-eye window above the megaphone mouth-protection region;
      // the eyelid and its crease are entirely above y575 in the approved art.
      const eyeRegions={left:[370,490,95,95],right:[575,445,125,130]};
      const canonicalPixels=pixels(canonicalClosed);
      const canonicalPresence=Object.entries(eyeRegions).map(([side,[x,y,width,height]])=>{
        let inkPixels=0,blueIrisPixels=0;
        for(let py=y;py<y+height;py++)for(let px=x;px<x+width;px++) {
          const i=(py*W+px)*4,r=canonicalPixels[i],g=canonicalPixels[i+1],b=canonicalPixels[i+2];
          if(canonicalPixels[i+3]>220&&r<120&&g<90&&b<125)inkPixels++;
          if(canonicalPixels[i+3]>220&&g>80&&b>r+30&&b>g+20)blueIrisPixels++;
        }
        return {side,rectangle:[x,y,width,height],inkPixels,blueIrisPixels};
      });
      record('canonical closed-eye artwork contains both painted lids',canonicalPresence.every(eye=>eye.inkPixels>300&&eye.blueIrisPixels<80),{eyes:canonicalPresence});
      pngs['face-canonical-closed.png']=crop(canonicalClosed,300,365,470,340);
      const closedStates=['sleep','squint','pat','smile'].map(id=>({id,expression:id,blink:0,horn:false,sides:['left','right']}));
      closedStates.push(
        {id:'automatic blink',expression:null,blink:1,horn:false,sides:['left','right']},
        {id:'heart blink',expression:'heart',blink:1,horn:false,sides:['left','right']},
        {id:'wink',expression:'wink',blink:0,horn:false,sides:['right']},
        {id:'megaphone',expression:null,blink:0,horn:true,sides:['left','right']},
      );
      const canonicalMeasurements=[];
      for(const {id,expression,blink:blinkValue,horn,sides} of closedStates) {
        const rendered=frame(current,rigs,expression,blinkValue,horn);
        const eyes=sides.map(side=>({side,...compareRectangle(canonicalClosed,rendered.source,eyeRegions[side],4)}));
        canonicalMeasurements.push({id,eyes});
        record(`${id}: uses the approved canonical closed-eye painting`,eyes.every(eye=>eye.beyondTolerance===0),{eyes});
      }
      const wink=frame(current,rigs,'wink');
      for(const [name,rectangle] of [['left eye',[315,465,170,165]],['smiling mouth',[490,600,90,72]]]) {
        const difference=compareRectangle(neutral.source,wink.source,rectangle,1);
        record(`wink preserves the original ${name}`,difference.beyondTolerance===0,difference);
      }
      const horn=frame(current,rigs,null,0,true),originalHorn=normalize(rigs.images.megaphone);
      const polygonContains=(x,y,polygon)=>{
        let inside=false;
        for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
          const [xi,yi]=polygon[i],[xj,yj]=polygon[j];
          if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;
        }
        return inside;
      };
      // The prop overlaps the cheek, so broad rectangles include changed face
      // skin. These interior silhouettes were observed in the original pose.
      // Mouth ink/fill is checked separately from surrounding cheek shading.
      const hornMouth=compareRectangle(originalHorn,horn.source,[492,585,95,78],1,
        (x,y,data,i)=>data[i+3]>220&&data[i]>data[i+1]+25&&data[i]>data[i+2]+30&&data[i+1]<190);
      record('closed-eye megaphone preserves its mouth ink and fill',hornMouth.beyondTolerance===0&&hornMouth.testedPixels>1500,hornMouth);
      for(const [name,rectangle,polygon] of [
        ['megaphone bell',[20,478,185,280],[[40,688],[40,641],[54,580],[90,532],[132,504],[157,516],[172,552],[175,614],[160,673],[133,713],[93,731],[65,728]]],
        ['megaphone cone',[171,513,216,213],[[171,513],[315,588],[370,609],[382,643],[380,671],[360,695],[176,725],[196,678],[208,618],[198,560]]],
        ['megaphone stem',[315,590,85,120],[[337,610],[369,619],[385,640],[386,669],[376,689],[335,694]]],
        ['hand and handle',[285,720,115,105],null],
      ]) {
        const difference=compareRectangle(originalHorn,horn.source,rectangle,1,polygon?((x,y)=>polygonContains(x,y,polygon)):null);
        record(`closed-eye megaphone preserves its ${name}`,difference.beyondTolerance===0,difference);
      }
      const hornBody=compare(originalHorn,horn.source,[],710);
      record('closed-eye megaphone preserves the entire lower pose',hornBody.maxDelta<=1,{tolerance:1,...hornBody});
      pngs['face-megaphone.png']=crop(horn.source,300,365,470,340);
      pngs['megaphone-stage.png']=horn.stage.toDataURL();
      return {checks,pngs,heartAllowedRegions:allowed,hearts,allExpressions,commonBodies,canonicalMeasurements,canonicalPresence,visualReviewRequired:['match the user-approved closed-eye reference','eyebrow and eyelid-crease appearance','expression appearance']};
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
