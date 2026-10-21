import test from 'node:test';
import assert from 'node:assert/strict';
import {alphaToOccupancy,rectanglesFromOccupancy} from '../renderer/hit-region.mjs';

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
