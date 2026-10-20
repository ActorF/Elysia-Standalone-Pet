// Native mouse lifecycle is observed before page dispatch, so busy rendering
// cannot keep a released pet attached to the cursor or revive a queued drag.
'use strict';

function createDragLifecycle({window,pointer,readCursor}) {
  const contents=window.webContents,listeners=[];
  let press=null,disposed=false;
  const valid=point=>point&&Number.isFinite(point.x)&&Number.isFinite(point.y);
  function listen(target,event,callback){target.on(event,callback);listeners.push([target,event,callback]);}
  function cancelDrag(){press=null;pointer.cancelDrag();}
  function endDrag(){
    if(disposed)return;
    press=null;
    // This runs in the main process at native release, before a renderer's
    // delayed pointerup callback. A second renderer end notification is a no-op.
    pointer.endDrag(readCursor());
  }
  function nativeMouse(_event,mouse){
    if(disposed||mouse?.button!=='left')return;
    if(mouse.type==='mouseDown'){
      const point=readCursor();
      press=valid(point)?{x:point.x,y:point.y}:null;
    }else if(mouse.type==='mouseUp')endDrag();
  }
  function startDrag(){
    if(disposed||!press)return false;
    // Preserve the original grab offset if rendering briefly delayed the
    // pointerdown IPC. Movement itself still samples the current native cursor.
    pointer.startDrag(press);pointer.sample();return pointer.dragging;
  }
  function dispose(){
    if(disposed)return;
    disposed=true;cancelDrag();
    for(const[target,event,callback]of listeners)target.removeListener(event,callback);
    listeners.length=0;
  }
  listen(contents,'before-mouse-event',nativeMouse);
  for(const event of ['render-process-gone','did-start-loading'])listen(contents,event,cancelDrag);
  for(const event of ['blur','hide','minimize'])listen(window,event,cancelDrag);
  listen(contents,'destroyed',dispose);listen(window,'closed',dispose);
  return {startDrag,endDrag,cancelDrag,dispose,get nativePressed(){return press!==null;},get disposed(){return disposed;}};
}

module.exports={createDragLifecycle};
