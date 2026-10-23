import test from 'node:test';
import assert from 'node:assert/strict';
import {createPetState,advance,applyAction} from '../renderer/state.mjs';
import {motionAmplitude,motionSpeed,motionTime} from '../renderer/motion-settings.mjs';
import {jointPose,deformPoint,MESH_GRID} from '../renderer/mesh-rig.mjs';
import {createMeshBounds,meshBoundsAtPoint} from '../renderer/mesh-envelope.mjs';
import host from '../electron/host-policy.cjs';

test('saved motion values have the same bounds and old-setting defaults in host and renderer',()=>{
  for(const value of [undefined,null,'2',NaN,Infinity,-5,0,.1,.25,.5,1,2,3,50]){
    const saved=host.sanitizeSettings({motionAmplitude:value,motionSpeed:value});
    assert.equal(motionAmplitude({motionAmplitude:value}),saved.motionAmplitude);
    assert.equal(motionSpeed({motionSpeed:value}),saved.motionSpeed);
  }
  assert.equal(motionAmplitude({hairMotion:false,motionAmplitude:2}),0);
});

test('live speed changes keep the current phase while leaving blink and gaze clocks alone',()=>{
  const ordinary=createPetState(),changed=createPetState();
  ordinary.target=changed.target={x:.6,y:-.8};
  for(let frame=0;frame<600;frame++){
    const speed=frame<240?.25:frame<480?3:.5;
    const before=changed.motionTime??0;
    advance(ordinary,1/60);
    advance(changed,1/60,{motionSpeed:speed,motionAmplitude:.5});
    assert.ok(Math.abs(changed.motionTime-before-speed/60)<1e-12);
    assert.equal(changed.time,ordinary.time);
    assert.equal(changed.blink,ordinary.blink);
    assert.equal(changed.nextBlink,ordinary.nextBlink);
    assert.deepEqual(changed.gaze,ordinary.gaze);
  }
  const phase=changed.motionTime;
  advance(changed,0,{motionSpeed:3});
  assert.equal(changed.motionTime,phase,'Changing the setting with no elapsed time cannot move the mesh');
  applyAction(changed,{type:'expression',id:'cry'});
  applyAction(changed,{type:'pose',id:'cake'});
  assert.equal(changed.motionTime,phase,'Changing appearance does not restart the sway cycle');
  assert.equal(motionTime({time:2},{motionSpeed:.5}),1,'Still-frame previews honor speed without a live clock');
});

test('amplitude changes travel, zero restores geometry, and all parts share direction',()=>{
  const points=[[200,650],[920,620],[500,475],[290,1210],[815,1188],[420,1060],[534,1357],[663,1300]];
  const peak=Math.PI/(2*.9),opposite=peak*3;
  for(const point of points){
    const travel=amplitude=>Math.abs(deformPoint(...point,peak,true,false,'idle',amplitude)[0]-deformPoint(...point,opposite,true,false,'idle',amplitude)[0]);
    assert.ok(travel(.5)<travel(1)&&travel(1)<travel(2));
    assert.deepEqual(deformPoint(...point,peak,true,false,'idle',0),point);
    assert.deepEqual(deformPoint(...point,peak,false,false,'idle',2),point);
  }
  for(const amplitude of [.25,2])for(const time of [.2,1,3,4,6]){
    const velocities=points.map(point=>deformPoint(...point,time+.001,true,false,'idle',amplitude)[0]-deformPoint(...point,time-.001,true,false,'idle',amplitude)[0]);
    assert.ok(velocities.every(value=>value*velocities[0]>0),'Upper and lower body must travel together');
  }
  assert.ok([...jointPose(peak,true,0)].every(value=>value===0));
});

test('maximum selectable amplitude keeps triangles facing forward in all poses and skins',()=>{
  const {width,height,columns,rows}=MESH_GRID,dx=width/columns,dy=height/rows;
  const area=(a,b,c)=>((b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]))/(dx*dy);
  for(const cat of [false,true])for(const pose of ['idle','megaphone','cake','tea'])for(const time of [Math.PI/1.8,Math.PI/1.8*3]){
    const grid=Array.from({length:rows+1},(_,j)=>Array.from({length:columns+1},(_,i)=>deformPoint(i*dx,j*dy,time,true,cat,pose,2)));
    for(let j=0;j<rows;j++)for(let i=0;i<columns;i++){
      const a=grid[j][i],b=grid[j][i+1],c=grid[j+1][i],d=grid[j+1][i+1];
      assert.ok(Math.min(area(a,b,c),area(b,d,c))>.25,`Collapsed mesh: ${pose}/${cat}/${time}/${i}/${j}`);
    }
  }
});

test('click envelope expands with amplitude and covers the maximum rendered triangle travel',()=>{
  const {width,height,columns,rows}=MESH_GRID;
  const lower=createMeshBounds({motionAmplitude:.5}),higher=createMeshBounds({motionAmplitude:2});
  for(const [i,j] of [[12,38],[45,35],[20,64],[32,78],[41,80]]){
    const vertices=[[i,j],[i+1,j],[i,j+1]],weights=[.2,.3,.5];
    const x=vertices.reduce((n,[vx],k)=>n+vx*width/columns*weights[k],0);
    const y=vertices.reduce((n,[,vy],k)=>n+vy*height/rows*weights[k],0);
    const small=meshBoundsAtPoint(lower,x,y),large=meshBoundsAtPoint(higher,x,y);
    assert.ok(large[0]<=small[0]&&large[1]<=small[1]&&large[2]>=small[2]&&large[3]>=small[3]);
    for(let time=0;time<7;time+=.2){
      const deformed=vertices.map(([vx,vy])=>deformPoint(vx*width/columns,vy*height/rows,time,true,false,'idle',2));
      const dx=deformed.reduce((n,p,k)=>n+p[0]*weights[k],0)-x;
      const dy=deformed.reduce((n,p,k)=>n+p[1]*weights[k],0)-y;
      assert.ok(dx>=large[0]&&dy>=large[1]&&dx<=large[2]&&dy<=large[3]);
    }
  }
});
