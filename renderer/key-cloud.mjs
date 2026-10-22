/** One transient printable keystroke in a hand-drawn cloud above the raised hand. */
const INK='#713352';
export const KEY_CLOUD=Object.freeze({x:422,y:354,holdSeconds:.7,fadeSeconds:.3});
// The character remains 600×800; only the transparent effect canvas extends left.
export const KEY_EFFECT_BOUNDS=Object.freeze({left:140,width:740,height:800});
const MEGAPHONE_ORIGIN=Object.freeze({x:52,y:357});

/** The cloud starts astride the horn rim, then travels left and slightly upward. */
export function keyCloudFrame(display,pose='idle'){
  const age=Math.max(0,Number.isFinite(display?.age)?display.age:0);
  const duration=KEY_CLOUD.holdSeconds+KEY_CLOUD.fadeSeconds;
  const progress=Math.min(1,age/duration);
  if(pose==='megaphone'){
    const travel=1-(1-progress)**2;
    return {x:MEGAPHONE_ORIGIN.x-56*travel*4/3,y:MEGAPHONE_ORIGIN.y-10*travel*4/3,scale:.8,opacity:1-progress,progress};
  }
  return {x:KEY_CLOUD.x,y:KEY_CLOUD.y,scale:1,
    opacity:Math.max(0,Math.min(display?.opacity??1,(duration-age)/KEY_CLOUD.fadeSeconds)),progress};
}

/** Only a single letter, digit, punctuation mark or ordinary space can be shown. */
export function isDisplayCharacter(value){
  return typeof value==='string'&&([...value].length===1)&&(/^[\x20-\x7e]$/.test(value)||/^\p{P}$/u.test(value));
}

/** Keep the latest character only; no input history survives a clear or timeout. */
export function createKeyDisplay(){
  let character=null,receivedAt=0;
  return {
    receive(value,now){
      if(!isDisplayCharacter(value)||!Number.isFinite(now))return false;
      character=value;receivedAt=now;return true;
    },
    clear(){character=null;receivedAt=0;},
    snapshot(now){
      if(character===null)return null;
      const age=Math.max(0,(now-receivedAt)/1000),duration=KEY_CLOUD.holdSeconds+KEY_CLOUD.fadeSeconds;
      if(age>=duration){character=null;receivedAt=0;return null;}
      return {character,age,opacity:Math.min(1,(duration-age)/KEY_CLOUD.fadeSeconds)};
    },
  };
}

function outline(ctx){
  ctx.beginPath();ctx.moveTo(-41,-7);
  ctx.bezierCurveTo(-51,-27,-29,-44,-17,-35);
  ctx.bezierCurveTo(-7,-53,20,-50,26,-33);
  ctx.bezierCurveTo(47,-38,58,-14,44,0);
  ctx.bezierCurveTo(56,17,41,37,25,33);
  ctx.bezierCurveTo(20,51,-7,52,-17,36);
  ctx.bezierCurveTo(-35,45,-51,28,-42,14);
  ctx.bezierCurveTo(-54,9,-53,-3,-41,-7);ctx.closePath();
}

/** Illustrated sound waves only; both arcs travel outward with the emitted character. */
function drawSoundWaves(ctx,progress,silhouette){
  ctx.save();ctx.translate(MEGAPHONE_ORIGIN.x,MEGAPHONE_ORIGIN.y);ctx.scale(4/3,4/3);ctx.translate(-90,-364);
  ctx.lineCap='round';ctx.lineJoin='round';
  for(const radius of [40+12*progress,58+14*progress]){
    ctx.beginPath();ctx.arc(88,365,radius,Math.PI+.15-.55,Math.PI+.15+.55);
    ctx.strokeStyle=silhouette?'#fff':'#fff8fc';ctx.lineWidth=5;ctx.stroke();
    if(!silhouette){ctx.strokeStyle=INK;ctx.lineWidth=2.5;ctx.stroke();}
  }
  ctx.restore();
}

/** Vector artwork stays crisp as the desktop pet is resized, without changing its source art. */
export function drawKeyCloud(ctx,display,{silhouette=false,pose='idle'}={}){
  if(!display||!isDisplayCharacter(display.character))return;
  const frame=keyCloudFrame(display,pose);
  if(!silhouette&&frame.opacity<=0)return;
  ctx.save();ctx.globalAlpha=silhouette?1:frame.opacity;
  if(pose==='megaphone')drawSoundWaves(ctx,frame.progress,silhouette);
  ctx.translate(frame.x,frame.y);ctx.scale(frame.scale,frame.scale);
  ctx.lineJoin='round';ctx.lineCap='round';
  outline(ctx);
  const fill=ctx.createLinearGradient(0,-45,0,46);
  fill.addColorStop(0,'#fffefe');fill.addColorStop(.65,'#fff9fc');fill.addColorStop(1,'#fbe8f2');
  ctx.fillStyle=silhouette?'#fff':fill;ctx.fill();
  ctx.strokeStyle=silhouette?'#fff':INK;ctx.lineWidth=2.5;ctx.stroke();
  if(!silhouette){
    ctx.beginPath();ctx.moveTo(-35,24);ctx.bezierCurveTo(-30,32,-23,33,-16,29);
    ctx.bezierCurveTo(-6,45,15,44,21,28);ctx.bezierCurveTo(31,33,41,25,42,18);
    ctx.strokeStyle='#ebc5d9';ctx.lineWidth=2.1;ctx.stroke();
    ctx.beginPath();ctx.moveTo(-36,-16);ctx.bezierCurveTo(-36,-25,-28,-30,-22,-27);
    ctx.strokeStyle='#fff';ctx.lineWidth=3.2;ctx.stroke();
    ctx.beginPath();ctx.moveTo(-5,-36);ctx.bezierCurveTo(3,-41,15,-37,18,-30);ctx.stroke();
  }
  if(!silhouette){
    const value=display.character;
    ctx.strokeStyle='#854162';ctx.fillStyle='#a34d7c';ctx.lineWidth=.65;
    if(value===' '){
      // Draw the open-box space symbol explicitly so it never becomes a missing-font square.
      ctx.beginPath();ctx.moveTo(-15,-1);ctx.lineTo(-15,9);ctx.quadraticCurveTo(-15,12,-12,12);
      ctx.lineTo(12,12);ctx.quadraticCurveTo(15,12,15,9);ctx.lineTo(15,-1);ctx.lineWidth=3.6;ctx.stroke();
    }else{
      ctx.font='bold 39px "Comic Sans MS", "Microsoft YaHei", sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.strokeText(value,0,1);ctx.fillText(value,0,1);
    }
  }
  ctx.restore();
}
