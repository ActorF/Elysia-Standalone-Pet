'use strict';

// Character geometry is virtual. Only its visible desktop intersection becomes
// a native window, so growing a pet never allocates a pet-sized GPU surface.
const { sanitizeSettings } = require('./host-policy.cjs');
const MAX_NATIVE_EXTENT = 8192;
const finite = value => Number.isFinite(value);
const valid = box => box && ['x','y','width','height'].every(key => finite(box[key])) && box.width > 0 && box.height > 0;
const area = box => box.width * box.height;
function intersection(a,b) {
  const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);
  const right=Math.min(a.x+a.width,b.x+b.width),bottom=Math.min(a.y+a.height,b.y+b.height);
  return {x,y,width:Math.max(0,right-x),height:Math.max(0,bottom-y)};
}
function desktopArea(displays, reference) {
  const boxes=displays.map(display=>display.bounds??display.workArea??display).filter(valid);
  if(!boxes.length)return {x:0,y:0,width:1920,height:1080};
  const x=Math.min(...boxes.map(box=>box.x)),y=Math.min(...boxes.map(box=>box.y));
  const width=Math.max(...boxes.map(box=>box.x+box.width))-x,height=Math.max(...boxes.map(box=>box.y+box.height))-y;
  if(width<=MAX_NATIVE_EXTENT&&height<=MAX_NATIVE_EXTENT)return {x,y,width,height};
  // Very widely separated monitors must not produce a gigantic empty window.
  // Use the monitor containing most of the visible pet in that rare layout.
  boxes.sort((a,b)=>area(intersection(reference,b))-area(intersection(reference,a)));
  const selected=boxes[0];
  return {...selected,width:Math.min(selected.width,MAX_NATIVE_EXTENT),height:Math.min(selected.height,MAX_NATIVE_EXTENT)};
}
function virtualBounds(position,scale) {
  return {width:420*scale,height:560*scale,x:finite(position?.x)?position.x:0,y:finite(position?.y)?position.y:0};
}
function planViewport(character,displays=[]) {
  const desktop=desktopArea(displays,character);
  const clipped=character.width>desktop.width||character.height>desktop.height
    ||character.width>MAX_NATIVE_EXTENT||character.height>MAX_NATIVE_EXTENT;
  let native;
  if(!clipped)native={x:Math.round(character.x),y:Math.round(character.y),width:Math.max(1,Math.ceil(character.width)),height:Math.max(1,Math.ceil(character.height))};
  else {
    const overlap=intersection(character,desktop);
    if(overlap.width&&overlap.height){
      const x=Math.floor(overlap.x),y=Math.floor(overlap.y);
      native={x,y,width:Math.max(1,Math.ceil(overlap.x+overlap.width)-x),height:Math.max(1,Math.ceil(overlap.y+overlap.height)-y)};
    }else native={x:desktop.x-2,y:desktop.y-2,width:1,height:1};
  }
  return {native,clipped};
}
function viewportSnapshot(character,native,clipped) {
  return {x:native.x,y:native.y,width:native.width,height:native.height,
    characterX:character.x-native.x,characterY:character.y-native.y,
    characterWidth:character.width,characterHeight:character.height,scale:character.width/420,clipped};
}
function zoomAt(character,currentScale,nextScale,anchor) {
  const scale=sanitizeSettings({scale:nextScale},{scale:currentScale}).scale;
  const size=virtualBounds({},scale);
  const point=anchor&&finite(anchor.x)&&finite(anchor.y)?anchor:{x:character.x+character.width/2,y:character.y+character.height/2};
  const fx=(point.x-character.x)/character.width,fy=(point.y-character.y)/character.height;
  return {scale,bounds:{...size,x:point.x-size.width*fx,y:point.y-size.height*fy}};
}
function zoomFromSteps(character,currentScale,steps,anchor) {
  if(!finite(steps))return {scale:currentScale,bounds:character};
  // Clamp only a single malformed event, not the cumulative requested scale.
  const candidate=currentScale*Math.exp(Math.max(-100,Math.min(100,steps))*Math.log(1.1));
  const next=finite(candidate)?candidate:Number.MAX_VALUE/2**20;
  return zoomAt(character,currentScale,next,anchor);
}
function projectHitRegion(region,viewport) {
  const sx=Math.min(viewport.characterWidth/region.width,viewport.characterHeight/region.height),sy=sx,rects=[];
  for(const rect of region.rects){
    const x=Math.max(0,viewport.characterX+rect.x*sx),y=Math.max(0,viewport.characterY+rect.y*sy);
    const right=Math.min(viewport.width,viewport.characterX+(rect.x+rect.width)*sx);
    const bottom=Math.min(viewport.height,viewport.characterY+(rect.y+rect.height)*sy);
    if(right>x&&bottom>y)rects.push({x,y,width:right-x,height:bottom-y});
  }
  // Electron's empty region removes the shape and blocks the whole rectangle.
  // An offscreen character instead leaves only one transparent native pixel.
  if(!rects.length)rects.push({x:0,y:0,width:1,height:1});
  return {width:viewport.width,height:viewport.height,rects};
}

module.exports={MAX_NATIVE_EXTENT,intersection,desktopArea,virtualBounds,planViewport,viewportSnapshot,zoomAt,zoomFromSteps,projectHitRegion};
