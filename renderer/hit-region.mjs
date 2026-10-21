/** Cached native-window silhouette. No live-frame reads or moving-window work. */
import {RIG} from './faithful-character.mjs';
import {LAYERS} from './layer-motion.mjs';

const WIDTH=600,HEIGHT=800,CELL_SIZE=4;
const regions=new WeakMap();
const layerById=new Map(LAYERS.map(layer=>[layer.id,layer]));

/** Quantize alpha conservatively, retaining holes and the empty window margins. */
export function alphaToOccupancy(rgba,width,height,{cellSize=2,threshold=4,padding=1}={}){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||
    !Number.isInteger(cellSize)||cellSize<1||!Number.isInteger(padding)||padding<0||
    !Number.isFinite(threshold)||threshold<1||threshold>255||rgba.length!==width*height*4)
  throw new RangeError('Invalid alpha mask dimensions or options');
 const columns=Math.ceil(width/cellSize),rows=Math.ceil(height/cellSize),cells=new Uint8Array(columns*rows);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  if(rgba[(y*width+x)*4+3]<threshold)continue;
  const x0=Math.max(0,Math.floor((x-padding)/cellSize)),x1=Math.min(columns-1,Math.floor((x+padding)/cellSize));
  const y0=Math.max(0,Math.floor((y-padding)/cellSize)),y1=Math.min(rows-1,Math.floor((y+padding)/cellSize));
  for(let row=y0;row<=y1;row++)for(let column=x0;column<=x1;column++)cells[row*columns+column]=1;
 }
 return {cells,columns,rows,width,height,cellSize};
}

function runsToRectangles(mask,transpose){
 const {cells,columns,rows,width,height,cellSize}=mask;
 const across=transpose?rows:columns,down=transpose?columns:rows,finished=[];
 let active=new Map();
 for(let row=0;row<down;row++){
  const next=new Map();
  for(let x=0;x<across;){
   if(!cells[transpose?x*columns+row:row*columns+x]){x++;continue;}
   const start=x;
   while(x<across&&cells[transpose?x*columns+row:row*columns+x])x++;
   const key=`${start}:${x}`,previous=active.get(key),rect=previous??{x:start,y:row,width:x-start,height:0};
   rect.height++;next.set(key,rect);active.delete(key);
  }
  finished.push(...active.values());active=next;
 }
 finished.push(...active.values());
 return finished.map(rect=>{
  const x=(transpose?rect.y:rect.x)*cellSize,y=(transpose?rect.x:rect.y)*cellSize;
  return {x,y,width:Math.min((transpose?rect.height:rect.width)*cellSize,width-x),height:Math.min((transpose?rect.width:rect.height)*cellSize,height-y)};
 });
}

/** Merge identical runs in both directions; choose the smaller exact cover. */
export function rectanglesFromOccupancy(mask){
 const horizontal=runsToRectangles(mask,false),vertical=runsToRectangles(mask,true);
 return vertical.length<horizontal.length?vertical:horizontal;
}

function drawEnvelope(ctx,atlas,state,enabled){
 ctx.save();ctx.translate(RIG.x,RIG.y);ctx.scale(RIG.scale,RIG.scale);
 for(const {image,id}of atlas.renderer.hitLayers(state)){
  if(!image)continue;
  const layer=id&&layerById.get(id),amplitude=enabled?(layer?.amplitude??0):0;
  if(!amplitude){ctx.drawImage(image,0,0);continue;}
  const [px,py]=layer.pivot;
  // Every visible point is at most 0.75 logical pixels from a sampled rotation.
  // The one-pixel dilation below closes that bound, without stretching artwork.
  const radius=Math.hypot(Math.max(px,RIG.width-px),Math.max(py,RIG.height-py));
  const intervals=Math.max(2,Math.ceil(radius*amplitude*RIG.scale/.75));
  for(let step=0;step<=intervals;step++){
   ctx.save();ctx.translate(px,py);ctx.rotate(-amplitude+2*amplitude*step/intervals);ctx.translate(-px,-py);
   ctx.drawImage(image,0,0);ctx.restore();
  }
 }
 ctx.restore();
}

function drawDecorations(ctx,images,decoration,enabled){
 if(!decoration)return;
 for(const drift of enabled?[-2,-1,0,1,2]:[0]){
  if(decoration==='dizzy'){ctx.drawImage(images.dizzyDecoration,57,6+drift,486,162);continue;}
  ctx.drawImage(images.sleepDecoration,427,8+drift,170,170);
  ctx.save();ctx.lineJoin='round';ctx.strokeStyle='#fff4f8';ctx.fillStyle='#663650';ctx.lineWidth=4;
  for(const [x,y,size]of [[78,145,30],[91,165,23],[103,181,17]]){
   ctx.font=`italic bold ${size}px Georgia`;ctx.strokeText('z',x,y+drift);ctx.fillText('z',x,y+drift);
  }
  ctx.restore();
 }
}

/**
 * Full motion envelope in the renderer's logical 600×800 coordinates.
 * The native host scales these rectangles to its content dimensions. Repeated
 * calls return the same object, so frame/position changes never need setShape.
 */
export function createCharacterHitRegion(atlas,state={},settings={}){
 let cache=regions.get(atlas);if(!cache){cache={results:new Map(),bodies:new Map(),decorations:new Map()};regions.set(atlas,cache);}
 const enabled=settings.hairMotion!==false,pose=state.pose??'idle';
 const decoration=['sleep','dizzy'].includes(state.expression)?state.expression:'';
 const bodyKey=`${pose}:${!!state.cat}:${enabled}`,key=`${bodyKey}:${decoration}`;
 if(cache.results.has(key))return cache.results.get(key);
 const start=performance.now();
 const readMask=draw=>{
  const canvas=document.createElement('canvas');canvas.width=WIDTH;canvas.height=HEIGHT;
  const ctx=canvas.getContext('2d');draw(ctx);
  // One readback per body envelope or decoration, never from the live canvas.
  return alphaToOccupancy(ctx.getImageData(0,0,WIDTH,HEIGHT).data,WIDTH,HEIGHT,{cellSize:CELL_SIZE});
 };
 let body=cache.bodies.get(bodyKey);
 if(!body){body=readMask(ctx=>drawEnvelope(ctx,atlas,state,enabled));cache.bodies.set(bodyKey,body);}
 let mask=body;
 if(decoration){
  const decorKey=`${decoration}:${enabled}`;
  let decor=cache.decorations.get(decorKey);
  if(!decor){decor=readMask(ctx=>drawDecorations(ctx,atlas.images,decoration,enabled));cache.decorations.set(decorKey,decor);}
  const cells=body.cells.slice();for(let i=0;i<cells.length;i++)cells[i]|=decor.cells[i];
  mask={...body,cells};
 }
 const rects=rectanglesFromOccupancy(mask).map(Object.freeze);
 const result=Object.freeze({width:WIDTH,height:HEIGHT,cellSize:CELL_SIZE,rects:Object.freeze(rects),buildMs:performance.now()-start});
 cache.results.set(key,result);return result;
}

/** Prepare every pose/skin silhouette while the loading screen is still shown. */
export async function prepareCharacterHitRegions(atlas,settings={}){
 for(const pose of ['idle','megaphone','cake','tea'])for(const cat of [false,true]){
  for(const expression of [null,'sleep','dizzy'])createCharacterHitRegion(atlas,{pose,cat,expression},settings);
  // Yield between independent appearances so input and loading UI remain live.
  await new Promise(resolve=>setTimeout(resolve,0));
 }
}
