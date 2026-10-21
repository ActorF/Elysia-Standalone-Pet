import test from 'node:test';
import assert from 'node:assert/strict';
import {alphaToOccupancy,rectanglesFromOccupancy} from '../renderer/hit-region.mjs';
import {MESH_GRID,meshPointMotionBounds,deformPoint} from '../renderer/mesh-rig.mjs';
import {createMeshBounds,meshBoundsAtPoint,meshRectangleBounds,meshAlphaToOccupancy} from '../renderer/mesh-envelope.mjs';

const pixels=(width,height,occupied)=>{
 const rgba=new Uint8ClampedArray(width*height*4);
 for(const [x,y,alpha=255]of occupied)rgba[(y*width+x)*4+3]=alpha;
 return rgba;
};
function covered(rects,x,y){return rects.some(r=>x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height);}

test('native rectangles exactly cover occupied cells, retaining holes and margins',()=>{
 const width=18,height=22,occupied=[];
 for(let y=4;y<18;y++)for(let x=3;x<16;x++)if(!(x>=7&&x<12&&y>=8&&y<15))occupied.push([x,y]);
 const mask=alphaToOccupancy(pixels(width,height,occupied),width,height,{cellSize:1,padding:0});
 const rects=rectanglesFromOccupancy(mask);
 assert.ok(rects.length<=4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)assert.equal(covered(rects,x,y),!!mask.cells[y*width+x]);
});

test('two-pixel cells and one-pixel dilation cover every subpixel motion sample gap',()=>{
 const mask=alphaToOccupancy(pixels(20,20,[[9,9,4],[18,2,3]]),20,20);
 const rects=rectanglesFromOccupancy(mask);
 for(let y=8;y<=10;y++)for(let x=8;x<=10;x++)assert.ok(covered(rects,x,y));
 assert.equal(covered(rects,7,9),false);assert.equal(covered(rects,12,9),false);
 assert.equal(covered(rects,18,2),false);
});

test('edge padding remains inside content bounds, including odd sizes',()=>{
 const mask=alphaToOccupancy(pixels(7,9,[[0,0],[6,8]]),7,9);
 const rects=rectanglesFromOccupancy(mask);
 assert.ok(covered(rects,0,0));assert.ok(covered(rects,6,8));
 for(const rect of rects){assert.ok(rect.x>=0&&rect.y>=0);assert.ok(rect.x+rect.width<=7&&rect.y+rect.height<=9);}
});

test('native four-pixel quantization adds no more than four pixels around alpha',()=>{
 for(let source=5;source<9;source++){
  const mask=alphaToOccupancy(pixels(20,20,[[source,source]]),20,20,{cellSize:4});
  const rects=rectanglesFromOccupancy(mask);
  for(let y=0;y<20;y++)for(let x=0;x<20;x++)if(covered(rects,x,y)){
   assert.ok(Math.abs(x-source)<=4);assert.ok(Math.abs(y-source)<=4);
  }
  assert.ok(covered(rects,source,source));
 }
});

test('run merging chooses the compact direction without filling empty gaps',()=>{
 const width=17,height=13,occupied=[];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(x<3||(x>=7&&x<12&&y%2===0))occupied.push([x,y]);
 const mask=alphaToOccupancy(pixels(width,height,occupied),width,height,{cellSize:1,padding:0});
 const rects=rectanglesFromOccupancy(mask);
 assert.equal(rects.length,8);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)assert.equal(covered(rects,x,y),!!mask.cells[y*width+x]);
});

test('empty alpha stays empty, and invalid masks are rejected',()=>{
 assert.deepEqual(rectanglesFromOccupancy(alphaToOccupancy(pixels(4,4,[]),4,4)),[]);
 assert.throws(()=>alphaToOccupancy(new Uint8Array(4),2,2),RangeError);
 assert.throws(()=>alphaToOccupancy(pixels(4,4,[]),4,4,{cellSize:0}),RangeError);
 assert.throws(()=>alphaToOccupancy(pixels(4,4,[]),4,4,{padding:-1}),RangeError);
});

