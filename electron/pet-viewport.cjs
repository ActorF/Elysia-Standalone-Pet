'use strict';

// Character geometry is virtual. Only its visible desktop intersection becomes
// a native window, so growing a pet never allocates a pet-sized GPU surface.
const { sanitizeSettings } = require('./host-policy.cjs');
const { sanitizePacket } = require('./window-shape.cjs');
const MAX_NATIVE_EXTENT = 8192;
const CHARACTER_WIDTH = 600, CHARACTER_HEIGHT = 800, EFFECT_LEFT_PADDING = 140;
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
  // Reserve the effects area continuously. Typing never moves or resizes the
  // window; the character's original virtual bounds remain the drag/zoom anchor.
  const padding=character.width*(EFFECT_LEFT_PADDING/CHARACTER_WIDTH);
  const drawing={...character,x:character.x-padding,width:character.width+padding};
  const desktop=desktopArea(displays,drawing);
  const clipped=drawing.width>desktop.width||drawing.height>desktop.height
    ||drawing.width>MAX_NATIVE_EXTENT||drawing.height>MAX_NATIVE_EXTENT;
  let native;
  if(!clipped){
    const x=Math.floor(drawing.x),y=Math.floor(drawing.y);
    native={x,y,width:Math.max(1,Math.ceil(drawing.width+(drawing.x-x))),height:Math.max(1,Math.ceil(drawing.height+(drawing.y-y)))};
  }
  else {
    const overlap=intersection(drawing,desktop);
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
/** Only the established character coordinate system and its fixed left extension are accepted. */
function sanitizeCharacterRegion(value) {
  if(!value||value.height!==CHARACTER_HEIGHT)return null;
  const legacy=value.width===CHARACTER_WIDTH
    &&(value.originX===undefined||value.originX===0)
    &&(value.referenceWidth===undefined||value.referenceWidth===CHARACTER_WIDTH);
  const extended=value.width===CHARACTER_WIDTH+EFFECT_LEFT_PADDING
    &&value.originX===-EFFECT_LEFT_PADDING&&value.referenceWidth===CHARACTER_WIDTH;
  if(!legacy&&!extended)return null;
  const clean=sanitizePacket(value);
  if(!clean)return null;
  // Extended packets contain positive rectangle coordinates. Restore the
  // logical negative x only during projection, after bounds validation.
  return extended?{...clean,originX:-EFFECT_LEFT_PADDING,referenceWidth:CHARACTER_WIDTH}:clean;
}
function projectHitRegion(region,viewport) {
  const sx=Math.min(viewport.characterWidth/(region.referenceWidth??region.width),viewport.characterHeight/region.height),sy=sx,rects=[];
  const originX=region.originX??0;
  for(const rect of region.rects){
    const x=Math.max(0,viewport.characterX+(rect.x+originX)*sx),y=Math.max(0,viewport.characterY+rect.y*sy);
    const right=Math.min(viewport.width,viewport.characterX+(rect.x+originX+rect.width)*sx);
    const bottom=Math.min(viewport.height,viewport.characterY+(rect.y+rect.height)*sy);
    if(right>x&&bottom>y)rects.push({x,y,width:right-x,height:bottom-y});
  }
  // Electron's empty region removes the shape and blocks the whole rectangle.
  // An offscreen character instead leaves only one transparent native pixel.
  if(!rects.length)rects.push({x:0,y:0,width:1,height:1});
  return {width:viewport.width,height:viewport.height,rects};
}

module.exports={MAX_NATIVE_EXTENT,intersection,desktopArea,virtualBounds,planViewport,viewportSnapshot,zoomAt,zoomFromSteps,sanitizeCharacterRegion,projectHitRegion};
