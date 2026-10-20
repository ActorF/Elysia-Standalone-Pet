/** Rigid source-art cutouts. No resampling, bending, scaling or redrawing of limbs. */
const W=1090,H=1443;
const canvas=()=>{const c=document.createElement('canvas');c.width=W;c.height=H;return c;};

// Both original legs travel as one connected cutout. The hidden root continues
// under the skirt; the visible boundary follows the stocking ink, not a broad
// ellipse that would also collect the adjacent cloak, tassels or rear hair.
function legOutline(ctx){
  const points=[[408,1004],[660,1004],[657,1035],[646,1070],[632,1100],[623,1120],[643,1150],[662,1180],[677,1210],[690,1240],[697,1270],[693,1300],[671,1330],[655,1341],[636,1340],[607,1310],[580,1270],[594,1330],[591,1360],[574,1374],[538,1383],[515,1380],[501,1360],[486,1330],[472,1300],[459,1270],[448,1240],[439,1210],[430,1180],[423,1150],[417,1120],[413,1100],[408,1070],[406,1040]];
  ctx.beginPath();ctx.moveTo(...points[0]);for(const point of points.slice(1))ctx.lineTo(...point);ctx.closePath();
}

// Start in the plain bodice so a generous upper overlap can hide the pivot.
// A single connected piece carries every skirt fold and its painted outline.
function skirtOutline(ctx){
  ctx.beginPath();ctx.moveTo(427,881);ctx.lineTo(641,881);
  ctx.quadraticCurveTo(667,929,687,960);ctx.quadraticCurveTo(716,978,738,1007);
  ctx.quadraticCurveTo(758,1033,722,1052);ctx.quadraticCurveTo(700,1068,665,1064);
  ctx.lineTo(645,1050);ctx.quadraticCurveTo(616,1040,591,1058);
  ctx.quadraticCurveTo(565,1073,530,1072);ctx.quadraticCurveTo(500,1082,470,1075);
  ctx.lineTo(443,1060);ctx.quadraticCurveTo(419,1057,394,1045);
  ctx.quadraticCurveTo(362,1044,340,1027);ctx.quadraticCurveTo(319,1011,334,991);
  ctx.quadraticCurveTo(357,977,372,966);ctx.quadraticCurveTo(405,926,427,881);
  ctx.closePath();
}

function mask(outline){const c=canvas(),ctx=c.getContext('2d');ctx.fillStyle='#fff';outline(ctx);ctx.fill();return c;}
function cut(source,selection){const c=canvas(),ctx=c.getContext('2d');ctx.drawImage(source,0,0,W,H);ctx.globalCompositeOperation='destination-in';ctx.drawImage(selection,0,0);return c;}
function padded(selection,radius=2){const c=canvas(),ctx=c.getContext('2d');for(let y=-radius;y<=radius;y++)for(let x=-radius;x<=radius;x++)if(x*x+y*y<=radius*radius)ctx.drawImage(selection,x,y);return c;}

