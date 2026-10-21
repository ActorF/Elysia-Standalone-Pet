'use strict';
const fs=require('node:fs'),path=require('node:path'),{createServer}=require('node:http'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const server=createServer((req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><body></body>');return;}const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(!file.startsWith(root+path.sep))throw Error('outside');res.setHeader('Content-Type',({'.mjs':'text/javascript','.png':'image/png'})[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
 const page=await browser.newPage({viewport:{width:600,height:800}});await page.goto(`http://127.0.0.1:${server.address().port}/`);
 page.on('console',message=>{if(message.type()==='log')console.log(message.text());});
 const result=await page.evaluate(async()=>{
  const {loadCharacter,drawCharacter}=await import('/renderer/faithful-character.mjs');
  const {createCharacterHitRegion,prepareCharacterHitRegions}=await import('/renderer/hit-region.mjs');
  const {createPetState,EXPRESSIONS}=await import('/renderer/state.mjs');
  const atlas=await loadCharacter(),state=createPetState(),canvas=document.createElement('canvas');canvas.width=600;canvas.height=800;
  const ctx=canvas.getContext('2d',{willReadFrequently:true}),results=[];
  for(const pose of ['idle','megaphone','cake','tea'])for(const cat of [false,true])for(const motion of [false,true])for(const expression of [null,...EXPRESSIONS.map(item=>item.id)]){
   const s={...state,pose,cat,expression,glasses:true},settings={hairMotion:motion,eyeTracking:true};
   const region=createCharacterHitRegion(atlas,s,settings),repeat=createCharacterHitRegion(atlas,{...s,time:99,gaze:{x:1,y:1},glasses:false},settings);
   const inside=new Uint8Array(600*800);for(const r of region.rects)for(let y=r.y;y<r.y+r.height;y++)inside.fill(1,y*600+r.x,y*600+r.x+r.width);
   let missing=0,firstMissing=null,maxAlpha=0;
   for(let phase=0;phase<(motion?65:1);phase++){
    s.time=phase*15.7/64;s.gaze={x:Math.sin(phase),y:Math.cos(phase)};s.blink=phase%3===0?1:0;
    drawCharacter(ctx,atlas,s,settings);const pixels=ctx.getImageData(0,0,600,800).data;
    for(let i=0;i<inside.length;i++)if(!inside[i]&&pixels[i*4+3]>=4){missing++;maxAlpha=Math.max(maxAlpha,pixels[i*4+3]);firstMissing??=[i%600,Math.floor(i/600),phase];}
   }
   const item={pose,cat,motion,expression,rectangles:region.rects.length,buildMs:region.buildMs,stable:repeat===region,missing,maxAlpha,firstMissing,area:inside.reduce((a,b)=>a+b,0)};results.push(item);if(missing)console.log(JSON.stringify(item));
  }
  const read=CanvasRenderingContext2D.prototype.getImageData;let readbacks=0;
  CanvasRenderingContext2D.prototype.getImageData=function(...args){readbacks++;return read.apply(this,args);};
  const cachedStart=performance.now();for(let i=0;i<1000;i++)createCharacterHitRegion(atlas,{pose:'tea',cat:!!(i%2),expression:i%3?'sleep':null,time:i},{hairMotion:!!(i%2)});
  const cachedCallsMs=performance.now()-cachedStart;
  await prepareCharacterHitRegions(atlas);await prepareCharacterHitRegions(atlas,{hairMotion:false});
  CanvasRenderingContext2D.prototype.getImageData=read;
  return {results,passed:results.every(r=>r.stable&&!r.missing)&&readbacks===0,frames:results.reduce((total,r)=>total+(r.motion?65:1),0),cachedReadbacks:readbacks,cachedCallsMs};
 });
 const output=path.join(root,'artifacts','hit-region-check.json');fs.mkdirSync(path.dirname(output),{recursive:true});
 fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,frames:result.frames,appearances:result.results.length,cachedReadbacks:result.cachedReadbacks,cachedCallsMs:result.cachedCallsMs,rectangles:[Math.min(...result.results.map(r=>r.rectangles)),Math.max(...result.results.map(r=>r.rectangles))]}));if(!result.passed)process.exitCode=1;
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
