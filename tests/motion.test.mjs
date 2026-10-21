/** Regression checks for continuous, cursor-independent idle movement. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { jointPose, deformPoint, MESH_GRID } from '../renderer/mesh-rig.mjs';
import { createPetState, advance } from '../renderer/state.mjs';

test('hair, fabric and legs keep moving with a stationary cursor, and can be disabled', () => {
  const frames = Array.from({ length: 241 }, (_, frame) => jointPose(frame / 30));
  for (let joint = 0; joint < frames[0].length; joint++) {
    const values = frames.map(frame => frame[joint]);
    assert.ok(Math.max(...values) - Math.min(...values) > .005, `Joint ${joint} must visibly move while idle`);
    const limit = joint === 0 ? .004 : joint === 10 ? .061 : joint === 1 || joint === 2 ? .033 : .042;
    assert.ok(values.every(value => Number.isFinite(value) && Math.abs(value) < limit), 'Idle rotation must remain gentle');
    assert.ok(values.slice(1).every((value, i) => Math.abs(value - values[i]) < .002), 'No discontinuous jumps between frames');
  }
  assert.ok([...jointPose(2.3, false)].every(value => value === 0));
});

test('whole shoes and loose hems travel gently in the default 420 by 560 window', () => {
  // The source is placed at .48 in a 600-wide logical canvas, displayed at 420.
  const sourceToScreen = .48 * 420 / 600;
  const landmarks = {
    leftToe: [534,1357], leftHeel: [492,1334], leftEdge: [573,1352],
    rightToe: [663,1300], rightHeel: [620,1290], rightEdge: [688,1268],
    leftCloakHem: [290,1210], rightCloakHem: [815,1188], skirtHem: [420,1060],
  };
  for (const [name, point] of Object.entries(landmarks)) {
    const xs = Array.from({length:241}, (_,frame) => deformPoint(...point, frame/30)[0]);
    const travel = (Math.max(...xs)-Math.min(...xs))*sourceToScreen;
    assert.ok(travel >= 4.4 && travel <= 9.9, `${name} must move 4.4–9.9 screen pixels, got ${travel.toFixed(2)}`);
    assert.deepEqual(deformPoint(...point, 2.3, false), point, 'Disabling idle movement restores source geometry');
  }
});

// Sample the actual triangle interpolation used by WebGL. Applying the CPU
// weight field directly at an arbitrary pixel would miss mesh interpolation.
function screenPoint(point, time, enabled = true, cat = false, pose = 'idle') {
  const {width,height,columns,rows}=MESH_GRID;
  const gx=point[0]*columns/width,gy=point[1]*rows/height;
  const i=Math.floor(gx),j=Math.floor(gy),u=gx-i,v=gy-j;
  const vertices=u+v<=1 ? [[i,j,1-u-v],[i+1,j,u],[i,j+1,v]]
    : [[i+1,j,1-v],[i+1,j+1,u+v-1],[i,j+1,1-u]];
  return vertices.reduce((sum,[ix,iy,weight])=>{
    const p=deformPoint(ix*width/columns,iy*height/rows,time,enabled,cat,pose);
    return [sum[0]+p[0]*weight,sum[1]+p[1]*weight];
  },[0,0]);
}

const synchronousLandmarks={
  crown:[550,100],topTuft:[925,145],
  leftOuterLock:[200,650],rightOuterLock:[920,620],
  leftInnerLock:[365,400],rightInnerLock:[780,550],fringe:[500,475],
  leftBackHair:[220,1250],rightBackHair:[980,920],
  leftCloak:[290,1210],rightCloak:[815,1188],skirt:[420,1060],
  leftLeg:[534,1357],rightLeg:[663,1300],
};

test('upper hair, fringe, hems and both legs move in the same screen direction throughout long idle sessions',()=>{
  const offsets=[0,41.3,3600.7,86400.1],step=1/120;
  let checked=0;
  for(const cat of [false,true])for(const pose of ['idle','megaphone','tea','cake']) {
    for(const offset of offsets)for(let frame=0;frame<180;frame++) {
      const time=offset+frame/20;
      const velocity=point=>screenPoint(point,time+step,true,cat,pose)[0]-screenPoint(point,time-step,true,cat,pose)[0];
      const lowerDirection=velocity(synchronousLandmarks.leftLeg);
      if(Math.abs(lowerDirection)<.005)continue; // Near the shared turning point.
      for(const [name,point]of Object.entries(synchronousLandmarks)) {
        const upperDirection=velocity(point);
        // A foreground prop or enabled cat ear can pin a landmark completely.
        if(Math.abs(upperDirection)<1e-7)continue;
        assert.ok(upperDirection*lowerDirection>0,
          `${name} moved opposite to the legs at ${time}s, cat=${cat}, pose=${pose}`);
        checked++;
      }
    }
  }
  assert.ok(checked>50000,'Audit must cover all poses and several early/long-running cycles');
  for(const point of Object.values(synchronousLandmarks)) {
    for(const time of [0,.7,9,3601,86400]) {
      const stationary=screenPoint(point,time,false);
      assert.ok(Math.hypot(stationary[0]-point[0],stationary[1]-point[1])<1e-10,
        'Disabling movement must leave every upper and lower landmark stationary');
    }
  }
});

test('hair and lower-body motion keep the entire mesh connected and facing forward', () => {
  // Check the entire production grid, including fringe/face and hip/skirt joins.
  // An inverted triangle would fold an edge even without a topological gap.
  const nx=66, ny=88, dx=1090/nx, dy=1443/ny;
  const area = (a,b,c) => ((b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]))/(dx*dy);
  for (const [cat,pose] of [false,true].flatMap(cat=>['idle','megaphone','tea','cake'].map(pose=>[cat,pose]))) for (let time=0; time<8; time+=.2) {
    const rows = Array.from({length:ny+1}, (_,j) => Array.from({length:nx+1}, (_,i) => deformPoint(i*dx,j*dy,time,true,cat,pose)));
    for (let j=0; j<rows.length-1; j++) for (let i=0; i<nx; i++) {
      const a=rows[j][i], b=rows[j][i+1], c=rows[j+1][i], d=rows[j+1][i+1];
      assert.ok(Math.min(area(a,b,c),area(b,d,c)) > .25, `Folded or collapsed mesh at ${i},${j}, time ${time}, cat ${cat}, pose ${pose}`);
    }
  }
});

test('side locks and fringe retain gentle visible travel at default pet size', () => {
  for (const [name,point,min,max] of [
    ['left lock',[200,650],5.8,9.9], ['right lock',[920,620],5.8,9.9],
    ['left fringe tip',[500,475],3.5,7.7], ['right fringe tip',[530,450],3.5,7.7],
    ['inner left lock',[365,400],3.5,7.15], ['inner right lock',[780,550],4.6,8.25],
    ['left hair beside face',[330,460],2.3,5.5], ['right hair beside face',[750,500],2.3,5.5],
  ]) {
    const xs=Array.from({length:241},(_,frame)=>deformPoint(...point,frame/30)[0]);
    const pixels=(Math.max(...xs)-Math.min(...xs))*.336;
    assert.ok(pixels>=min&&pixels<=max,`${name} travel ${pixels.toFixed(2)} px is outside ${min}–${max}`);
  }
});

test('the face, elf ear and enabled cat ears stay fixed while nearby hair moves', () => {
  const face=[[413,555],[647,520],[350,515],[450,510],[590,465],[710,510],[531,587],[535,639],[367,619],[667,603]];
  const ear=[];
  for(let x=917;x<=962;x+=5)for(let y=425;y<=480;y+=5)ear.push([x,y]);
  for(let time=0;time<8;time+=.2){
    for(const point of [...face,...ear])assert.deepEqual(deformPoint(...point,time),point,`Fixed facial/ear point ${point} moved`);
    for(const point of [[222,110],[230,210],[300,180],[842,70],[825,150],[857,210]]) {
      assert.deepEqual(deformPoint(...point,time,true,true),point,`Cat ear ${point} moved`);
    }
  }
});

test('sweeping the cursor changes gaze without introducing hair impulses', () => {
  const still = createPetState(), moving = createPetState();
  for (let i = 0; i < 360; i++) {
    moving.target = { x: Math.sin(i * .3) * 6, y: Math.cos(i * .2) * 4 };
    advance(still, 1 / 60); advance(moving, 1 / 60);
    assert.equal(still.hair, moving.hair);
    assert.deepEqual(jointPose(still.time), jointPose(moving.time));
  }
  assert.notDeepEqual(still.gaze, moving.gaze);
});
