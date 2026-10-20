/** Audits actual composed pixels across independent pose, skin and expression combinations. */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {createServer}=require('node:http'); const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),destination=path.join(root,'artifacts','face-integrity');
const server=createServer((req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}const f=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(!f.startsWith(root+path.sep))throw Error('outside root');res.setHeader('Content-Type',({'.html':'text/html','.mjs':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(f)]||'text/plain');res.end(fs.readFileSync(f));}catch{res.writeHead(404).end();}});
(async()=>{
 fs.mkdirSync(destination,{recursive:true}); await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,channel:'msedge'});
 try{
  const page=await browser.newPage({viewport:{width:600,height:800}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}/renderer/index.html`);await page.waitForSelector('html[data-ready="true"]');
  const result=await page.evaluate(async()=>{
   const {loadCharacter,composeCharacterFrame,drawCharacter}=await import('/renderer/faithful-character.mjs');
   const {createPetState,EXPRESSIONS,POSES}=await import('/renderer/state.mjs');
   const rig=await loadCharacter(), W=1090,H=1443,checks=[],pngs={},combinations=[];
   const make=()=>{const c=document.createElement('canvas');c.width=W;c.height=H;return c;};
   const rgba=c=>c.getContext('2d').getImageData(0,0,W,H).data;
   const normal=image=>{const c=make();c.getContext('2d').drawImage(image,0,0,W,H);return c;};
   const check=(name,passed,details={})=>checks.push({name,passed,...details});
   function compare(a,b,rect=[0,0,W,H],tolerance=0){const [x,y,w,h]=rect;let changed=0,max=0;for(let py=y;py<y+h;py++)for(let px=x;px<x+w;px++){let d=0,i=(py*W+px)*4;for(let c=0;c<4;c++)d=Math.max(d,Math.abs(a[i+c]-b[i+c]));if(d>tolerance)changed++;max=Math.max(max,d);}return {changed,max,rectangle:rect,tolerance};}
   const frame=(state={},blink=false)=>composeCharacterFrame(rig.images,{...createPetState(),...state},blink);
   const props={tea:[[533,624,8,10],[554,700,49,50]],cake:[[564,652,28,17],[335,748,80,30]],megaphone:[[70,565,70,100],[235,620,70,65],[321,753,23,35]],idle:[]};
   for(const {id:pose} of POSES)for(const cat of [false,true])for(const glasses of [false,true]){
    const base=rgba(frame({pose,cat,glasses}));
    for(const expression of [null,...EXPRESSIONS.map(e=>e.id)]){
     const source=frame({pose,cat,glasses,expression}),data=rgba(source),label=`${pose}/${cat?'cat':'human'}/${glasses?'glasses':'bare'}/${expression||'neutral'}`;
     const body=compare(base,data,[0,710,W,H-710]);check(`${label}: body unchanged by expression`,body.changed===0,body);
     for(const rect of props[pose]){const diff=compare(base,data,rect,1);check(`${label}: foreground prop survives`,diff.changed===0,diff);}
     if(cat){const ears=[[195,90,100,175],[780,60,100,200]].map(rect=>compare(base,data,rect,1));check(`${label}: both cat ears stay enabled`,ears.every(ear=>ear.changed===0),{ears});}
     if(expression&&['sleep','angry','dizzy'].includes(expression)&&!cat&&!glasses)pngs[`${pose}-${expression}.png`]=source.toDataURL();
     combinations.push(label);
    }
   }
   check('all 176 face / pose / skin combinations are covered',combinations.length===176,{count:combinations.length});
   const hornPlain=rgba(frame({pose:'megaphone'})),hornGlasses=rgba(frame({pose:'megaphone',glasses:true}));
   const hornOverlap=compare(hornPlain,hornGlasses,[360,615,20,15],1);check('glasses stay behind the megaphone rear cone',hornOverlap.changed===0,hornOverlap);
   const closed=rgba(normal(rig.images.closed)),sleep=rgba(normal(rig.images.sleep));
   const eyes={left:[370,495,94,88],right:[580,465,117,106]};
   for(const [id,options,blink,sides,expected] of [
    ['sleep',{expression:'sleep'},false,['left','right'],sleep],
    ['smile',{expression:'smile'},false,['left','right'],closed],
    ['wink',{expression:'wink'},false,['right'],closed],
    ['automatic blink',{},true,['left','right'],closed],
    ['megaphone default',{pose:'megaphone'},false,['left','right'],closed],
   ])for(const side of sides){const diff=compare(expected,rgba(frame(options,blink)),eyes[side],4);check(`${id}: approved artwork in ${side} eye`,diff.changed===0,diff);}
   for(const id of ['sleep','angry','dizzy']){
    const expected=rgba(normal(rig.images[id])),actual=rgba(frame({expression:id}));
    for(const rect of [[370,495,94,88],[580,465,117,106],[503,611,69,50]]) {const diff=compare(expected,actual,rect,4);check(`${id}: reference-derived eye or mouth reaches renderer`,diff.changed===0,diff);}
   }
   const wink=rgba(frame({expression:'wink'})),neutral=rgba(frame());
   check('wink keeps original open eye',compare(wink,neutral,[315,465,170,165],1).changed===0);
   const heart=rgba(frame({expression:'heart'}));let outside=0,inside=0;
   for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4;if(![0,1,2,3].some(c=>heart[i+c]!==neutral[i+c]))continue;const allowed=[[414,565,32,33],[648,526,33,33],[537,634,52,41]].some(([cx,cy,rx,ry])=>((x+.5-cx)/rx)**2+((y+.5-cy)/ry)**2<=1);allowed?inside++:outside++;}
   check('heart edits stay inside pupils and mouth',outside===0&&inside>1000,{outside,inside});
   for(const pose of ['idle','tea','cake']){
    const a=rgba(frame({pose,expression:'heart',glasses:true})),b=rgba(frame({pose,expression:'heart',glasses:true},true));
    const diff=compare(a,b,[503,611,69,50],1);check(`${pose}: blink preserves active mouth`,diff.changed===0,diff);
   }
   const settings={hairMotion:false,eyeTracking:false};
   // Accessories are complete planes in the final renderer, outside the face
   // matte. Check their actual pixels so an omitted/clipped layer cannot pass
   // merely because expression source images remain internally consistent.
   const rendered=options=>{const state={...createPetState(),...options},source=frame(state);return rgba(rig.renderer.draw(source,JSON.stringify(options),state,settings,false));};
   for(const {id:pose} of POSES){
    const bare=rendered({pose}),withGlasses=rendered({pose,glasses:true}),withCat=rendered({pose,cat:true});
    const bridge=compare(bare,withGlasses,[490,510,80,55],2);
    check(`${pose}: complete glasses reach final canvas`,bridge.changed>150,bridge);
    const tail=compare(bare,withCat,[900,1050,180,180],2);
    check(`${pose}: outlined cat tail reaches final canvas`,tail.changed>2500,tail);
    for(const rect of props[pose]){const diff=compare(bare,withGlasses,rect,1);check(`${pose}: final prop stays in front of glasses`,diff.changed===0,diff);}
   }
   for(const id of ['sleep','angry','dizzy','wink','cry','heart','smile',null]){
    const stage=document.createElement('canvas');stage.width=600;stage.height=800;
    drawCharacter(stage.getContext('2d'),rig,{...createPetState(),expression:id},settings);pngs[`stage-${id||'default'}.png`]=stage.toDataURL();
   }
   for(const {id:pose} of POSES){const stage=document.createElement('canvas');stage.width=600;stage.height=800;drawCharacter(stage.getContext('2d'),rig,{...createPetState(),pose,cat:true,glasses:true,expression:'angry'},settings);pngs[`combined-${pose}.png`]=stage.toDataURL();}
   check('composite cache remains bounded',rig.cache.size<=12,{size:rig.cache.size});
   return {checks,pngs,combinations};
  });
  const {pngs,...report}=result;for(const [name,url]of Object.entries(pngs))fs.writeFileSync(path.join(destination,name),Buffer.from(url.split(',')[1],'base64'));
  const output={...report,browserErrors:errors,passed:report.checks.every(c=>c.passed)&&errors.length===0};fs.writeFileSync(path.join(destination,'results.json'),JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({passed:output.passed,checks:report.checks.length,combinations:report.combinations.length,failed:report.checks.filter(c=>!c.passed),browserErrors:errors}));if(!output.passed)process.exitCode=1;
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
