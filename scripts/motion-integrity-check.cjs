/** Audits production layer draw matrices and raster widths; also records checkerboard motion. */
'use strict';
const {createServer}=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),destination=path.join(root,'artifacts','motion-v8');
const server=createServer((req,res)=>{try{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+path.sep))throw Error('outside root');res.setHeader('Content-Type',file.endsWith('.mjs')?'text/javascript':file.endsWith('.png')?'image/png':'text/html');res.end(fs.readFileSync(file));}catch{res.end('<!doctype html><html><body></body></html>');}});
(async()=>{
 fs.mkdirSync(destination,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:800}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result=await page.evaluate(async()=>{
   const {loadCharacter,composeCharacterFrame}=await import('/renderer/faithful-character.mjs');
   const {layerTransform}=await import('/renderer/layer-motion.mjs');const rigs=await loadCharacter(),W=1090,H=1443,checks=[],frames={},poses={};
   const canvas=()=>{const c=document.createElement('canvas');c.width=W;c.height=H;return c;};
   const check=(name,passed,details={})=>checks.push({name,passed,...details});
   check('production renderer uses separate rigid layers',rigs.renderer.mode==='rigid-layers',{mode:rigs.renderer.mode});
   const drawImage=CanvasRenderingContext2D.prototype.drawImage;let active=null,observed={};
   CanvasRenderingContext2D.prototype.drawImage=function(image,...args){if(active)for(const[id,layer]of Object.entries(active))if(image===layer){const m=this.getTransform();observed[id]={a:m.a,b:m.b,c:m.c,d:m.d,e:m.e,f:m.f};}return drawImage.call(this,image,...args);};
   try{
    for(const pose of ['idle','megaphone','tea','cake']){
     const state={pose,cat:true,glasses:true,expression:null,time:0,gaze:{x:0,y:0}},key=`audit-${pose}`,source=composeCharacterFrame(rigs.images,state),layers=rigs.renderer.layers(source,key,state);
     let maxMatrixError=0,maxStaticError=0,maxEarDifference=0,first=null;const widths={upper:[],lower:[]},capture=canvas(),cc=capture.getContext('2d',{willReadFrequently:true});
     for(let i=0;i<17;i++){
      state.time=i*7.6/16;active={frontHair:layers.frontHair,backHair:layers.backHair,legs:layers.legs,skirt:layers.skirt,ears:layers.ears,foreground:layers.foreground};observed={};
      const frame=rigs.renderer.draw(source,key,state,{hairMotion:true,eyeTracking:false},false);active=null;
      for(const id of ['frontHair','backHair','legs','skirt']){const expected=layerTransform(id,state.time),actual=observed[id];if(!actual){maxMatrixError=Infinity;continue;}for(const channel of ['a','b','c','d','e','f'])maxMatrixError=Math.max(maxMatrixError,Math.abs(actual[channel]-expected[channel]));}
      for(const id of ['ears','foreground'])for(const[channel,value]of Object.entries({a:1,b:0,c:0,d:1,e:0,f:0}))maxStaticError=Math.max(maxStaticError,Math.abs((observed[id]?.[channel]??Infinity)-value));
      cc.clearRect(0,0,W,H);cc.drawImage(frame,0,0);const pixels=cc.getImageData(0,0,W,H).data;if(!first)first=pixels;
      for(let y=446;y<455;y++)for(let x=938;x<947;x++)for(let channel=0;channel<4;channel++){const p=(y*W+x)*4+channel;maxEarDifference=Math.max(maxEarDifference,Math.abs(pixels[p]-first[p]));}
      if([0,4,12].includes(i))frames[`${pose}-${i}.png`]=frame.toDataURL();
      // Render the exact production leg canvas with its observed production
      // matrix, then measure each cross-section in the leg's rotating axes.
      cc.clearRect(0,0,W,H);const m=observed.legs;cc.setTransform(m.a,m.b,m.c,m.d,m.e,m.f);cc.drawImage(layers.legs,0,0);cc.resetTransform();const legPixels=cc.getImageData(0,0,W,H).data;
      for(const[label,y]of [['upper',1200],['lower',1280]]){let lo=Infinity,hi=-Infinity;for(let x=390;x<735;x+=.5){const tx=Math.round(m.a*x+m.c*y+m.e),ty=Math.round(m.b*x+m.d*y+m.f);if(legPixels[(ty*W+tx)*4+3]>128){lo=Math.min(lo,x);hi=Math.max(hi,x);}}widths[label].push(hi-lo);}
     }
     const drift=Object.fromEntries(Object.entries(widths).map(([id,values])=>[id,Math.max(...values)-Math.min(...values)]));
     // Chromium's Canvas stores matrix coefficients as floats internally.
     check(`${pose}: actual canvas draws use one rigid transform per part`,maxMatrixError<1e-5,{maxMatrixError,canvasFloatTolerance:1e-5});
     check(`${pose}: actual ears and props are in the fixed plane`,maxStaticError===0,{maxStaticError});
     check(`${pose}: raster leg cross-sections keep their width`,Object.values(drift).every(n=>n<=3),{sourcePixelWidthDrift:drift});
     check(`${pose}: elf-ear interior pixels remain fixed`,maxEarDifference<=1,{maxEarDifference,premultipliedAlphaTolerance:1});poses[pose]={maxMatrixError,maxStaticError,sourcePixelWidthDrift:drift,maxEarDifference};
    }
   }finally{active=null;CanvasRenderingContext2D.prototype.drawImage=drawImage;}
   const state={pose:'idle',cat:true,glasses:true,expression:null,time:0,gaze:{x:0,y:0}},source=composeCharacterFrame(rigs.images,state),stage=document.createElement('canvas');stage.width=840;stage.height=1120;const ctx=stage.getContext('2d');document.body.append(stage);
   function videoFrame(time){state.time=time;for(let y=0;y<1120;y+=32)for(let x=0;x<840;x+=32){ctx.fillStyle=(x+y)%64===0?'#eceae5':'#fff';ctx.fillRect(x,y,32,32);}const frame=rigs.renderer.draw(source,'video-audit',state,{hairMotion:true,eyeTracking:false},false);ctx.drawImage(frame,50,45,740,980);}
   videoFrame(0);const chunks=[],stream=stage.captureStream(30),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9'});
   recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};const stopped=new Promise(r=>recorder.onstop=r);recorder.start();let frame=0;
   await new Promise(resolve=>{const timer=setInterval(()=>{videoFrame(frame++/30);if(frame>228){clearInterval(timer);resolve();}},1000/30);});recorder.stop();await stopped;stream.getTracks().forEach(track=>track.stop());
   const video=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(new Blob(chunks,{type:'video/webm'}));});
   return {checks,poses,frames,video};
  });
  for(const[name,data]of Object.entries(result.frames))fs.writeFileSync(path.join(destination,name),Buffer.from(data.split(',')[1],'base64'));
  fs.writeFileSync(path.join(destination,'rigid-idle.webm'),Buffer.from(result.video.split(',')[1],'base64'));
  const makeSheet=async(pose)=>{const images=[0,4,12].map(i=>result.frames[`${pose}-${i}.png`]);await page.setContent(`<html><body style="margin:0;background:#e6e3df;font:18px sans-serif"><main style="display:flex">${images.map((url,i)=>`<figure style="margin:0;width:33.333%;background:repeating-conic-gradient(#f8f7f4 0% 25%,#deddd8 0% 50%) 0 0/32px 32px"><figcaption style="padding:12px;background:#e6e3df">${pose} / ${[0,1.9,5.7][i]} s</figcaption><img style="width:100%" src="${url}"></figure>`).join('')}</main></body></html>`);await page.screenshot({path:path.join(destination,`${pose}-peaks.png`),fullPage:true});};
  for(const pose of ['idle','megaphone','tea','cake'])await makeSheet(pose);
  const report={checks:result.checks,poses:result.poses,browserErrors:errors,video:'rigid-idle.webm',visualReviewRequired:true,passed:result.checks.every(c=>c.passed)&&errors.length===0};fs.writeFileSync(path.join(destination,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));assert.ok(report.passed,'Motion audit failed; see artifacts/motion-v8/report.json');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
