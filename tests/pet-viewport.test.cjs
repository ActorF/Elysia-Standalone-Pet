'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planViewport,viewportSnapshot,virtualBounds,zoomAt,zoomFromSteps,sanitizeCharacterRegion,projectHitRegion,MAX_NATIVE_EXTENT}=require('../electron/pet-viewport.cjs');
const {restoreBounds}=require('../electron/host-policy.cjs');
const {createDesktopPointer}=require('../electron/desktop-pointer.cjs');
const displays=[{bounds:{x:-1920,y:0,width:1920,height:1080}},{bounds:{x:0,y:0,width:1920,height:1080}}];
test('ordinary sizing reserves a fixed left effects margin without changing character geometry',()=>{
  for(const scale of [.01,.5,1,1.6]){
    const character=virtualBounds({x:-111,y:-140},scale),result=planViewport(character,displays);
    const padding=character.width*140/600;
    assert.equal(result.clipped,false);
    assert.equal(result.native.x,Math.floor(character.x-padding));
    assert.ok(result.native.width>=character.width+padding);
    assert.ok(result.native.width<character.width+padding+2,'Only pixel rounding enlarges the fixed drawing margin');
    const view=viewportSnapshot(character,result.native,false);
    assert.equal(view.characterX,character.x-result.native.x);assert.equal(view.characterY,0);
    assert.equal(view.characterWidth,420*scale);assert.equal(view.characterHeight,560*scale);
    assert.equal(view.x+view.characterX,character.x);assert.equal(view.y+view.characterY,character.y);
    assert.equal(view.scale,scale);
  }
});

test('drawing margin participates in clipping even when the character itself fits the desktop',()=>{
  const monitor=[{bounds:{x:0,y:0,width:500,height:900}}];
  const character=virtualBounds({x:0,y:20},1),plan=planViewport(character,monitor);
  assert.equal(character.width,420);assert.equal(plan.clipped,true,'518-wide drawing area needs desktop clipping');
  assert.deepEqual(plan.native,{x:0,y:20,width:420,height:560});
  const visibleEffectOnly=planViewport(virtualBounds({x:510,y:20},1),monitor);
  assert.deepEqual(visibleEffectOnly.native,{x:412,y:20,width:88,height:560},'The left effect can remain visible when the character is beyond the right edge');
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

test('left effects do not change zoom anchoring or move the character when native bounds are calculated',()=>{
  const original=virtualBounds({x:500,y:100},1),before={...original};
  const initial=planViewport(original,displays),view=viewportSnapshot(original,initial.native,initial.clipped);
  const anchor={x:view.x+view.characterX+100,y:view.y+view.characterY+160};
  for(const scale of [.01,1,2,10]){
    const next=zoomAt(original,1,scale,anchor),planned=planViewport(next.bounds,displays);
    const projected=viewportSnapshot(next.bounds,planned.native,planned.clipped);
    assert.ok(Math.abs(projected.x+projected.characterX+100*scale-anchor.x)<1e-9);
    assert.ok(Math.abs(projected.y+projected.characterY+160*scale-anchor.y)<1e-9);
  }
  assert.deepEqual(original,before,'Viewport planning never mutates the saved character position');
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

test('character region accepts only the original canvas or the fixed positive-coordinate effects canvas',()=>{
  const legacy={width:600,height:800,rects:[{x:100,y:200,width:30,height:40}]};
  assert.deepEqual(sanitizeCharacterRegion(legacy),legacy);
  const extended={width:740,height:800,originX:-140,referenceWidth:600,rects:[{x:20,y:200,width:30,height:40}]};
  assert.deepEqual(sanitizeCharacterRegion(extended),extended);
  for(const malformed of [
    {...extended,originX:0},{...extended,originX:-141},{...extended,originX:NaN},{...extended,referenceWidth:740},
    {...extended,referenceWidth:undefined},{...extended,width:741},{...extended,height:801},
    {...legacy,originX:-140},{...legacy,referenceWidth:740},{...extended,rects:[]},
    {...extended,rects:[{x:NaN,y:0,width:1,height:1}]},
  ])assert.equal(sanitizeCharacterRegion(malformed),null);
});

test('negative-x effects project into the new native margin at the original character scale',()=>{
  const character=virtualBounds({x:500,y:100},1),plan=planViewport(character,displays);
  const view=viewportSnapshot(character,plan.native,plan.clipped);
  const region=sanitizeCharacterRegion({width:740,height:800,originX:-140,referenceWidth:600,
    rects:[{x:20,y:200,width:30,height:40},{x:240,y:200,width:30,height:40}]});
  const projected=projectHitRegion(region,view);
  assert.deepEqual(plan.native,{x:402,y:100,width:518,height:560});
  const expected={width:518,height:560,rects:[
    {x:14,y:140,width:21,height:28},{x:168,y:140,width:21,height:28},
  ]};
  assert.equal(projected.width,expected.width);assert.equal(projected.height,expected.height);
  for(let i=0;i<expected.rects.length;i++)for(const key of ['x','y','width','height'])
    assert.ok(Math.abs(projected.rects[i][key]-expected.rects[i][key])<1e-9,`${key} retains the original character scale`);
  const bodyOnly=sanitizeCharacterRegion({width:600,height:800,rects:[{x:100,y:200,width:30,height:40}]});
  assert.deepEqual(projected.rects[1],projectHitRegion(bodyOnly,view).rects[0],'Adding the margin cannot shrink or reposition the original body hit area');
});

test('the reserved effects area stays click-through except for declared visible effect rectangles',()=>{
  const character=virtualBounds({x:500,y:100},1),plan=planViewport(character,displays);
  const view=viewportSnapshot(character,plan.native,plan.clipped);
  const body={width:740,height:800,originX:-140,referenceWidth:600,rects:[{x:240,y:200,width:30,height:40}]};
  const hits=projectHitRegion(sanitizeCharacterRegion(body),view).rects;
  const hit=(x,y)=>hits.some(rect=>x>=rect.x&&y>=rect.y&&x<rect.x+rect.width&&y<rect.y+rect.height);
  assert.equal(hit(20,150),false,'Unused left margin must not become a rectangular blocker');
  assert.equal(hit(170,150),true,'The unchanged character silhouette remains clickable');
  const cropped=projectHitRegion(sanitizeCharacterRegion({...body,rects:[{x:10,y:200,width:50,height:40}]}),
    {width:100,height:100,characterX:100,characterY:-100,characterWidth:600,characterHeight:800});
  assert.deepEqual(cropped.rects,[{x:0,y:0,width:1,height:1}],'Fully offscreen effects never restore a rectangular region');
});

test('ordinary native dragging retains the original cursor-to-character offset with the left margin',()=>{
  let bounds=virtualBounds({x:500,y:100},1);const original={...bounds};
  const pointer=createDesktopPointer({readCursor:()=>({x:600,y:260}),getBounds:()=>bounds,
    setPosition:(x,y)=>{bounds={...bounds,x,y};},sendPointer:()=>{},constrainBounds:value=>value});
  pointer.startDrag({x:600,y:260});pointer.sample({x:680,y:300});pointer.endDrag({x:680,y:300});
  assert.equal(bounds.x,original.x+80);assert.equal(bounds.y,original.y+40);
  const before=planViewport(original,displays),after=planViewport(bounds,displays);
  assert.equal(after.native.x,before.native.x+80);assert.equal(after.native.y,before.native.y+40);
  assert.equal(after.native.width,before.native.width);assert.equal(after.native.height,before.native.height);
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
