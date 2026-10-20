'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createDesktopPointer}=require('../electron/desktop-pointer.cjs');
const {createDragLifecycle}=require('../electron/drag-lifecycle.cjs');

function fixture(){
 const window=new EventEmitter();window.webContents=new EventEmitter();let cursor={x:100,y:100},bounds={x:30,y:50,width:420,height:560},saved=0;
 const pointer=createDesktopPointer({readCursor:()=>cursor,getBounds:()=>({...bounds}),setPosition:(x,y)=>{bounds={...bounds,x,y};},sendPointer:()=>{},onDragEnd:()=>saved++});
 const lifecycle=createDragLifecycle({window,pointer,readCursor:()=>cursor});
 return {window,pointer,lifecycle,setCursor(point){cursor=point;},native(type,button='left'){window.webContents.emit('before-mouse-event',{}, {type,button});},get bounds(){return bounds;},get saved(){return saved;}};
}

test('native release stops drag before delayed renderer pointerup and keeps the release position',()=>{
 const f=fixture();f.native('mouseDown');assert.equal(f.lifecycle.startDrag(),true);
 f.setCursor({x:150,y:100});f.pointer.sample();f.native('mouseUp');
 assert.equal(f.pointer.dragging,false);assert.equal(f.lifecycle.nativePressed,false);assert.equal(f.saved,1);
 f.setCursor({x:900,y:800});f.pointer.sample();f.lifecycle.endDrag();
 assert.deepEqual(f.bounds,{x:80,y:50,width:420,height:560});assert.equal(f.saved,1);f.lifecycle.dispose();
});

test('a pointerdown IPC queued until after native release cannot restart the drag',()=>{
 const f=fixture();f.native('mouseDown');f.native('mouseUp');f.setCursor({x:900,y:800});
 assert.equal(f.lifecycle.startDrag(),false);f.pointer.sample();assert.equal(f.pointer.dragging,false);
 assert.deepEqual(f.bounds,{x:30,y:50,width:420,height:560});f.lifecycle.dispose();
});

test('a briefly delayed start retains the original native grab offset',()=>{
 const f=fixture();f.native('mouseDown');f.setCursor({x:150,y:130});
 assert.equal(f.lifecycle.startDrag(),true);assert.deepEqual(f.bounds,{x:80,y:80,width:420,height:560});
 f.native('mouseUp');f.lifecycle.dispose();
});

test('right and middle buttons cannot initiate or interrupt a left-button drag',()=>{
 const f=fixture();f.native('mouseDown','right');assert.equal(f.lifecycle.startDrag(),false);
 f.native('mouseDown');f.lifecycle.startDrag();f.native('mouseUp','right');f.native('mouseUp','middle');
 assert.equal(f.pointer.dragging,true);f.native('mouseUp');assert.equal(f.pointer.dragging,false);f.lifecycle.dispose();
});

test('window blur, hiding, minimize, renderer failure and reload cancel without moving to a later cursor',()=>{
 for(const[target,event]of [['window','blur'],['window','hide'],['window','minimize'],['contents','render-process-gone'],['contents','did-start-loading']]){
  const f=fixture();f.native('mouseDown');f.lifecycle.startDrag();f.setCursor({x:600,y:600});
  (target==='window'?f.window:f.window.webContents).emit(event);assert.equal(f.pointer.dragging,false);assert.equal(f.lifecycle.startDrag(),false);
  f.pointer.sample();assert.deepEqual(f.bounds,{x:30,y:50,width:420,height:560},event);f.lifecycle.dispose();
 }
});

test('recovery cancellation rejects stale starts and permits a fresh native press',()=>{
 const f=fixture();f.native('mouseDown');f.lifecycle.startDrag();f.lifecycle.cancelDrag();
 assert.equal(f.lifecycle.startDrag(),false);f.native('mouseDown');assert.equal(f.lifecycle.startDrag(),true);f.lifecycle.dispose();
});

test('destruction and repeated disposal remove all listeners and prevent future drags',()=>{
 for(const target of ['window','contents']){
  const f=fixture();f.native('mouseDown');f.lifecycle.startDrag();
  (target==='window'?f.window:f.window.webContents).emit(target==='window'?'closed':'destroyed');
  assert.equal(f.lifecycle.disposed,true);assert.equal(f.pointer.dragging,false);
  assert.deepEqual(f.window.eventNames(),[]);assert.deepEqual(f.window.webContents.eventNames(),[]);
  f.lifecycle.dispose();f.native('mouseDown');assert.equal(f.lifecycle.startDrag(),false);
 }
});