test('old mesh vertex bounds cover complete independent motion cycles and pose/skin pins',()=>{
 const {width,height,columns,rows}=MESH_GRID;
 const points=[[12,9],[20,20],[54,12],[12,38],[20,40],[42,32],[58,40],[59,58],
  [52,63],[16,69],[12,77],[21,73],[46,58],[45,68],[31,60],[34,65],[30,78],[41,80],[33,85]];
 for(const pose of ['idle','megaphone','tea','cake'])for(const cat of [false,true])for(const [i,j]of points){
  const x=width*i/columns,y=height*j/rows,b=meshPointMotionBounds(x,y,true,cat,pose);
  assert.ok(b[0]<=0&&b[1]<=0&&b[2]>=0&&b[3]>=0);
  for(let phase=0;phase<128;phase++){
   // Frequencies have a 628-second common period; short animation samples
   // cannot stand in for the independent analytic angle bounds.
   const time=(phase-17)*628.3185307179587/127;
   const p=deformPoint(x,y,time,true,cat,pose),dx=p[0]-x,dy=p[1]-y;
   assert.ok(dx>=b[0]-1e-9&&dy>=b[1]-1e-9&&dx<=b[2]+1e-9&&dy<=b[3]+1e-9,
    `${pose}/${cat}/${i},${j} at ${time}`);
  }
 }
 assert.deepEqual(meshPointMotionBounds(500,1300,false,true,'cake'),[0,0,0,0]);
 for(const [x,y,cat,pose]of [[413,556,false,'idle'],[935,450,false,'idle'],[205,120,true,'idle'],[100,600,false,'megaphone']])
  assert.deepEqual(meshPointMotionBounds(x,y,true,cat,pose),[0,0,0,0]);
});

test('motion envelope interpolates the actual mesh triangles, including prop and cat anchors',()=>{
 const {width,height,columns,rows}=MESH_GRID;
 for(const pose of ['idle','megaphone','tea','cake'])for(const cat of [false,true]){
  const grid=createMeshBounds({pose,cat});
  for(const [i,j]of [[12,8],[23,31],[53,28],[54,46],[18,60],[43,61],[31,75],[40,81]])for(const upper of [true,false]){
   const vertices=upper?[[i,j],[i+1,j],[i,j+1]]:[[i+1,j],[i+1,j+1],[i,j+1]];
   const weights=[.23,.49,.28];
   const x=vertices.reduce((n,p,k)=>n+p[0]*width/columns*weights[k],0);
   const y=vertices.reduce((n,p,k)=>n+p[1]*height/rows*weights[k],0);
   const bounds=meshBoundsAtPoint(grid,x,y);
   for(const time of [-123.4,0,1.9,5.7,24.8,315.1,627.9,10000]){
    const points=vertices.map(([vx,vy])=>deformPoint(vx*width/columns,vy*height/rows,time,true,cat,pose));
    const dx=points.reduce((n,p,k)=>n+p[0]*weights[k],0)-x;
    const dy=points.reduce((n,p,k)=>n+p[1]*weights[k],0)-y;
    assert.ok(dx>=bounds[0]&&dx<=bounds[2]&&dy>=bounds[1]&&dy<=bounds[3]);
   }
  }
 }
});

test('a mesh diagonal crossing is included when rectangle corners miss the extremum',()=>{
 const grid={width:10,height:10,columns:1,rows:1,
  vertices:new Float64Array([0,0,0,0, -20,0,0,0, -20,0,0,0, 0,0,0,0])};
 const bounds=meshRectangleBounds(grid,2,1,8,6,0,0);
 assert.equal(bounds[0],-16);
 for(let yi=0;yi<=50;yi++)for(let xi=0;xi<=60;xi++){
  const x=2+xi*.1,y=1+yi*.1,b=meshBoundsAtPoint(grid,x,y);
  assert.ok(x+b[0]>=bounds[0]-1e-12&&x+b[2]<=bounds[2]+1e-12);
  assert.ok(y+b[1]>=bounds[1]-1e-12&&y+b[3]<=bounds[3]+1e-12);
 }
});

test('source texel envelope stays local, preserves clear margins and supports compact alpha',()=>{
 const alpha=new Uint8Array(MESH_GRID.width*MESH_GRID.height);
 alpha[1300*MESH_GRID.width+550]=1;
 const mask=meshAlphaToOccupancy(alpha),rects=rectanglesFromOccupancy(mask);
 assert.ok(rects.length>0);
 for(const r of rects){
  assert.ok(r.x>280&&r.x+r.width<328);
  assert.ok(r.y>680&&r.y+r.height<704);
 }
 const still=meshAlphaToOccupancy(alpha,{enabled:false}),stillRects=rectanglesFromOccupancy(still);
 assert.ok(still.cells.reduce((a,b)=>a+b,0)<mask.cells.reduce((a,b)=>a+b,0));
 assert.ok(covered(stillRects,38+550*.48,68+1300*.48));
 assert.throws(()=>meshAlphaToOccupancy(new Uint8Array(4)),RangeError);
});
