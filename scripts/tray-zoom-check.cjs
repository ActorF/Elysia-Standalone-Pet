/** Browser integration for the tray-only UI and bounded virtual zoom viewport. */
'use strict';
const {createServer}=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {DEFAULT_SETTINGS}=require('../electron/host-policy.cjs');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'artifacts','tray-zoom-check.json');
const types={'.html':'text/html','.css':'text/css','.mjs':'text/javascript','.png':'image/png','.json':'application/json'};
const server=createServer((request,response)=>{
  const file=path.resolve(root,'.'+decodeURIComponent(new URL(request.url,'http://localhost').pathname));
  if(!file.startsWith(root+path.sep)){response.writeHead(403).end();return;}
  try{response.setHeader('Content-Type',types[path.extname(file)]||'text/plain');response.end(fs.readFileSync(file));}catch{response.writeHead(404).end();}
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  const report={status:'running',checks:[],extremes:[],errors:[]};
  try{
    const page=await browser.newPage({viewport:{width:420,height:560},deviceScaleFactor:2});
    page.on('pageerror',error=>report.errors.push(error.message));
    await page.addInitScript(defaults=>{
      const callbacks={},host={settings:{...defaults,eyeTracking:false},hotkeys:{legacy:{active:false}}};
      const qa=window.__zoomQA={requests:[],menus:0,starts:0,ends:0,regions:[],delay:false,pending:0};
      function centeredViewport(){const width=innerWidth,height=innerHeight,characterWidth=420*host.settings.scale,characterHeight=560*host.settings.scale;
        return{x:0,y:0,width,height,scale:host.settings.scale,characterX:(width-characterWidth)/2,characterY:(height-characterHeight)/2,characterWidth,characterHeight,clipped:characterWidth>width||characterHeight>height};}
      let viewport;
      const snapshot=()=>({settings:{...host.settings},hotkeys:structuredClone(host.hotkeys),viewport:{...(viewport||centeredViewport())}});
      const publish=()=>{callbacks.settings?.(snapshot());callbacks.viewport?.({...viewport});};
      qa.setScale=scale=>{host.settings.scale=scale;viewport=centeredViewport();publish();};
      qa.current=()=>snapshot();
      qa.action=value=>callbacks.action(value);
      qa.drag=active=>callbacks.dragState?.(active);
      window.elysiaDesktop={
        getState:async()=>{viewport=centeredViewport();return snapshot();},
        onPointer(callback){callbacks.pointer=callback;},onSettings(callback){callbacks.settings=callback;},onAction(callback){callbacks.action=callback;},
        onDragState(callback){callbacks.dragState=callback;},onViewport(callback){callbacks.viewport=callback;},
        setSettings:async patch=>{Object.assign(host.settings,patch);viewport=centeredViewport();publish();return snapshot();},
        setAppearance(){},setHitRegion:async value=>{qa.regions.push(structuredClone(value));return true;},
        dragStart(){qa.starts++;callbacks.dragState?.(true);},dragEnd(){qa.ends++;callbacks.dragState?.(false);},
        showMenu(){qa.menus++;},quit(){},
        zoomBy:async request=>{
          const before=host.settings.scale;
          qa.requests.push(structuredClone(request));
          host.settings.scale=Math.max(.01,Math.min(Number.MAX_VALUE/2**20,before*1.1**request.steps));
          const factor=host.settings.scale/before,old=viewport||centeredViewport();
          viewport={...old,scale:host.settings.scale,characterX:request.anchorX-(request.anchorX-old.characterX)*factor,characterY:request.anchorY-(request.anchorY-old.characterY)*factor,
            characterWidth:420*host.settings.scale,characterHeight:560*host.settings.scale,clipped:host.settings.scale>1};
          publish();const response=snapshot();
          if(qa.delay){qa.pending++;await new Promise(resolve=>setTimeout(resolve,120));qa.pending--;}
          return response;
        },
      };
    },DEFAULT_SETTINGS);
    await page.goto(`http://127.0.0.1:${server.address().port}/renderer/index.html`);
    await page.waitForSelector('html[data-ready="true"]',{timeout:60000});
    const stats=()=>page.evaluate(()=>{
      const canvas=document.querySelector('#pet'),ctx=canvas.getContext('2d'),data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
      let visible=0;for(let i=3;i<data.length;i+=4)if(data[i]>8)visible++;
      return{scale:window.elysiaPreview.settings().scale,width:canvas.width,height:canvas.height,visible,requests:window.__zoomQA.requests.length,
        menus:window.__zoomQA.menus,starts:window.__zoomQA.starts,ends:window.__zoomQA.ends,host:window.__zoomQA.current(),region:window.__zoomQA.regions.at(-1)};
    });
    const requestCount=()=>page.evaluate(()=>window.__zoomQA.requests.length);
    const wheel=deltaY=>page.mouse.wheel(0,deltaY);
    await page.mouse.move(210,220);
    const before=await requestCount();
    await wheel(-100);await page.keyboard.down('Control');await wheel(-100);await page.keyboard.up('Control');await page.waitForTimeout(100);
    assert.equal(await requestCount(),before,'Plain or Ctrl+wheel cannot resize');
    report.checks.push('plain/Ctrl wheel ignored');
    await page.mouse.click(210,220,{button:'right'});await page.waitForTimeout(100);
    assert.equal(await requestCount(),before);assert.equal((await stats()).menus,0);
    assert.equal(await page.evaluate(()=>document.querySelector('#pet').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}))),false,'Browser context menu default is suppressed');
    assert.equal(await page.locator('#controls,.panel,button,input').count(),0);
    report.checks.push('plain right-click never opens UI');

    await page.mouse.down({button:'right'});await wheel(-100);
    await page.waitForFunction(count=>window.__zoomQA.requests.length>count,before);
    const growing=await stats();assert.ok(growing.scale>1,'Right+wheel up enlarges');assert.equal(growing.starts,0,'Right press cannot initiate left dragging');
    await wheel(100);await page.waitForTimeout(120);
    const restored=await stats();assert.ok(Math.abs(restored.scale-1)<1e-8,'Equal reverse wheel restores scale');
    await page.mouse.up({button:'right'});const afterRelease=await requestCount();await wheel(-100);await page.waitForTimeout(100);
    assert.equal(await requestCount(),afterRelease,'Releasing right mouse disables zoom immediately');
    report.checks.push('right wheel enlarges/shrinks and release stops');

    await page.mouse.down({button:'right'});
    await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await wheel(-100);await page.waitForTimeout(100);
    assert.equal(await requestCount(),afterRelease,'Blur cancels held right gesture');await page.mouse.up({button:'right'});
    report.checks.push('blur cancels zoom');
    await page.mouse.down({button:'right'});
    await page.evaluate(()=>document.querySelector('#pet').dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true})));
    await wheel(-100);await page.waitForTimeout(100);assert.equal(await requestCount(),afterRelease,'Pointer cancellation disables zoom');await page.mouse.up({button:'right'});
    report.checks.push('pointer cancellation cancels zoom');

    await page.evaluate(()=>{window.__zoomQA.setScale(1);window.__zoomQA.delay=true;});
    await page.mouse.down({button:'right'});
    const burstStart=await requestCount();
    await page.evaluate(()=>{const pet=document.querySelector('#pet');for(let i=0;i<40;i++)pet.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,clientX:210,clientY:220,buttons:2,bubbles:true,cancelable:true}));});
    await page.waitForTimeout(500);await page.mouse.up({button:'right'});
    await page.waitForFunction(()=>window.__zoomQA.pending===0);
    const burst=await page.evaluate(start=>({requests:window.__zoomQA.requests.slice(start),settings:window.elysiaPreview.settings(),host:window.__zoomQA.current()}),burstStart);
    assert.ok(burst.requests.length>0,'Rapid wheel burst reaches host');
    const steps=burst.requests.reduce((sum,item)=>sum+item.steps,0);
    assert.ok(steps>0);assert.ok(Math.abs(Math.log(burst.host.settings.scale)/Math.log(1.1)-steps)<1e-7,'Host applies every submitted relative step');
    assert.ok(Math.abs(burst.settings.scale/burst.host.settings.scale-1)<1e-9,'Stale replies cannot overwrite the latest scale');
    assert.ok(Math.abs(steps-40)<1e-8,`40 synchronous 100px wheel events retain all 40 increments; received ${steps}`);
    report.checks.push({name:'40 rapid wheel events with delayed acknowledgement',steps,requests:burst.requests.length,scale:burst.settings.scale});
    await page.evaluate(()=>window.__zoomQA.setScale(1));await page.mouse.down({button:'right'});await wheel(-100);
    await page.waitForFunction(()=>window.__zoomQA.pending>0);
    await page.evaluate(()=>window.__zoomQA.setScale(2));
    await page.waitForFunction(()=>window.__zoomQA.pending===0);await page.mouse.up({button:'right'});
    assert.equal((await stats()).scale,2,'A late wheel response cannot undo a newer tray setting');
    assert.equal(await page.evaluate(()=>window.elysiaPreview.viewport().scale),2,'A late wheel response cannot restore an old viewport');
    report.checks.push('newer tray scale and viewport survive late wheel reply');
    await page.evaluate(()=>{window.__zoomQA.delay=false;});

    for(const scale of [.01,1,10,100,10000,1e12]){
      await page.evaluate(scale=>window.__zoomQA.setScale(scale),scale);await page.waitForTimeout(150);
      const state=await stats();assert.equal(state.scale,scale,`${scale*100}% is not clamped to the old limits`);
      assert.ok(state.width<=840&&state.height<=1120,'Canvas allocation follows native viewport, never virtual character size');
      assert.ok(state.width>0&&state.height>0);assert.ok(state.visible>0,`Character remains visible at ${scale*100}%`);
      if(scale===.01)assert.ok(state.visible<=256,'Shrinking to 1% clears all old large-character pixels');
      assert.ok(state.region?.rects.length>0,`Hit shape remains available at ${scale*100}%`);
      assert.equal(state.region.space,'character');
      assert.equal(state.region.width,600);assert.equal(state.region.height,800);
      for(const rect of state.region.rects){
        assert.ok([rect.x,rect.y,rect.width,rect.height].every(Number.isFinite),'Native hit geometry remains finite');
        assert.ok(rect.x>=-1&&rect.y>=-1&&rect.x+rect.width<=state.region.width+1&&rect.y+rect.height<=state.region.height+1,'Canonical geometry never expands into huge virtual coordinates');
      }
      report.extremes.push({percent:scale*100,canvas:[state.width,state.height],visiblePixels:state.visible,hitRectangles:state.region.rects.length});
    }
    report.checks.push('1% through 100 trillion% bounded allocation and hit geometry');
    await page.setViewportSize({width:2560,height:1440});
    await page.evaluate(()=>window.__zoomQA.setScale(10000));await page.waitForTimeout(200);
    const highDpi=await stats();
    assert.ok(highDpi.width<=4096&&highDpi.height<=4096,'High DPI backing canvas respects maximum edge');
    assert.ok(highDpi.width*highDpi.height<=8*1024*1024,'High DPI backing canvas respects total pixel budget');
    assert.ok(highDpi.visible>0);
    report.checks.push({name:'2560x1440 at 2x DPI allocation budget',canvas:[highDpi.width,highDpi.height],pixels:highDpi.width*highDpi.height});
    await page.setViewportSize({width:420,height:560});
    await page.evaluate(()=>window.__zoomQA.setScale(.01));await page.mouse.down({button:'right'});await wheel(100);await page.waitForTimeout(100);await page.mouse.up({button:'right'});
    assert.equal((await stats()).scale,.01,'Minimum scale is 1%');report.checks.push('1% minimum remains operable');

    await page.evaluate(()=>window.__zoomQA.setScale(1));await page.mouse.move(210,220);await page.mouse.down();await page.mouse.move(225,235);
    assert.ok((await stats()).starts>0,'Left drag still starts after zoom');await page.mouse.up();assert.ok((await stats()).ends>0,'Left drag releases after zoom');
    report.checks.push('left drag remains usable after zoom');
    assert.equal((await stats()).menus,0);assert.equal(await page.locator('#controls,.panel,button,input').count(),0);
    assert.deepEqual(report.errors,[]);report.status='passed';
    console.log(JSON.stringify(report));
  }catch(error){report.status='failed';report.failure=error.stack;throw error;}
  finally{fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
