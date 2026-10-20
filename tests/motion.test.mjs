/** Rigidity regressions: motion must not change limb width, length or painted lines. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {LAYERS,layerTransform,transformLayerPoint} from '../renderer/layer-motion.mjs';
import {createPetState,advance} from '../renderer/state.mjs';
const times=Array.from({length:457},(_,i)=>i/60);
const close=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<1e-9,`${message}: ${actual} != ${expected}`);
const points={frontHair:[[205,282],[355,558],[507,475],[776,545],[918,570]],backHair:[[792,751],[926,887],[886,1004],[263,1243]],legs:[[430,1130],[515,1130],[454,1210],[548,1210],[515,1350],[580,1350],[639,1250]],skirt:[[411,963],[555,970],[704,1009],[489,1051]],tail:[[810,1095],[981,1111],[1041,1045],[1011,1174]]};
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const area=polygon=>polygon.reduce((sum,p,i)=>{const q=polygon[(i+1)%polygon.length];return sum+p[0]*q[1]-q[0]*p[1];},0)/2;
test('every moving layer is a rotation with unit scale and no shear',()=>{
  for(const layer of LAYERS)for(const time of times){const {a,b,c,d,e,f}=layerTransform(layer.id,time);assert.ok([a,b,c,d,e,f].every(Number.isFinite));close(a*a+b*b,1,`${layer.id} horizontal scale`);close(c*c+d*d,1,`${layer.id} vertical scale`);close(a*c+b*d,0,`${layer.id} shear`);close(a*d-b*c,1,`${layer.id} signed area ratio`);}
});
test('stocking width, full leg length and all painted layer distances remain constant',()=>{
  for(const [id,landmarks]of Object.entries(points))for(const time of times){const transformed=landmarks.map(point=>transformLayerPoint(id,point,time));for(let i=0;i<landmarks.length;i++)for(let j=i+1;j<landmarks.length;j++)close(distance(transformed[i],transformed[j]),distance(landmarks[i],landmarks[j]),`${id} points ${i}/${j}`);close(area(transformed),area(landmarks),`${id} polygon area`);}
});
test('attachment pivots remain fixed and disabling movement restores exact geometry',()=>{
  for(const layer of LAYERS)for(const time of times){const actual=transformLayerPoint(layer.id,layer.pivot,time);close(actual[0],layer.pivot[0],`${layer.id} pivot x`);close(actual[1],layer.pivot[1],`${layer.id} pivot y`);assert.deepEqual(layerTransform(layer.id,time,false),{a:1,b:0,c:-0,d:1,e:0,f:0});for(const point of points[layer.id]??[[400,500]])assert.deepEqual(transformLayerPoint(layer.id,point,time,false),point);}
});
test('faces and ears stay fixed while complete hair and legs swing continuously',()=>{
  for(const id of ['face','ears'])for(const time of times)for(const point of [[413,555],[647,520],[946,455],[230,130],[830,150]])assert.deepEqual(transformLayerPoint(id,point,time),point);
  for(const [id,point]of [['frontHair',[776,545]],['backHair',[925,1000]],['legs',[539,1355]],['skirt',[425,1055]],['tail',[1010,1150]]]){const positions=times.map(time=>transformLayerPoint(id,point,time));const travel=(Math.max(...positions.map(p=>p[0]))-Math.min(...positions.map(p=>p[0])))*.336;assert.ok(travel>1.5&&travel<15,`${id} should visibly but gently move at desktop size (${travel.toFixed(2)}px)`);for(let i=1;i<positions.length;i++)assert.ok(distance(positions[i],positions[i-1])<.6,`${id} has a frame jump`);}
});
test('hair pieces follow the same slow direction without alternating local ripples',()=>{
  const a=times.map(time=>layerTransform('frontHair',time).b),b=times.map(time=>layerTransform('backHair',time).b);const mean=v=>v.reduce((sum,n)=>sum+n,0)/v.length,ma=mean(a),mb=mean(b);const covariance=a.reduce((sum,n,i)=>sum+(n-ma)*(b[i]-mb),0),variance=(v,m)=>v.reduce((sum,n)=>sum+(n-m)**2,0);assert.ok(covariance/Math.sqrt(variance(a,ma)*variance(b,mb))>.97);
});
test('cursor sweeps move gaze without changing any layer transform',()=>{
  const still=createPetState(),moving=createPetState();for(let i=0;i<360;i++){moving.target={x:Math.sin(i*.3)*6,y:Math.cos(i*.2)*4};advance(still,1/60);advance(moving,1/60);for(const layer of LAYERS)assert.deepEqual(layerTransform(layer.id,still.time),layerTransform(layer.id,moving.time));}assert.notDeepEqual(still.gaze,moving.gaze);
});