function preciseMask(source,coarse,kind){
  const sample=canvas(),ctx=sample.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0,W,H);
  const pixels=ctx.getImageData(0,0,W,H).data,limit=coarse.getContext('2d').getImageData(0,0,W,H).data;
  const bounds=kind==='legs'?[395,995,735,1400]:[320,875,760,1085];
  const [x0,y0,x1,y1]=bounds,sw=x1-x0,sh=y1-y0,eligible=new Uint8Array(sw*sh);
  const inside=(x,y,points)=>{let result=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const[a,b]=points[j],[c,d]=points[i];if((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a)result=!result;}return result;};
  const frills=[[[450,900],[450,960],[427,1005],[419,1046],[366,1048],[365,1008]],[[525,900],[560,920],[562,980],[586,1028],[574,1050],[531,1045],[520,985]]];
  const hemLimit=new Uint16Array(W);hemLimit.fill(H);
  if(kind==='skirt')for(let x=x0;x<x1;x++)for(let y=995;y<1085;y++){
    const p=(y*W+x)*4,r=pixels[p],g=pixels[p+1],b=pixels[p+2];
    if(pixels[p+3]>100&&r>180&&g>150&&r-g>13&&g-b>9){hemLimit[x]=y;break;}
  }
  if(kind==='skirt')for(let x=420;x<650;x++)if(hemLimit[x]===H){const nearby=[];for(let dx=-7;dx<=7;dx++)if(hemLimit[x+dx]<H)nearby.push(hemLimit[x+dx]);if(nearby.length)hemLimit[x]=Math.min(...nearby)+3;}
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
    const p=(y*W+x)*4,r=pixels[p],g=pixels[p+1],b=pixels[p+2];
    if(limit[p+3]<1||pixels[p+3]<1)continue;
    if(kind==='skirt'&&y>=hemLimit[x])continue;
    // Pink rear-hair wedges and cream shawl are outside these two materials.
    const dark=r<185&&g<175&&b<195&&b>=g-4&&g-r<24&&b-r<80;
    const thigh=kind==='legs'&&y<1100&&r>175&&g>150&&b>135&&r-b<100;
    const whiteFrill=kind==='skirt'&&r>155&&g>150&&b>155&&Math.max(r,g,b)-Math.min(r,g,b)<45&&frills.some(poly=>inside(x,y,poly));
    if(dark||thigh||whiteFrill)eligible[(y-y0)*sw+x-x0]=1;
  }
  const queue=new Int32Array(sw*sh),visited=new Uint8Array(sw*sh);
  const [sx,sy]=kind==='legs'?[540,1200]:[510,950];let start=(sy-y0)*sw+sx-x0,head=0,tail=1;queue[0]=start;visited[start]=1;
  while(head<tail){const i=queue[head++],x=i%sw;for(const j of [x?i-1:-1,x<sw-1?i+1:-1,i-sw,i+sw])if(j>=0&&j<eligible.length&&eligible[j]&&!visited[j]){visited[j]=1;queue[tail++]=j;}}
  const result=canvas(),rc=result.getContext('2d'),image=rc.createImageData(sw,sh);
  for(let i=0;i<visited.length;i++)if(visited[i]){image.data[i*4]=255;image.data[i*4+1]=255;image.data[i*4+2]=255;image.data[i*4+3]=255;}
  rc.putImageData(image,x0,y0);return result;
}

/**
 * Source-sized layers in their original coordinates. Draw legs, then skirt,
 * then body: the body's retained upper-bodice overlap conceals the skirt root.
 * Its cloak and tassels also stay in front of the moving legs where appropriate.
 */
export function splitBodyLayers(source,colorSource=source){
  const legMask=padded(preciseMask(source,mask(legOutline),'legs'),3),skirtMask=padded(preciseMask(source,mask(skirtOutline),'skirt'),2);
  const legs=cut(source,legMask),skirt=cut(source,skirtMask),body=canvas(),underlay=canvas();
  const lc=legs.getContext('2d');lc.globalCompositeOperation='destination-out';lc.drawImage(skirtMask,0,0);
  // Reconstruct the hidden thigh roots behind the separately moving skirt.
  // Original visible skin, stocking shading and outlines remain the source art.
  lc.globalCompositeOperation='destination-over';lc.fillStyle='#fff0e5';
  lc.beginPath();lc.moveTo(409,1003);lc.lineTo(654,1003);lc.lineTo(629,1093);
  lc.quadraticCurveTo(565,1046,502,1072);lc.quadraticCurveTo(459,1099,413,1081);lc.closePath();lc.fill();
  lc.globalCompositeOperation='source-over';
  const bc=body.getContext('2d');bc.drawImage(source,0,0,W,H);
  bc.globalCompositeOperation='destination-out';bc.drawImage(legMask,0,0);
  // Removing only below this horizontal overlap keeps the root covered by the
  // original opaque bodice. The lower clothing itself is never drawn twice.
  const removedSkirt=canvas(),rc=removedSkirt.getContext('2d');
  rc.drawImage(skirtMask,0,0);rc.clearRect(0,0,W,935);bc.drawImage(removedSkirt,0,0);
  // Hidden cloth continuation cover the few pixels revealed by
  // an outward hem swing; these are behind both moving cutouts and the body.
  const sc=canvas().getContext('2d',{willReadFrequently:true});sc.drawImage(colorSource,0,0,W,H);
  const color=(x,y,fallback)=>{const p=sc.getImageData(x,y,1,1).data;return p[3]>200?`rgb(${p[0]},${p[1]},${p[2]})`:fallback;};
  const uc=underlay.getContext('2d');uc.fillStyle=color(363,1084,'#eddbc8');
  uc.beginPath();uc.moveTo(342,980);uc.lineTo(424,955);uc.lineTo(416,1070);uc.lineTo(355,1032);uc.closePath();uc.fill();
  return {body,legs,skirt,underlay};
}
