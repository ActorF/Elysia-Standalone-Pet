/** @fileoverview Clean-face expressions and anatomically drawn prop poses, animated by a joint-weighted mesh. */
import { createMeshRig } from './mesh-rig.mjs';
import { harmonizePoseOutfit } from './outfit-palette.mjs';
import { ellipse, path, star } from './drawing-primitives.mjs';
const INK = '#4a203d', W = 1090, H = 1443;
const EYES = [
  { x:413,y:555,rx:49,ry:64,angle:-.19,outer:-1,crop:[321,126,467,633] },
  { x:647,y:520,rx:57,ry:67,angle:-.12,outer:1,crop:[985,125,467,634] },
];
const REPAINTED = ['angry','surprise','cry'];
const CLOSED_FACES = new Set(['sleep','squint','wink','pat','smile']);
const POSES = new Set(['tea','cake','cat']);
const NO_BLINK = new Set([...POSES,...REPAINTED,...CLOSED_FACES]);
export const RIG = Object.freeze({width:W,height:H,x:38,y:68,scale:.48,gazeX:292,gazeY:326});

function cheek(ctx,x,y,strength=.25) {
  const fill=ctx.createRadialGradient(x,y,0,x,y,37);
  fill.addColorStop(0,`rgba(231,125,156,${strength})`);fill.addColorStop(1,'rgba(231,125,156,0)');
  ellipse(ctx,x,y,37,18,fill);
}
function eyebrow(ctx,eye,emotion) {
  const y=emotion==='surprise'?-94:-86;
  const slope=emotion==='angry'?-eye.outer*18:emotion==='cry'?eye.outer*16:0;
  path(ctx,[['moveTo',-41,y-slope],['quadraticCurveTo',0,y-12,43,y+slope],['quadraticCurveTo',1,y-5,-41,y-slope]],null,0,'#ae6f91');
}
function iris(ctx,source,eye,emotion) {
  if(['star','dizzy'].includes(emotion)) {
    const fill=ctx.createLinearGradient(0,-63,0,65);
    fill.addColorStop(0,'#52658e');fill.addColorStop(.47,'#8f9edb');fill.addColorStop(1,'#dfc2f4');
    ellipse(ctx,0,1,eye.rx,eye.ry,fill);
    if(emotion==='star'){star(ctx,0,4,47,'#ffeabd');star(ctx,0,4,30,'#fff9e4');}
    if(emotion==='dizzy') {
      const points=[];
      for(let i=0;i<=90;i++){const a=i/90*Math.PI*5,r=3+i/90*42;points.push([i?'lineTo':'moveTo',Math.cos(a)*r,Math.sin(a)*r]);}
      path(ctx,points,'#59416f',6);
    } else {ellipse(ctx,-22,-32,7,6,'#fffafeee');ellipse(ctx,22,38,4,4,'#fff8ffdd');}
  } else {
    // A separate transparent iris retains the reference bands without importing
    // the original eyelid, lash or skin pixels into a new expression.
    const shrink=emotion==='surprise'?.81:1;
    ctx.drawImage(source,...eye.crop,-eye.rx*shrink,-eye.ry*shrink,eye.rx*2*shrink,eye.ry*2*shrink);
  }
}
function openEye(ctx,source,eye,emotion) {
  ctx.save();ctx.translate(eye.x,eye.y);ctx.rotate(eye.angle);
  const rx=eye.rx+5,ry=eye.ry,angry=emotion==='angry',narrow=emotion==='squint';
  const slant=angry?-eye.outer*18:0,top=narrow?-8:-ry+(angry?23:2),bottom=narrow?14:ry;
  ctx.beginPath();ctx.moveTo(-rx,top+18-slant);
  ctx.bezierCurveTo(-rx+10,top-13-slant,rx-13,top-18+slant,rx,top+15+slant);
  ctx.bezierCurveTo(rx+1,bottom-6,rx-8,bottom+5,1,bottom+5);
  ctx.bezierCurveTo(-rx+9,bottom+5,-rx-1,bottom-7,-rx,top+18-slant);
  ctx.closePath();ctx.fillStyle='#fff7f5';ctx.fill();
  ctx.save();ctx.clip();iris(ctx,source,eye,emotion);ctx.restore();
  // Filled, tapered lashes match the original ink weight rather than a thin geometric line.
  path(ctx,[['moveTo',-rx-4,top+21-slant],['bezierCurveTo',-rx+2,top-22-slant,rx-7,top-29+slant,rx+7,top+20+slant],['bezierCurveTo',rx-9,top-9+slant,-rx+12,top-6-slant,-rx-4,top+21-slant],['closePath']],null,0,INK);
  const ox=eye.outer*(rx-1),oy=top+4+eye.outer*slant;
  path(ctx,[['moveTo',ox,oy+10],['quadraticCurveTo',ox+eye.outer*20,oy+13,ox+eye.outer*24,oy-9],['quadraticCurveTo',ox+eye.outer*10,oy+1,ox,oy-2],['closePath']],null,0,INK);
  if(!narrow)path(ctx,[['moveTo',-rx+16,bottom-2],['quadraticCurveTo',0,bottom+11,rx-12,bottom-4]],'#c187a4',2.5);
  if(['angry','cry','surprise','awkward'].includes(emotion))eyebrow(ctx,eye,emotion);
  if(emotion==='cry') {
    const x=eye.outer*(rx-12),y=bottom-7;
    path(ctx,[['moveTo',x-11,y-4],['quadraticCurveTo',x+2,y+11,x+12,y-2],['bezierCurveTo',x+17,y+39,x+17,y+56,x+3,y+57],['bezierCurveTo',x-12,y+55,x-10,y+26,x-11,y-4],['closePath']],'#91b5d4',2,'#c3e4f4df');
    path(ctx,[['moveTo',x-2,y+12],['quadraticCurveTo',x+3,y+27,x+1,y+42]],'#fff8ffcc',3.5);
  }
  ctx.restore();
}
function mouth(ctx,kind) {
  ctx.save();ctx.translate(536,636);ctx.rotate(-.15);
  if(['smile','pat','wink','heart','star'].includes(kind)) {
    path(ctx,[['moveTo',-29,-9],['quadraticCurveTo',0,-5,31,-13],['quadraticCurveTo',33,26,4,28],['quadraticCurveTo',-20,24,-29,-9],['closePath']],'#a14955',3.5,'#e9949d');
    path(ctx,[['moveTo',-13,18],['quadraticCurveTo',2,4,20,16],['quadraticCurveTo',13,27,1,25]],null,0,'#fbb7b6');
  } else if(kind==='surprise')ellipse(ctx,0,5,15,23,'#d78b98','#a75667',3.5);
  else if(kind==='sleep')ellipse(ctx,0,6,8,5,'#d48d9f','#b87387',3);
  else if(kind==='angry'||kind==='cry')path(ctx,[['moveTo',-22,10],['quadraticCurveTo',0,-10,24,9]],'#a65e75',4);
  else if(kind==='dizzy')path(ctx,[['moveTo',-24,9],['quadraticCurveTo',-10,-2,0,9],['quadraticCurveTo',11,20,24,7]],'#aa637b',4);
  else if(kind==='awkward')path(ctx,[['moveTo',-18,-8],['lineTo',20,-8],['lineTo',18,16],['lineTo',-17,16],['closePath']],'#9c5e75',3.5,'#fff7ef');
  else path(ctx,[['moveTo',-23,2],['quadraticCurveTo',0,20,24,0]],'#b86e80',4);
  ctx.restore();
}
function glasses(ctx) {
  for(const eye of EYES) {
    ctx.save();ctx.translate(eye.x,eye.y);ctx.rotate(eye.angle);
    ellipse(ctx,0,0,eye.rx+21,eye.ry+16,'#f7dcff0b','#80576f',4);
    path(ctx,[['moveTo',eye.outer*(eye.rx+20),-15],['lineTo',eye.outer*(eye.rx+43),-30]],'#80576f',4);ctx.restore();
  }
  path(ctx,[['moveTo',484,543],['quadraticCurveTo',527,516,570,520]],'#80576f',4);
}
function expressionFace(ctx,source,expression) {
  for(const eye of EYES) {
    if(expression==='awkward') {
      ctx.save();ctx.translate(eye.x,eye.y);ctx.rotate(eye.angle);
      path(ctx,[['moveTo',-43,-8],['lineTo',42,-10],['lineTo',34,24],['lineTo',-34,25],['closePath']],INK,6,'#fffbf4');
      eyebrow(ctx,eye,'cry');ctx.restore();
    } else openEye(ctx,source,eye,expression);
  }
  mouth(ctx,expression);
  const blush=['blush','pat','heart'].includes(expression)?.43:.14;
  cheek(ctx,398,643,blush);cheek(ctx,659,614,blush);
  if(expression==='glasses')glasses(ctx);
  if(expression==='awkward')path(ctx,[['moveTo',744,474],['bezierCurveTo',731,494,721,514,736,519],['bezierCurveTo',754,523,754,503,744,474]],'#91b5d4',2,'#c3e4f4');
}
function facePatch(ctx,image,includeMouth=true,side='both',protectHorn=false) {
  // Expressions share the exact neutral body. Import the complete expression face
  // so brows, lid creases and eye corners stay coherent with its artwork.
  // The lower notch preserves the active mouth during an automatic blink.
  const patch=document.createElement('canvas');patch.width=W;patch.height=H;
  const mask=document.createElement('canvas');mask.width=W;mask.height=H;
  const mc=mask.getContext('2d');mc.shadowColor='#fff';mc.shadowBlur=12;
  const lowerFace=includeMouth
    ? [['quadraticCurveTo',716,641,623,664],['quadraticCurveTo',513,702,380,654],['quadraticCurveTo',330,644,307,619]]
    : [['quadraticCurveTo',716,633,623,600],['quadraticCurveTo',551,574,484,600],['quadraticCurveTo',400,663,307,619]];
  path(mc,[['moveTo',304,366],['quadraticCurveTo',541,319,779,347],['lineTo',790,588],...lowerFace,['closePath']],null,0,'#fff');
  if(side==='right')mc.clearRect(0,0,530,H);
  if(protectHorn) {
    // The megaphone overlaps the left cheek. Keep its foreground silhouette
    // while replacing both of the old angular eyes with the shared artwork.
    mc.shadowBlur=0;mc.globalCompositeOperation='destination-out';
    path(mc,[['moveTo',0,450],['lineTo',149,470],['lineTo',320,572],['lineTo',369,606],['quadraticCurveTo',398,614,400,670],['lineTo',420,820],['lineTo',0,820],['closePath']],null,0,'#fff');
    // This pose's open shouting mouth sits higher than the neutral smile.
    mc.clearRect(480,578,120,107);
  }
  const pc=patch.getContext('2d');pc.drawImage(image,0,0,W,H);
  pc.globalCompositeOperation='destination-in';pc.drawImage(mask,0,0);
  ctx.drawImage(patch,0,0);
}
function heartDetails(ctx,image) {
  // Keep the neutral artwork as the base. Only the two small pupil interiors
  // and the mouth receive painted pixels; the original eyelids, lashes, iris
  // edges, highlights and surrounding face remain exactly the same.
  const patch=document.createElement('canvas');patch.width=W;patch.height=H;
  const mask=document.createElement('canvas');mask.width=W;mask.height=H;
  const mc=mask.getContext('2d');
  for(const [x,y,rx,ry] of [[414,565,29,30],[648,526,30,30],[537,634,49,38]]) {
    mc.save();mc.translate(x,y);mc.scale(rx,ry);
    const fill=mc.createRadialGradient(0,0,.84,0,0,1);
    fill.addColorStop(0,'#fff');fill.addColorStop(1,'#ffffff00');
    mc.fillStyle=fill;mc.beginPath();mc.arc(0,0,1,0,Math.PI*2);mc.fill();mc.restore();
  }
  const pc=patch.getContext('2d');pc.drawImage(image,0,0,W,H);
  pc.globalCompositeOperation='destination-in';pc.drawImage(mask,0,0);
  ctx.drawImage(patch,0,0);
}
function makeFrame(images,expression,blink,horn) {
  const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext('2d');
  const image=horn?images.megaphone:POSES.has(expression)?images[expression]:images.neutral;
  const originalFace=['glasses','blush','heart',null].includes(expression);
  const paintedFace=REPAINTED.includes(expression)||CLOSED_FACES.has(expression);
  const customFace=!horn&&!POSES.has(expression)&&!paintedFace&&!originalFace;
  ctx.drawImage(image,0,0,W,H);
  if(horn)facePatch(ctx,images.closed,false,'both',true);
  if(!horn&&!POSES.has(expression)) {
    if(CLOSED_FACES.has(expression))facePatch(ctx,images.closed,expression!=='wink',expression==='wink'?'right':'both');
    else if(paintedFace)facePatch(ctx,images[expression]);
    if(customFace){facePatch(ctx,images.clean);expressionFace(ctx,images.iris,expression);}
    if(expression==='heart')heartDetails(ctx,images.heart);
    if(blink)facePatch(ctx,images.closed,false);
    if(expression==='glasses')glasses(ctx);
    if(expression==='blush'){cheek(ctx,398,643,.46);cheek(ctx,659,614,.46);}
  }
  if(expression==='sleep'&&!horn){ctx.fillStyle='#9c7caa';ctx.font='italic 34px Georgia';ctx.fillText('z',940,280);ctx.font='italic 46px Georgia';ctx.fillText('Z',987,235);}
  return canvas;
}
/** Loads the shared body, repaired faces and independent prop poses. */
export async function loadCharacter() {
  const images={};
  await Promise.all(Object.entries({neutral:'neutral',clean:'face-clean',tea:'tea',cake:'cake',cat:'cat',megaphone:'megaphone'}).map(async([key,name])=>{
    const image=new Image();image.src=new URL(`../assets/v3/character-${name}.png`,import.meta.url).href;await image.decode();images[key]=image;
  }));
  await Promise.all([...REPAINTED,'closed'].map(async name=>{
    const version=['cry','closed'].includes(name)?'v6':'v4';
    const image=new Image();image.src=new URL(`../assets/${version}/character-${name}.png`,import.meta.url).href;await image.decode();images[name]=image;
  }));
  images.iris=new Image();images.iris.src=new URL('../assets/v3/iris-pair.png',import.meta.url).href;await images.iris.decode();
  images.heart=new Image();images.heart.src=new URL('../assets/v5/character-heart.png',import.meta.url).href;await images.heart.decode();
  const normalize=image=>{const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;canvas.getContext('2d').drawImage(image,0,0,W,H);return canvas;};
  const neutral=normalize(images.neutral);
  for(const id of [...POSES,'megaphone'])images[id]=harmonizePoseOutfit(normalize(images[id]),neutral);
  const mesh=createMeshRig();
  return {images,mesh,cache:new Map(),normal:mesh,megaphone:mesh};
}
/** Caches expression drawings and animates joints continuously without cursor-dependent hair displacement. */
export function drawCharacter(ctx,rigs,state,settings={}) {
  const blink=state.blink>.72&&!state.megaphone&&!NO_BLINK.has(state.expression);
  const key=`${state.megaphone?'horn':state.expression??'neutral'}:${blink?'blink':'open'}`;
  if(!rigs.cache.has(key))rigs.cache.set(key,makeFrame(rigs.images,state.expression,blink,state.megaphone));
  const source=rigs.cache.get(key);
  const gaze=!state.megaphone&&!blink&&!['sleep','smile','pat','wink','awkward','dizzy','star','squint'].includes(state.expression);
  const frame=rigs.mesh.draw(source,key,state,settings,gaze);
  ctx.clearRect(0,0,600,800);
  ctx.save();ctx.translate(RIG.x,RIG.y+(settings.hairMotion===false?0:Math.sin(state.time*.92)*1.1));ctx.scale(RIG.scale,RIG.scale);
  ctx.drawImage(frame,0,0,W,H);
  ctx.restore();
}
