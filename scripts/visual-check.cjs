/** Tray-only selections, renderer appearance, settings persistence and startup races. */
'use strict';
const { createServer } = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { DEFAULT_SETTINGS, sanitizeSettings, sanitizeAppearance } = require('../electron/host-policy.cjs');
const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'artifacts');
fs.mkdirSync(destination, { recursive: true });
const types = { '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((request, response) => {
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  try { response.setHeader('Content-Type', types[path.extname(file)] || 'text/plain'); response.end(fs.readFileSync(file)); }
  catch { response.writeHead(404).end(); }
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 420, height: 560 }, deviceScaleFactor: 2 });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(defaults => {
      const callbacks = {}, host = { settings: { ...defaults }, hotkeys: { legacy: { active: false } } };
      const qa = window.__visualQA = {
        menus: 0, appearance: null,
        action: action => callbacks.action(action),
        settings(patch) { Object.assign(host.settings, patch); callbacks.settings(structuredClone(host)); },
      };
      window.elysiaDesktop = {
        getState: async () => structuredClone(host),
        onPointer(callback) { callbacks.pointer = callback; }, onDragState() {},
        onAction(callback) { callbacks.action = callback; }, onSettings(callback) { callbacks.settings = callback; },
        setSettings: async patch => { Object.assign(host.settings, patch); return structuredClone(host); },
        setAppearance(value) { qa.appearance = structuredClone(value); },
        setHitRegion: async () => true, dragStart() {}, dragEnd() {},
        showMenu() { qa.menus++; }, quit() {},
      };
    }, DEFAULT_SETTINGS);
    await page.goto(`http://127.0.0.1:${server.address().port}/renderer/index.html`);
    await page.waitForSelector('html[data-ready="true"]');
    const savedNames = [];
    const save = async (name, options = {}) => {
      const data = await page.evaluate(options => window.elysiaPreview.render(options), options);
      fs.writeFileSync(path.join(destination, name + '.png'), Buffer.from(data.split(',')[1], 'base64'));
      savedNames.push(name);
    };
    const snapshot = () => page.evaluate(() => { const {expression,pose,cat,glasses} = window.elysiaPreview.snapshot(); return {expression,pose,cat,glasses}; });
    const act = action => page.evaluate(action => window.__visualQA.action(action), action);
    const assertNoPanel = async () => assert.equal(await page.locator('#controls, .panel, .quickbar, button, input, [data-expression], [data-skin], [data-pose]').count(), 0, 'No settings panel or controls exist in the desktop DOM');
    await save('pet-default'); await save('pet-megaphone', { pose: 'megaphone' });
    await assertNoPanel();
    await page.locator('#pet').hover(); await assertNoPanel();
    await page.locator('#pet').click({ button: 'right' }); await assertNoPanel();
    await page.locator('#pet').dblclick(); await assertNoPanel();
    for (const type of ['show-controls', 'toggle-controls']) await act({type});
    await assertNoPanel();
    assert.equal(await page.evaluate(() => window.__visualQA.menus), 0, 'Right-click and double-click never open a menu');
    const expressions = await page.evaluate(async () => (await import('./state.mjs')).EXPRESSIONS.map(({id}) => id));
    assert.equal(expressions.length, 10);
    for (const removed of ['pat', 'squint', 'star', 'cat', 'glasses', 'cake', 'tea']) assert.ok(!expressions.includes(removed));
    await act({type:'toggle-skin',id:'cat'}); await act({type:'toggle-skin',id:'glasses'}); await act({type:'pose',id:'tea'});
    for (const id of expressions) {
      await act({type:'expression',id});
      assert.deepEqual(await snapshot(), { expression: id, pose: 'tea', cat: true, glasses: true }, 'Tray expression keeps pose and skins');
      await save('expression-' + id, { expression: id });
      await act({type:'expression',id});
      assert.deepEqual(await snapshot(), { expression: null, pose: 'tea', cat: true, glasses: true });
    }
    await act({type:'expression',id:'heart'});
    for (const pose of ['idle','megaphone','cake','tea']) {
      await act({type:'pose',id:pose}); await act({type:'pose',id:pose});
      assert.deepEqual(await snapshot(), { expression:'heart',pose,cat:true,glasses:true });
      await save('combination-' + pose, { expression:'heart',pose,cat:true,glasses:true });
    }
    await act({type:'toggle-skin',id:'cat'});
    assert.deepEqual(await snapshot(), { expression:'heart',pose:'tea',cat:false,glasses:true });
    await act({type:'reset'});
    assert.deepEqual(await snapshot(), { expression:null,pose:'idle',cat:false,glasses:false });
    await page.keyboard.down('Space'); await page.keyboard.press('Digit1'); await page.keyboard.press('F1'); await page.keyboard.press('F5'); await page.keyboard.up('Space');
    assert.deepEqual(await snapshot(), { expression:'blush',pose:'cake',cat:true,glasses:false });
    await act({type:'reset'});
    for (const key of ['eyeTracking','hairMotion','alwaysOnTop','legacyHotkeys','alternateHotkeys','clickThrough']) {
      for (const value of [false,true]) {
        await page.evaluate(({key,value}) => window.__visualQA.settings({[key]:value}), {key,value});
        assert.equal(await page.evaluate(key => window.elysiaPreview.settings()[key], key), value, `Tray preference ${key} updates renderer`);
        await assertNoPanel();
      }
    }
    await page.evaluate(() => window.__visualQA.settings({clickThrough:false,alternateHotkeys:false}));
    await page.keyboard.down('Space'); await page.keyboard.press('Digit6'); await page.keyboard.up('Space');
    assert.equal((await snapshot()).expression,'wink');
    await page.locator('#pet').click();
    assert.equal((await snapshot()).expression,'wink','Click does not select removed head-pat expression');
    await page.mouse.move(410,20); await page.waitForTimeout(200);
    const gaze = await page.evaluate(() => window.elysiaPreview.snapshot().gaze);
    assert.ok(gaze.x > 0 && gaze.y < 0);
    assert.equal(await page.evaluate(() => window.elysiaPreview.rendering.mode), 'mesh');
    await page.screenshot({path:path.join(destination,'pet-live.png'),omitBackground:true});
    assert.deepEqual(errors,[]);

    // Delayed host acknowledgements must never restore an old skin or open UI.
    const persistence = await browser.newPage({viewport:{width:420,height:560}});
    persistence.on('pageerror',error=>errors.push(error.message));
    let persistedSettings={...DEFAULT_SETTINGS,cat:true,glasses:true},menuAppearance,initialSkinToggle=true,pendingWrites=0;
    const hostSnapshot=()=>({settings:structuredClone(persistedSettings),hotkeys:{legacy:{active:false}}});
    await persistence.exposeFunction('testHostRead',async()=>{const snapshot=hostSnapshot();await new Promise(resolve=>setTimeout(resolve,60));return snapshot;});
    await persistence.exposeFunction('testHostWrite',async patch=>{
      pendingWrites++;persistedSettings=sanitizeSettings(patch,persistedSettings);const snapshot=hostSnapshot();
      await new Promise(resolve=>setTimeout(resolve,patch.cat||patch.glasses?50:5));pendingWrites--;return snapshot;
    });
    await persistence.exposeFunction('testHostAppearance',value=>{menuAppearance=sanitizeAppearance(value);});
    await persistence.exposeFunction('testEarlyToggle',()=>{const result=initialSkinToggle;initialSkinToggle=false;return result;});
    await persistence.addInitScript(()=>{
      let onAction;
      window.elysiaDesktop={
        getState:async()=>{const snapshot=window.testHostRead();if(await window.testEarlyToggle())onAction({type:'toggle-skin',id:'cat'});return snapshot;},
        onPointer(){},onSettings(callback){window.testSettings=callback;},onAction(callback){onAction=callback;window.testAction=callback;},
        setSettings:patch=>window.testHostWrite(patch),setAppearance:value=>window.testHostAppearance(value),
        dragStart(){},dragEnd(){},showMenu(){throw new Error('Unexpected character menu');},quit(){},
      };
    });
    await persistence.goto(`http://127.0.0.1:${server.address().port}/renderer/index.html`);
    await persistence.waitForSelector('html[data-ready="true"]');
    let restored=await persistence.evaluate(()=>window.elysiaPreview.snapshot());
    assert.equal(restored.cat,false,'Startup shortcut applies after saved skin restoration');assert.equal(restored.glasses,true);
    await persistence.evaluate(()=>{
      window.testAction({type:'toggle-skin',id:'cat'});window.testAction({type:'pose',id:'cake'});window.testAction({type:'expression',id:'angry'});window.testAction({type:'reset'});
    });
    await persistence.waitForTimeout(120);assert.equal(pendingWrites,0);
    assert.equal(persistedSettings.cat,false);assert.equal(persistedSettings.glasses,false);
    assert.deepEqual(menuAppearance,{expression:null,pose:'idle',cat:false,glasses:false},'Late acknowledgements cannot undo reset');
    await persistence.reload();await persistence.waitForSelector('html[data-ready="true"]');
    restored=await persistence.evaluate(()=>window.elysiaPreview.snapshot());
    assert.equal(restored.cat,false);assert.equal(restored.glasses,false);assert.equal(restored.pose,'idle');assert.equal(restored.expression,null);
    await persistence.evaluate(()=>{window.testAction({type:'toggle-skin',id:'cat'});window.testAction({type:'toggle-skin',id:'glasses'});});
    await persistence.waitForTimeout(120);
    const savedPreferences={eyeTracking:false,hairMotion:false,alwaysOnTop:false,legacyHotkeys:false,alternateHotkeys:true,clickThrough:true,scale:10};
    persistedSettings=sanitizeSettings(savedPreferences,persistedSettings);
    await persistence.evaluate(snapshot=>window.testSettings(snapshot),hostSnapshot());
    await persistence.reload();await persistence.waitForSelector('html[data-ready="true"]');
    restored=await persistence.evaluate(()=>window.elysiaPreview.snapshot());
    assert.equal(restored.cat,true);assert.equal(restored.glasses,true);
    const restoredSettings=await persistence.evaluate(()=>window.elysiaPreview.settings());
    for(const [key,value] of Object.entries(savedPreferences))assert.equal(restoredSettings[key],value,`Saved ${key} survives restart`);
    assert.equal(await persistence.locator('#controls, .panel, button, input').count(),0,'Restart never recreates controls');
    await persistence.close();assert.deepEqual(errors,[]);

    const contact=await browser.newPage({viewport:{width:1200,height:1300},deviceScaleFactor:1});
    await contact.setContent(`<html><body style="margin:0;background:#f6eff6;font-family:'Segoe UI','Microsoft Yahei',sans-serif"><div style="padding:28px;display:grid;grid-template-columns:repeat(5,1fr);gap:12px">${savedNames.map(name=>`<figure style="margin:0;background:white;border-radius:15px;padding:10px;text-align:center"><img style="height:240px;max-width:100%;object-fit:contain" src="data:image/png;base64,${fs.readFileSync(path.join(destination,name+'.png')).toString('base64')}"><figcaption style="font-size:12px;color:#84617d">${name.replace('expression-','')}</figcaption></figure>`).join('')}</div></body></html>`);
    await contact.evaluate(()=>Promise.all([...document.images].map(image=>image.decode())));
    await contact.screenshot({path:path.join(destination,'expressions-overview.png'),fullPage:true});
    const report={visual:'ok',trayOnly:true,desktopControls:0,characterPopupMenus:0,expressions:10,skins:2,poses:4,independentSelections:true,restoredSkins:true,restoredPreferences:true,resetRace:'passed',browserErrors:errors,gaze,screenshots:destination};
    fs.writeFileSync(path.join(destination,'visual-check.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());