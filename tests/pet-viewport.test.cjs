'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planViewport,viewportSnapshot,virtualBounds,zoomAt,zoomFromSteps,projectHitRegion,MAX_NATIVE_EXTENT}=require('../electron/pet-viewport.cjs');
const {restoreBounds}=require('../electron/host-policy.cjs');
const {createDesktopPointer}=require('../electron/desktop-pointer.cjs');
const displays=[{bounds:{x:-1920,y:0,width:1920,height:1080}},{bounds:{x:0,y:0,width:1920,height:1080}}];
test('ordinary sizing and negative-coordinate placements keep the existing full window',()=>{
  for(const scale of [.01,.5,1,1.6]){
    const character=virtualBounds({x:-111,y:-140},scale),result=planViewport(character,displays);
    assert.equal(result.clipped,false);assert.deepEqual(result.native,{...character,width:Math.ceil(character.width),height:Math.ceil(character.height)});
    const view=viewportSnapshot(character,result.native,false);
    assert.equal(view.characterX,0);assert.equal(view.characterY,0);
  }
});
test('extreme scales allocate only the visible desktop, with no native pet-sized surface',()=>{
  for(const scale of [10,100,1000,1e6,1e20,1e100]){
    const size=virtualBounds({x:0,y:0},scale),character={...size,x:-size.width/2,y:-size.height/2};
    const result=planViewport(character,displays);
    assert.equal(result.clipped,true);
    assert.deepEqual(result.native,{x:-1920,y:0,width:3840,height:1080});
    const view=viewportSnapshot(character,result.native,true);
    assert.equal(view.characterWidth,size.width);assert.equal(view.characterHeight,size.height);
    assert.ok(view.width<=MAX_NATIVE_EXTENT&&view.height<=MAX_NATIVE_EXTENT);
  }
});
test('a huge pet can be freely moved completely off all monitors without a blocking window',()=>{
  for(const position of [{x:1e9,y:1e9},{x:-1e9,y:-1e9}]){
    const result=planViewport(virtualBounds(position,100),displays);
    assert.equal(result.native.width,1);assert.equal(result.native.height,1);
    assert.equal(result.native.x,-1922);assert.equal(result.native.y,-2);
  }
});
test('zoom preserves the character point underneath the mouse across viewport clipping',()=>{
  const original=virtualBounds({x:-100,y:50},1),anchor={x:80,y:270};
  for(const scale of [.01,2,10,10000]){
    const next=zoomAt(original,1,scale,anchor);
    const u=(anchor.x-original.x)/original.width,v=(anchor.y-original.y)/original.height;
    assert.ok(Math.abs((anchor.x-next.bounds.x)/next.bounds.width-u)<1e-12);
    assert.ok(Math.abs((anchor.y-next.bounds.y)/next.bounds.height-v)<1e-12);
  }
});
test('rapid relative wheel increments accumulate against host state instead of stale renderer settings',()=>{
  let scale=1,bounds=virtualBounds({x:0,y:0},scale);
  for(let i=0;i<80;i++)({scale,bounds}=zoomFromSteps(bounds,scale,1,{x:210,y:280}));
  assert.ok(Math.abs(scale/1.1**80-1)<1e-12);
  for(let i=0;i<80;i++)({scale,bounds}=zoomFromSteps(bounds,scale,-1,{x:210,y:280}));
  assert.ok(Math.abs(scale-1)<1e-12);
  assert.equal(zoomFromSteps(bounds,scale,NaN).scale,scale);
  assert.equal(zoomAt(bounds,scale,-10).scale,.01);
});
test('distant display layouts never allocate the intervening empty span',()=>{
  const sparse=[{bounds:{x:0,y:0,width:1920,height:1080}},{bounds:{x:20000,y:0,width:1920,height:1080}}];
  const plan=planViewport(virtualBounds({x:18000,y:-100},100),sparse);
  assert.equal(plan.native.x,20000);assert.ok(plan.native.width<=1920);
});
test('virtual restart preserves an extreme zoom anchor beyond native coordinate range',()=>{
  const size=virtualBounds({},1e12),bounds={...size,x:-size.width/2,y:-size.height/2};
  assert.deepEqual(restoreBounds(bounds,displays,value=>value),bounds);
  assert.deepEqual(planViewport(bounds,displays),planViewport(restoreBounds(bounds,displays,value=>value),displays));
});
test('native hit projection clips only visible character coverage and never clears the whole window',()=>{
  const region={width:600,height:800,rects:[{x:100,y:100,width:100,height:100}]};
  const viewport={width:100,height:80,characterX:-120,characterY:-140,characterWidth:1200,characterHeight:1600};
  assert.deepEqual(projectHitRegion(region,viewport),{width:100,height:80,rects:[{x:80,y:60,width:20,height:20}]});
  const empty=projectHitRegion(region,{...viewport,characterX:-10000});
  assert.deepEqual(empty.rects,[{x:0,y:0,width:1,height:1}]);
});
test('native dragging moves virtual content even when its desktop viewport remains stationary',()=>{
  let bounds=virtualBounds({x:-21000000000,y:-28000000000},1e8);
  const original={...bounds},before=planViewport(bounds,displays);
  const pointer=createDesktopPointer({readCursor:()=>({x:100,y:100}),getBounds:()=>bounds,
    setPosition:(x,y)=>{bounds={...bounds,x,y};},sendPointer:()=>{},constrainBounds:value=>value});
  pointer.startDrag({x:100,y:100});pointer.sample({x:160,y:170});pointer.endDrag({x:160,y:170});
  assert.equal(bounds.x,original.x+60);assert.equal(bounds.y,original.y+70);
  assert.deepEqual(planViewport(bounds,displays).native,before.native);
});
