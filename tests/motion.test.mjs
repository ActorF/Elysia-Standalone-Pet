/** Regression checks for continuous, cursor-independent idle movement. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { jointPose, deformPoint } from '../renderer/mesh-rig.mjs';
import { createPetState, advance } from '../renderer/state.mjs';

test('hair, fabric and legs keep moving with a stationary cursor, and can be disabled', () => {
  const frames = Array.from({ length: 241 }, (_, frame) => jointPose(frame / 30));
  for (let joint = 0; joint < frames[0].length; joint++) {
    const values = frames.map(frame => frame[joint]);
    assert.ok(Math.max(...values) - Math.min(...values) > .005, `Joint ${joint} must visibly move while idle`);
    const limit = joint === 10 ? .11 : joint === 1 || joint === 2 ? .06 : .075;
    assert.ok(values.every(value => Number.isFinite(value) && Math.abs(value) < limit), 'Idle rotation must remain gentle');
    assert.ok(values.slice(1).every((value, i) => Math.abs(value - values[i]) < .0035), 'No discontinuous jumps between frames');
  }
  assert.ok([...jointPose(2.3, false)].every(value => value === 0));
});

test('whole shoes and loose hems travel visibly in the default 420 by 560 window', () => {
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
    assert.ok(travel >= 8 && travel <= 18, `${name} must move 8–18 screen pixels, got ${travel.toFixed(2)}`);
    assert.deepEqual(deformPoint(...point, 2.3, false), point, 'Disabling idle movement restores source geometry');
  }
});

test('accepted 0.4 fabric and leg trajectories remain unchanged', () => {
  // Frozen 0.4 source-space landmarks protect the approved lower-body motion
  // while new hair joints and their eye guards are added elsewhere in the mesh.
  const snapshots=[
    [290,1210,.75,291.4758499376705,1210.105727100362],
    [815,1188,2,826.3614964449665,1186.015382118034],
    [420,1060,4.25,422.7896325024607,1061.4538007408935],
    [534,1357,6.5,548.1521131963682,1352.7781558031215],
    [663,1300,2,667.3764847596658,1298.0997682005188],
  ];
  for(const [x,y,time,expectedX,expectedY] of snapshots){
    const actual=deformPoint(x,y,time);
    assert.ok(Math.hypot(actual[0]-expectedX,actual[1]-expectedY)<1e-8,`Approved lower-body trajectory changed at ${x},${y}`);
  }
});

test('hair and lower-body motion keep the entire mesh connected and facing forward', () => {
  // Check the entire production grid, including fringe/face and hip/skirt joins.
  // An inverted triangle would fold an edge even without a topological gap.
  const nx=66, ny=88, dx=1090/nx, dy=1443/ny;
  const area = (a,b,c) => ((b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]))/(dx*dy);
  for (let time=0; time<8; time+=.2) {
    const rows = Array.from({length:ny+1}, (_,j) => Array.from({length:nx+1}, (_,i) => deformPoint(i*dx,j*dy,time)));
    for (let j=0; j<rows.length-1; j++) for (let i=0; i<nx; i++) {
      const a=rows[j][i], b=rows[j][i+1], c=rows[j+1][i], d=rows[j+1][i+1];
      assert.ok(Math.min(area(a,b,c),area(b,d,c)) > .25, `Folded or collapsed mesh at ${i},${j}, time ${time}`);
    }
  }
});

test('side locks and fringe have visible independent travel at default pet size', () => {
  for (const [name,point,min,max] of [
    ['left lock',[200,650],12,18], ['right lock',[920,620],12,18],
    ['left fringe tip',[500,475],8,12], ['right fringe tip',[530,450],8,12],
  ]) {
    const xs=Array.from({length:241},(_,frame)=>deformPoint(...point,frame/30)[0]);
    const pixels=(Math.max(...xs)-Math.min(...xs))*.336;
    assert.ok(pixels>=min&&pixels<=max,`${name} travel ${pixels.toFixed(2)} px is outside ${min}–${max}`);
  }
});

test('hair joints leave eyes, eyebrows, facial features and the fringe root on the rigid head', () => {
  const points=[[500,300],[413,555],[647,520],[350,515],[450,510],[590,465],[710,510],[531,587],[535,639],[367,619],[667,603]];
  // Sample whole visible brow spans, not just their centres: the original fine
  // brow marks partly cross the fringe, and expressive brows sit closer to eyes.
  for (let x=375;x<=425;x+=5) points.push([x,422]);
  for (let x=540;x<=640;x+=5) points.push([x,389]);
  for (let x=380;x<=440;x+=5) points.push([x,505]);
  for (let x=610;x<=680;x+=5) points.push([x,462]);
  for (let x=370;x<=404;x+=5) for(let y=450;y<=475;y+=5) points.push([x,y]);
  for (let x=616;x<=665;x+=5) for(let y=409;y<=419;y+=5) points.push([x,y]);
  for(let time=0;time<8;time+=.2){
    const head=jointPose(time)[0],c=Math.cos(head),s=Math.sin(head);
    for(const [x,y] of points){
      const expected=[540+c*(x-540)-s*(y-705),705+s*(x-540)+c*(y-705)];
      const actual=deformPoint(x,y,time);
      assert.ok(Math.hypot(actual[0]-expected[0],actual[1]-expected[1])<1e-8,`Hair distorted facial point ${x},${y}`);
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
