import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasBacking,characterView} from '../renderer/viewport.mjs';
import {createPointerTracking} from '../renderer/pointer-tracking.mjs';
import {createPetState} from '../renderer/state.mjs';

test('large and high-DPI viewports keep bounded backing pixels without changing character scale',()=>{
  for(const [width,height,dpr] of [[27,34,1.25],[420,560,2],[2560,1440,2],[8192,8192,4]]){
    const backing=canvasBacking(width,height,dpr);
    assert.ok(backing.width>0&&backing.height>0);
    assert.ok(backing.width<=4096&&backing.height<=4096);
    assert.ok(backing.width*backing.height<=8_000_000);
  }
  assert.deepEqual(characterView(27,34,{characterX:0,characterY:0,characterWidth:4.2,characterHeight:5.6}),{x:0,y:0,scale:.006999999999999999});
  assert.equal(characterView(1920,1080,{characterX:-1e12,characterY:-1e12,characterWidth:600e10,characterHeight:800e10}).scale,1e10);
});

test('eye tracking follows virtual character coordinates when the native window is clipped',()=>{
  const state=createPetState(),anchor={gazeX:300,gazeY:250};
  const tracking=createPointerTracking(state,anchor,()=>100);
  const viewport={characterX:-2500,characterY:-2200,characterWidth:6000,characterHeight:8000};
  assert.equal(tracking.sample({localX:500,localY:300,width:1000,height:700,viewport}),true);
  assert.deepEqual(state.target,{x:0,y:0});
  tracking.sample({localX:730,localY:540,width:1000,height:700,viewport});
  assert.ok(Math.abs(state.target.x-.1)<1e-10);
  assert.ok(Math.abs(state.target.y-.1)<1e-10);
});
