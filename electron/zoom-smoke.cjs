// Additional isolated, hidden native checks. No synthetic global input is sent.
'use strict';
const assert=require('node:assert/strict');
async function checkDesktopZoom({window,getState,resize,place,pointer,shape}){
  const original=getState(),start=original.viewport;
  const originalPosition={x:start.x+start.characterX,y:start.y+start.characterY};
  const captures=[];
  const settle=()=>window.webContents.executeJavaScript(`new Promise(resolve=>setTimeout(()=>{window.dispatchEvent(new Event('resize'));resolve({
    width:innerWidth,height:innerHeight,canvasWidth:document.querySelector('#pet').width,
    canvasHeight:document.querySelector('#pet').height,panelCount:document.querySelectorAll('#controls').length
  })},120))`);
  try{
    assert.equal(window.isVisible(),false);
    for(const scale of [.01,10,1000,1e6]){
      resize(scale);
      const renderer=await settle(),snapshot=getState(),bounds=window.getContentBounds();
      assert.equal(snapshot.settings.scale,scale);
      assert.ok(bounds.width<=8192&&bounds.height<=8192,'Native window is bounded by the visible desktop');
      assert.ok(renderer.canvasWidth<=8192&&renderer.canvasHeight<=8192,'Canvas never grows to virtual pet size');
      if(scale>=10)assert.ok(bounds.width>100&&bounds.height>100,'Tray zoom retains a visible part of the character');
      assert.equal(renderer.panelCount,0,'The removed settings panel must not exist');
      assert.equal(shape.status.applied,true,'Projected character region remains installed');
      assert.equal(window.isVisible(),false,'Resizing never shows the isolated smoke window');
      captures.push({scale,bounds,viewport:snapshot.viewport,renderer,shape:shape.status});
    }
    const before=getState().viewport,point={x:before.x+200,y:before.y+200};
    pointer.startDrag(point);pointer.sample({x:point.x+150,y:point.y-90});pointer.endDrag({x:point.x+150,y:point.y-90});
    const after=getState().viewport;
    assert.equal(after.characterX+after.x,before.characterX+before.x+150);
    assert.equal(after.characterY+after.y,before.characterY+before.y-90);
    resize(1);await settle();
    await window.webContents.executeJavaScript(`Promise.all(Array.from({length:24},()=>window.elysiaDesktop.zoomBy({steps:1,anchorX:100,anchorY:100})))`);
    assert.ok(Math.abs(getState().settings.scale/1.1**24-1)<1e-12,'Relative IPC increments retain every rapid wheel step');
    assert.equal(window.isVisible(),false);
    return {scales:captures,virtualDrag:true,rapidZoomSteps:24,removedPanel:true,hiddenThroughout:true};
  }finally{
    pointer.reset();resize(original.settings.scale);place(originalPosition);await settle();
  }
}
module.exports={checkDesktopZoom};
