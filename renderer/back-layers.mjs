/** Source-art body matte with one continuous, independently rotating rear-hair plane. */
const W=1090,H=1443;
const canvas=()=>{const c=document.createElement('canvas');c.width=W;c.height=H;return c;};
const isInk=(r,g,b)=>(r<95&&g<42&&b<100)||(r<150&&g<100&&b<145&&r-g>=24&&b-g>=16);
const skirtGuard=[[600,875],[645,875],[673,932],[690,960],[721,983],[745,1008],[751,1034],[722,1055],[692,1068],[647,1068],[600,1090]];
function inside(x,y,points){let hit=false;for(let i=0,j=points.length-1;i<points.length;j=i++){
  const[a,b]=points[j],[c,d]=points[i];if((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a)hit=!hit;
}return hit;}

function inRearRegion(x,y){
  // The upper bob is owned by the head rig. These broad material-search regions
  // cover only the long locks behind the sleeves, skirt and legs.
  return (y>=680&&y<1235&&x>=625)||(y>=1035&&y<1355&&x>=165&&x<=460);
}

function rearMask(source){
  const sample=canvas(),ctx=sample.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(source,0,0,W,H);
  const rgba=ctx.getImageData(0,0,W,H).data,n=W*H;
  const weak=new Uint8Array(n),strong=new Uint8Array(n),pink=new Uint8Array(n),seen=new Uint8Array(n),queue=new Int32Array(n);
  for(let y=680;y<1355;y++)for(let x=165;x<W;x++){
    if(!inRearRegion(x,y))continue;
    const i=y*W+x,p=i*4,r=rgba[p],g=rgba[p+1],b=rgba[p+2];
    if(rgba[p+3]<12||r<120||r-g<16||b-g<6||r-b<3)continue;
    weak[i]=1;
    if(r-g>=33&&b-g>=17&&r-b>=8)strong[i]=1;
  }
  // A pale lavender shawl stripe can resemble a hair highlight. It cannot join
  // a strong-pink hair component through the intervening dark ink boundary.
  for(let start=680*W;start<1355*W;start++){
    if(!weak[start]||seen[start])continue;
    let head=0,tail=1,seeds=0;queue[0]=start;seen[start]=1;
    while(head<tail){const i=queue[head++],x=i%W;seeds+=strong[i];
      for(const j of [x?i-1:-1,x<W-1?i+1:-1,i-W,i+W])if(j>=0&&j<n&&weak[j]&&!seen[j]){seen[j]=1;queue[tail++]=j;}
    }
    if(tail>=180&&seeds>=80)for(let j=0;j<tail;j++)pink[queue[j]]=1;
  }

  // Extend through the ink belonging to those locks, while leaving the shared
  // foreground garment/hand outlines on the body. The broad outline search is
  // bounded to thirty-six pixels, enough to include thin pointed hair tips.
  const selected=pink.slice(),distance=new Uint8Array(n);distance.fill(255);
  let head=0,tail=0;
  for(let i=680*W;i<1355*W;i++)if(pink[i]){distance[i]=0;queue[tail++]=i;}
  while(head<tail){const i=queue[head++],x=i%W;if(distance[i]>=36)continue;
    for(const j of [x?i-1:-1,x<W-1?i+1:-1,i-W,i+W]){
      if(j<0||j>=n||distance[j]!==255)continue;
      const y=Math.floor(j/W),xx=j%W,p=j*4,r=rgba[p],g=rgba[p+1],b=rgba[p+2];
      if(!inRearRegion(xx,y)||rgba[p+3]<3||!isInk(r,g,b)||inside(xx,y,skirtGuard))continue;
      distance[j]=distance[i]+1;queue[tail++]=j;selected[j]=1;
    }
  }
  // Preserve the garment side of a shared contour. This is a binary ownership
  // decision made once at load, not an animation weight or a mesh deformation.
  for(let y=680;y<1355;y++)for(let x=165;x<W;x++){
    const i=y*W+x;if(!selected[i]||pink[i])continue;
    let clothing=false;
    for(let dy=-3;dy<=3&&!clothing;dy++)for(let dx=-3;dx<=3;dx++){
      const xx=x+dx,yy=y+dy;if(xx<0||xx>=W||yy<680||yy>=H)continue;
      const j=yy*W+xx,p=j*4;
      const r=rgba[p],g=rgba[p+1],b=rgba[p+2],plumInk=isInk(r,g,b);
      if(rgba[p+3]>220&&!pink[j]&&!plumInk){clothing=true;break;}
    }
    if(clothing)selected[i]=0;
  }
  // The source carries a few nearly transparent fringe pixels beyond its ink.
  // Move those with the same lock instead of leaving a stationary ghost edge.
  const opaqueSelection=selected.slice();
  for(let y=680;y<1355;y++)for(let x=165;x<W;x++){
    const i=y*W+x,a=rgba[i*4+3];if(selected[i]||a===0||a>=180||!inRearRegion(x,y))continue;
    let adjacent=false;for(let dy=-3;dy<=3&&!adjacent;dy++)for(let dx=-3;dx<=3;dx++){
      const xx=x+dx,yy=y+dy;if(xx>=0&&xx<W&&yy>=680&&yy<1355&&opaqueSelection[yy*W+xx]){adjacent=true;break;}
    }
    if(adjacent)selected[i]=1;
  }
  const mask=canvas(),mc=mask.getContext('2d'),pixels=mc.createImageData(W,H);
  for(let i=0;i<n;i++)if(selected[i]){const p=i*4;pixels.data[p]=pixels.data[p+1]=pixels.data[p+2]=pixels.data[p+3]=255;}
  mc.putImageData(pixels,0,0);
  return {mask,rgba,selected};
}

/** Draw backHair first, then the body and its independently split skirt/legs. */
export function splitBackLayers(source,images={}){
  const {mask}=rearMask(source),body=canvas(),backHair=canvas();
  const bodyContext=body.getContext('2d'),hairContext=backHair.getContext('2d');
  bodyContext.drawImage(source,0,0,W,H);bodyContext.globalCompositeOperation='destination-out';bodyContext.drawImage(mask,0,0);
  bodyContext.globalCompositeOperation='source-over';

  if(images.backHair){
    // This is a complete painted layer, including the hair hidden beneath the
    // clothes. Do not clip it to the old body silhouette: such a stencil exposes
    // disconnected rectangular scraps as soon as the layer rotates. One static
    // registration aligns its outer curl extents to the source illustration.
    hairContext.drawImage(images.backHair,24,48,W*.92,H*.93);
  }else{
    // A source-only fallback is useful for inspection before the complete asset
    // has loaded. It never alters the source foreground matte.
    hairContext.drawImage(source,0,0,W,H);
    hairContext.globalCompositeOperation='destination-in';hairContext.drawImage(mask,0,0);
    hairContext.globalCompositeOperation='source-over';
  }
  return {body,backHair,mask};
}
