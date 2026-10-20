/** Checks actual GPU pixels, not just the CPU motion sampler. */
const {createServer}=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const destination=path.join(root,'artifacts','motion-v7');
const server=createServer((request,response)=>{
  const filename=path.resolve(root,'.'+decodeURIComponent(new URL(request.url,'http://localhost').pathname));
  if(!filename.startsWith(root+path.sep)){response.end('<!doctype html><html><body></body></html>');return;}
  try{response.setHeader('Content-Type',filename.endsWith('.mjs')?'text/javascript':filename.endsWith('.png')?'image/png':'text/html');response.end(fs.readFileSync(filename));}
  catch{response.writeHead(404).end();}
});
(async()=>{
  fs.mkdirSync(destination,{recursive:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:720}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const result=await page.evaluate(async()=>{
      const {createMeshRig,deformPoint}=await import('/renderer/mesh-rig.mjs');
      const {loadCharacter,composeCharacterFrame}=await import('/renderer/faithful-character.mjs');
      const rigs=await loadCharacter();
      const result={poses:{},travel:{},frames:[],poseFrames:{}};
      for(const [pose,cat] of [['idle',false],['idle',true],['megaphone',false],['tea',false],['cake',false]]){
        const source=composeCharacterFrame(rigs.images,{pose,cat,glasses:false,expression:null},false);
        const rig=createMeshRig(),capture=document.createElement('canvas');capture.width=1090;capture.height=1443;
        const context=capture.getContext('2d',{willReadFrequently:true});let first=null,maxEarDifference=0,maxCatDifference=0,maxPropDifference=0,changedHairPixels=0;
        for(let i=0;i<16;i++){
          const frame=rig.draw(source,cat?'cat':'neutral',{time:i*.46,gaze:{x:0,y:0},cat,pose},{eyeTracking:false,hairMotion:true},false);
          context.clearRect(0,0,1090,1443);context.drawImage(frame,0,0);
          const pixels=context.getImageData(0,0,1090,1443).data;
          if(!first)first=pixels;
          for(let y=428;y<=480;y++)for(let x=919;x<968-(y-428)*1.1;x++)for(let channel=0;channel<4;channel++){
            const p=(y*1090+x)*4+channel;maxEarDifference=Math.max(maxEarDifference,Math.abs(pixels[p]-first[p]));
          }
          if(cat)for(const [sx,sy,ex,ey] of [[210,130,280,220],[800,100,860,210]])for(let y=sy;y<ey;y++)for(let x=sx;x<ex;x++)for(let channel=0;channel<4;channel++){
            const p=(y*1090+x)*4+channel;maxCatDifference=Math.max(maxCatDifference,Math.abs(pixels[p]-first[p]));
          }
          const propBoxes={megaphone:[[40,540,180,700],[180,580,350,690],[290,720,365,800]],tea:[[520,652,610,782],[612,720,660,775]],cake:[[326,726,452,786],[551,638,605,680],[600,672,660,691]]};
          for(const [sx,sy,ex,ey] of propBoxes[pose]??[])for(let y=sy;y<ey;y++)for(let x=sx;x<ex;x++)for(let channel=0;channel<4;channel++){
            const p=(y*1090+x)*4+channel;maxPropDifference=Math.max(maxPropDifference,Math.abs(pixels[p]-first[p]));
          }
          for(const [sx,sy,ex,ey] of [[350,340,410,430],[740,380,800,560],[440,395,550,470]])for(let y=sy;y<ey;y+=2)for(let x=sx;x<ex;x+=2){
            const p=(y*1090+x)*4;if(Math.abs(pixels[p]-first[p])+Math.abs(pixels[p+1]-first[p+1])+Math.abs(pixels[p+2]-first[p+2])>25)changedHairPixels++;
          }
          if(i===4)result.poseFrames[cat?'cat':pose]=frame.toDataURL();
          if(!cat&&pose==='idle'&&[0,4,8,12].includes(i))result.frames.push(frame.toDataURL());
        }
        result.poses[cat?'cat':pose]={accelerated:rig.accelerated,maxEarDifference,maxCatDifference,maxPropDifference,changedHairPixels};
      }
      for(const [name,x,y] of [['left inner lock',365,400],['right inner lock',780,550],['fringe',500,475],['left face-adjacent hair',330,460],['right face-adjacent hair',750,500],['skirt',420,1060],['left leg',534,1357],['right leg',663,1300]]){
        const samples=Array.from({length:241},(_,i)=>deformPoint(x,y,i/30)[0]);result.travel[name]=Number(((Math.max(...samples)-Math.min(...samples))*.336).toFixed(2));
      }
      return result;
    });
    for(const [id,pose] of Object.entries(result.poses)){
      assert.equal(pose.accelerated,true);assert.equal(pose.maxEarDifference,0,`${id}: elf ear pixels must stay fixed`);
      assert.equal(pose.maxPropDifference,0,`${id}: foreground prop pixels must stay fixed`);
      assert.equal(pose.maxCatDifference,0,`${id}: cat ear pixels must stay fixed`);assert.ok(pose.changedHairPixels>10000,`${id}: inner hair must visibly animate`);
    }
    assert.deepEqual(errors,[]);
    for(const [i,data] of result.frames.entries())fs.writeFileSync(path.join(destination,`frame-${i}.png`),Buffer.from(data.split(',')[1],'base64'));
    await page.setContent(`<html><body style="margin:0;background:#f5edf3;font:14px sans-serif;color:#603e54"><h2 style="padding:0 24px">实际 GPU 渲染 · 刘海、内侧发束、衣摆和腿缓慢摆动 · 耳朵固定</h2><main style="display:flex">${result.frames.map((url,i)=>`<figure style="margin:0;width:25%;text-align:center"><img style="width:100%" src="${url}"><figcaption>${(i*1.84).toFixed(2)} s</figcaption></figure>`).join('')}</main></body></html>`);
    await page.screenshot({path:path.join(destination,'contact.png'),fullPage:true});
    for(const [name,data] of Object.entries(result.poseFrames))fs.writeFileSync(path.join(destination,`${name}-peak.png`),Buffer.from(data.split(',')[1],'base64'));
    delete result.poseFrames;delete result.frames;result.browserErrors=errors;
    fs.writeFileSync(path.join(destination,'report.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
