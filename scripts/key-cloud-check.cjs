/** Live typing, one-second flight, native motion envelope and tray checks in a hidden browser. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createServer}=require('node:http'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'artifacts/key-cloud');
const {DEFAULT_SETTINGS}=require('../electron/host-policy.cjs');
const server=createServer((req,res)=>{
 const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 try{res.setHeader('Content-Type',({'.mjs':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
});
function installBridge(defaults){
 const callbacks={},settings={...defaults,keyDisplay:true};let active=true;
 const viewport={width:740,height:800,characterX:140,characterY:0,characterWidth:600,characterHeight:800,clipped:false};
 window.__cloudQA={regions:[],key:c=>callbacks.typed(c),drag:v=>callbacks.drag(v),pose:id=>callbacks.action({type:'pose',id}),
  set(patch){Object.assign(settings,patch);callbacks.settings({settings:{...settings},hotkeys:{typing:{active},legacy:{active:false}}});},
  native(v){active=v;this.set({});},viewport:v=>callbacks.viewport(v)};
 window.elysiaDesktop={getState:async()=>({settings,viewport,hotkeys:{typing:{active:true},legacy:{active:false}}}),
  onPointer:f=>callbacks.pointer=f,onDragState:f=>callbacks.drag=f,onAction:f=>callbacks.action=f,onSettings:f=>callbacks.settings=f,
  onViewport:f=>callbacks.viewport=f,onTypedKey:f=>callbacks.typed=f,setAppearance(){},dragStart(){},dragEnd(){},
  setHitRegion:async r=>{window.__cloudQA.regions.push(r);return true;},setSettings:async p=>{Object.assign(settings,p);return {settings};}};
}
async function previewSheet(browser,previews,filename){
 const sheet=await browser.newPage({viewport:{width:1800,height:760}});
 try{
  await sheet.setContent(`<meta charset="utf-8"><style>body{margin:0;padding:15px;display:flex;gap:10px;background:#fcf5f9;font:24px 'Microsoft YaHei';color:#713352}figure{margin:0;width:340px;text-align:center}img{width:100%}</style>${previews.map(p=>`<figure><img src="${p.data}"><figcaption>${p.label}</figcaption></figure>`).join('')}`);
  await sheet.evaluate(()=>Promise.all([...document.images].map(i=>i.decode())));
  await sheet.screenshot({path:path.join(out,filename),fullPage:true});
 }finally{await sheet.close();}
}
(async()=>{
 fs.mkdirSync(out,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:740,height:800},deviceScaleFactor:2}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(installBridge,DEFAULT_SETTINGS);
  await page.goto(`http://127.0.0.1:${server.address().port}/renderer/index.html`);await page.waitForSelector('html[data-ready="true"]');await page.waitForTimeout(80);
  const status=()=>page.evaluate(()=>window.elysiaPreview.keyDisplay());
  const send=value=>page.evaluate(c=>window.__cloudQA.key(c),value);
  const count=()=>page.evaluate(()=>window.__cloudQA.regions.length);
  const leftPixels=(right=140)=>page.evaluate(right=>{
   const canvas=document.querySelector('#pet'),width=Math.floor(right*canvas.width/innerWidth);
   const pixels=canvas.getContext('2d').getImageData(0,0,width,canvas.height).data;
   let visible=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>4)visible++;
   return visible;
  },right);
  const initial=await count();assert.equal(await status(),null);
  await send('a');await page.waitForTimeout(80);assert.equal((await status()).character,'a');assert.equal(await count(),initial+1);
  await page.evaluate(()=>{for(const key of '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ!?., ')window.__cloudQA.key(key);});
  await page.waitForTimeout(80);assert.equal((await status()).character,' ');assert.equal(await count(),initial+1,'Changing glyph never expands/rebuilds the native region');
  for(const key of ['Enter','Control','Shift','Backspace','Tab','ArrowUp','F1','aB','😀'])await send(key);
  assert.equal((await status()).character,' ');
  await page.keyboard.press('b');assert.equal((await status()).character,' ','Native input suppresses duplicate DOM input');
  await page.evaluate(()=>window.__cloudQA.native(false));
  await page.keyboard.press('a');assert.equal((await status()).character,'a');
  await page.keyboard.press('Shift+KeyA');assert.equal((await status()).character,'A');
  await page.keyboard.press('Shift+Digit1');assert.equal((await status()).character,'!');
  await page.keyboard.press('Control+a');assert.equal((await status()).character,'!');
  await page.keyboard.press('Space');assert.equal((await status()).character,' ');await page.keyboard.up('Space');

  // Scan beyond every padded canvas edge, so a negative-x flight cannot pass
  // merely because its clipped pixels were never included in the readback.
  const coverage=await page.evaluate(async()=>{
   const {drawKeyCloud,keyCloudFrame,KEY_EFFECT_BOUNDS}=await import('./key-cloud.mjs');
   const {withKeyCloudRegion}=await import('./hit-region.mjs');
   const base={width:600,height:800,rects:[]},result={},padding=KEY_EFFECT_BOUNDS.left;
   for(const pose of ['idle','tea','cake','megaphone']){
    const region=withKeyCloudRegion(base,true,pose),{width,height}=region,mask=new Uint8Array(width*height);
    for(const r of region.rects)for(let y=Math.max(0,r.y);y<Math.min(height,r.y+r.height);y++)for(let x=Math.max(0,r.x);x<Math.min(width,r.x+r.width);x++)mask[y*width+x]=1;
    const c=document.createElement('canvas');c.width=width+200;c.height=height+200;const ctx=c.getContext('2d',{willReadFrequently:true});
    let shown=0,missed=0,clipped=0,minX=width,maxX=0,minY=height,maxY=0,negativeX=0,visibleFrames=0;const frames=[];
    for(let frame=0;frame<=60;frame++){
     const age=frame/60,display={character:'A',age,opacity:age>.7?(1-age)/.3:1};
     ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,c.width,c.height);ctx.translate(100+padding,100);drawKeyCloud(ctx,display,{pose});
     const pixels=ctx.getImageData(0,0,c.width,c.height).data;let frameShown=0,frameMissed=0;
     for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(pixels[(y*c.width+x)*4+3]>4){
      const px=x-100,py=y-100;shown++;frameShown++;minX=Math.min(minX,px);maxX=Math.max(maxX,px);minY=Math.min(minY,py);maxY=Math.max(maxY,py);
      if(px<padding)negativeX++;
      if(px<0||py<0||px>=width||py>=height)clipped++;
      else if(!mask[py*width+px]){missed++;frameMissed++;}
     }
     if(frameShown>0)visibleFrames++;
     frames.push({age,shown:frameShown,missed:frameMissed,...keyCloudFrame(display,pose)});
    }
    const cached=withKeyCloudRegion(base,true,pose),hidden=withKeyCloudRegion(base,false,pose);
    result[pose]={shown,missed,clipped,minX,maxX,minY,maxY,negativeX,width,height,originX:region.originX,referenceWidth:region.referenceWidth,visibleFrames,frames,
     sameBoundsWhenHidden:hidden.width===width&&hidden.height===height&&hidden.originX===region.originX&&hidden.referenceWidth===region.referenceWidth,
     sameCachedRectangles:cached.rects.length===region.rects.length&&cached.rects.every((r,i)=>r===region.rects[i])};
   }
   return result;
  });
  for(const [pose,value]of Object.entries(coverage)){
   assert.ok(value.shown>5000,pose);assert.equal(value.missed,0,`${pose}: native region contains every flight pixel`);
   assert.equal(value.width,740);assert.equal(value.height,800);assert.equal(value.originX,-140);assert.equal(value.referenceWidth,600);
   assert.equal(value.clipped,0,`${pose}: cloud and sound waves remain inside the extended canvas`);
   assert.ok(value.minX>0&&value.maxX<value.width-1&&value.minY>0&&value.maxY<value.height-1,`${pose}: every edge leaves visible clearance`);
   assert.ok(value.visibleFrames>=58);assert.equal(value.sameCachedRectangles,true,'Animation reuses the prebuilt motion envelope');
   assert.equal(value.sameBoundsWhenHidden,true,'Expiry never resizes or repositions the character canvas');
  }
  assert.ok(coverage.megaphone.negativeX>5000,'The enlarged flight genuinely uses the new margin left of the character canvas');

  await page.evaluate(()=>window.__cloudQA.native(true));await page.waitForTimeout(80);
  await send('M');await page.waitForTimeout(40);
  const beforePose=await status(),beforeCount=await count();
  await page.evaluate(()=>window.__cloudQA.pose('megaphone'));await page.waitForTimeout(50);
  const afterPose=await status(),afterCount=await count();
  assert.equal(afterPose.character,'M','Changing the pose keeps the existing glyph without new input');
  assert.ok(afterPose.age>=beforePose.age,'Changing the pose does not restart the lifetime');
  assert.equal(afterCount,beforeCount+1,'Entering the megaphone pose publishes its motion envelope once');
  assert.ok(await leftPixels()>0,'The live flight is visible in the new left margin');
  await page.waitForTimeout(300);assert.equal(await count(),afterCount,'A moving cloud never rebuilds native window shape each frame');
  await page.evaluate(()=>window.__cloudQA.pose('tea'));await page.waitForTimeout(50);
  assert.equal((await status()).character,'M','Leaving the megaphone returns the same live glyph to the hand');
  assert.equal(await count(),afterCount+1);
  assert.equal(await leftPixels(),0,'Switching back to a hand pose clears every negative-x flight pixel');
  await page.waitForTimeout(650);assert.equal(await status(),null,'Live character expires after one second');

  const previews=[];
  for(const [pose,key,cat,glasses]of [['idle','A',false,false],['idle',' ',true,true],['tea','!',false,false],['cake','9',false,false],['megaphone','?',true,false]]){
   const data=await page.evaluate(o=>window.elysiaPreview.render({...o,resolutionScale:2}),{pose,key,cat,glasses,keyAge:0});
   const png=Buffer.from(data.split(',')[1],'base64');assert.equal(png.readUInt32BE(16),pose==='megaphone'?1480:1200);assert.equal(png.readUInt32BE(20),1600);
   fs.writeFileSync(path.join(out,`${pose}-${key===' '?'space':key.replace(/[!?]/g,'symbol')}.png`),png);
   previews.push({data,label:`${pose} / ${key===' '?'␣':key}`});
  }
  await previewSheet(browser,previews,'preview-sheet.png');
  const flight=[];
  for(const age of [0,.25,.5,.75,1]){
   const data=await page.evaluate(keyAge=>window.elysiaPreview.render({pose:'megaphone',key:'A',keyAge,cat:true,time:0,resolutionScale:2}),age);
   fs.writeFileSync(path.join(out,`megaphone-flight-${age.toFixed(2)}s.png`),Buffer.from(data.split(',')[1],'base64'));
   flight.push({data,label:`喇叭 · ${age.toFixed(2)} 秒`});
  }
  await previewSheet(browser,flight,'megaphone-flight-sheet.png');

  // MediaRecorder records the existing renderer canvas in a hidden browser;
  // no screen capture, foreground activation or additional codec dependency.
  await page.evaluate(()=>{window.__cloudQA.pose('megaphone');window.__cloudQA.set({cat:true});});await page.waitForTimeout(80);
  const animation=await page.evaluate(async()=>{
   const source=document.querySelector('#pet'),canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;
   const context=canvas.getContext('2d');let drawing=true,frame;
   const paint=()=>{context.fillStyle='#fcf5f9';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(source,0,0);if(drawing)frame=requestAnimationFrame(paint);};paint();
   const stream=canvas.captureStream(30);
   const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
   if(!mime){drawing=false;cancelAnimationFrame(frame);stream.getTracks().forEach(track=>track.stop());return null;}
   const recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:3500000}),chunks=[];
   const finished=new Promise(resolve=>recorder.onstop=async()=>{
    const blob=new Blob(chunks,{type:mime}),reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob);
   });
   recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};recorder.start();
   for(const character of ['A','!',' ']){
    window.__cloudQA.key(character);await new Promise(resolve=>setTimeout(resolve,1200));
   }
   recorder.stop();const data=await finished;drawing=false;cancelAnimationFrame(frame);stream.getTracks().forEach(track=>track.stop());return data;
  });
  if(animation)fs.writeFileSync(path.join(out,'megaphone-flight.webm'),Buffer.from(animation.split(',')[1],'base64'));

  await send('Q');await page.evaluate(()=>window.__cloudQA.drag(true));await page.waitForTimeout(1100);
  assert.equal(await status(),null,'Input expires while native dragging pauses character rendering');
  assert.equal(await leftPixels(),0,'Expiry clears the left margin even while character rendering is paused');await page.evaluate(()=>window.__cloudQA.drag(false));
  await send('8');await page.waitForTimeout(50);assert.ok(await leftPixels()>0);
  await page.evaluate(()=>window.__cloudQA.set({keyDisplay:false}));await page.waitForTimeout(50);assert.equal(await status(),null);
  assert.equal(await leftPixels(),0,'Disabling key display clears the left margin');
  await send('a');assert.equal(await status(),null);await page.evaluate(()=>window.__cloudQA.set({keyDisplay:true}));
  assert.equal(await status(),null,'Enabling never restores the last typed character');
  await page.evaluate(()=>window.__cloudQA.pose('idle'));await send('Z');assert.equal((await status()).character,'Z');
  await page.screenshot({path:path.join(out,'live.png'),omitBackground:true});
  await page.evaluate(()=>{window.__cloudQA.pose('megaphone');window.__cloudQA.viewport({width:740,height:800,characterX:400,characterY:-260,characterWidth:1200,characterHeight:1600,clipped:true});});
  await send('Z');await page.waitForTimeout(80);assert.ok(await leftPixels(400)>0,'The clipped zoom source includes negative-x flight pixels');
  await page.screenshot({path:path.join(out,'clipped-zoom.png'),omitBackground:true});
  await page.waitForTimeout(1050);assert.equal(await leftPixels(400),0,'The clipped source clears expired flight pixels');
  assert.deepEqual(errors,[]);
  const report={status:'ok',durationSeconds:1,latestCharacterOnly:true,shiftCapsPunctuation:true,spaceSymbol:true,excludedKeys:true,
   poseSwitchKeepsCharacter:true,shapeOnlyOnVisibilityOrPose:true,coverage,expiresWhileDragging:true,settingsClear:true,leftMarginClears:true,clippedNegativeXVisible:true,animation:animation?'megaphone-flight.webm':null,browserErrors:errors};
  fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,coverage:Object.fromEntries(Object.entries(coverage).map(([pose,{frames,...summary}])=>[pose,summary]))}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
