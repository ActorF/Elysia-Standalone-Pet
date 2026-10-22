// Run only under the isolated --smoke-test profile. Never inject global input.
'use strict';
const assert=require('node:assert/strict');
const {restoreBounds,recoverBounds}=require('./host-policy.cjs');
const {planViewport}=require('./pet-viewport.cjs');
function checkDesktopWindow({window,pointer,topmost,place,displays,shape,getState}){
 const characterBounds=()=>{
  const view=getState().viewport;
  return {x:view.x+view.characterX,y:view.y+view.characterY,width:view.characterWidth,height:view.characterHeight};
 };
 const original=characterBounds(),wasTopmost=topmost.enabled,area=displays[0].bounds;
 const center={x:area.x+Math.round(area.width/2),y:area.y+Math.round(area.height/2)};
 const positions={
  top:{x:center.x,y:area.y-original.height+55},
  bottom:{x:center.x,y:area.y+area.height-55},
  left:{x:area.x-original.width+55,y:center.y},
  right:{x:area.x+area.width-55,y:center.y},
 };
 const actual={},nativePositions={};
 try{
  assert.equal(window.isVisible(),false,'Desktop smoke must remain hidden');
  assert.equal(shape.status.applied,true,'Character silhouette is installed on the native window');
  assert.ok(shape.status.rectangles>1&&shape.status.rectangles<400,'Hit region follows the character contour');
  topmost.setEnabled(false);assert.equal(window.isAlwaysOnTop(),false);
  topmost.setEnabled(true);assert.equal(window.isAlwaysOnTop(),true);
  topmost.refresh();assert.equal(window.isVisible(),false,'Topmost must not show a hidden window');
  for(const [id,position]of Object.entries(positions)){
   place(original);
   const start={x:original.x+100,y:original.y+100};
   const end={x:start.x+position.x-original.x,y:start.y+position.y-original.y};
   pointer.startDrag(start);pointer.sample(end);pointer.endDrag(end);
   const bounds=characterBounds();actual[id]=bounds;nativePositions[id]=window.getBounds();
   assert.equal(bounds.x,position.x,`${id}: character drag x is not clamped`);
   assert.equal(bounds.y,position.y,`${id}: character drag y is not clamped`);
   const expected=planViewport(bounds,displays).native;
   assert.ok(Math.abs(nativePositions[id].x-expected.x)<=2&&Math.abs(nativePositions[id].y-expected.y)<=2,`${id}: native drawing bounds include the fixed effects margin`);
   assert.deepEqual(restoreBounds(bounds,displays),bounds,`${id}: restart preserves edge placement`);
  }
  // Fractional Windows DPI must never feed rounded native dimensions back into
  // the next move. Exercise real setBounds repeatedly, within one monitor.
  place({x:area.x+150,y:area.y+150});
  const shapeUpdatesBefore=shape.status.nativeUpdates;
  const sizes=[],start={x:area.x+250,y:area.y+250};
  pointer.startDrag(start);
  for(let i=0;i<120;i++){
   pointer.sample({x:start.x+i%41,y:start.y+i%37});
   const {width,height}=window.getContentBounds();sizes.push({width,height});
  }
  pointer.endDrag({x:start.x+119%41,y:start.y+119%37});
  const sizeRange=Object.fromEntries(['width','height'].map(key=>[key,{min:Math.min(...sizes.map(size=>size[key])),max:Math.max(...sizes.map(size=>size[key]))}]));
  for(const key of ['width','height'])assert.ok(sizeRange[key].max-sizeRange[key].min<=2,`${key}: native drag must not accumulate DPI rounding`);
  assert.equal(shape.status.nativeUpdates,shapeUpdatesBefore,'Ordinary dragging must reuse the installed native shape');
  let mixedDpiSteps=0;
  for(const display of displays.slice(1)){
   if(Math.abs(display.scaleFactor-displays[0].scaleFactor)<.01)continue;
   const other=display.bounds;
   const a={x:center.x-original.width/2,y:center.y-original.height/2};
   const b={x:other.x+(other.width-original.width)/2,y:other.y+(other.height-original.height)/2};
   for(let step=0;step<=100;step++){
    const fraction=step<=50?step/50:(100-step)/50;
    const target={x:Math.round(a.x+(b.x-a.x)*fraction),y:Math.round(a.y+(b.y-a.y)*fraction)};
    place(target);const actual=characterBounds(),native=window.getBounds(),expected=planViewport(actual,displays).native;mixedDpiSteps++;
    assert.ok(Math.abs(actual.x-target.x)<=2&&Math.abs(actual.y-target.y)<=2,'Mixed-DPI crossing retains the intended character position');
    assert.ok(Math.abs(native.x-expected.x)<=2&&Math.abs(native.y-expected.y)<=2,'Mixed-DPI native drawing bounds retain the effects margin');
   }
  }
  place(actual.right);
  const recovered=recoverBounds(characterBounds(),displays);place(recovered);
  const bounds=characterBounds();assert.equal(bounds.x,recovered.x);assert.equal(bounds.y,recovered.y);
  assert.equal(window.isVisible(),false);
  return {nativeEdgePositions:nativePositions,characterEdgePositions:actual,nativeDragSteps:120,contentSizeRange:sizeRange,mixedDpiSteps,hitRegion:shape.status,shapeStableDuringDrag:true,partialRestore:true,recovery:true,topmostToggle:true,hiddenThroughout:true,syntheticGlobalInput:false};
 }finally{pointer.reset();place(original);topmost.setEnabled(wasTopmost);}
}
module.exports={checkDesktopWindow};
