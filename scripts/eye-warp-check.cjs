'use strict';

// Compare the configurable renderer against the preserved original radial shader
// on hardware WebGL. Reference meshes keep identical geometry/texture sampling.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createServer } = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'artifacts', 'eye-warp-check');
const sources = ['renderer/mesh-rig.mjs', 'renderer/gaze-settings.mjs', 'renderer/faithful-character.mjs', 'renderer/state.mjs'];
const hashes = () => Object.fromEntries(sources.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
// Frozen before adding the amplitude preference. Do not derive this shader
// from the new configurable fragment, or the equivalence test becomes circular.
const LEGACY_FRAGMENT = `
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_gaze;
varying vec2 v_uv;
void main() {
  vec2 p = v_uv*vec2(1090.0,1443.0);
  float l=1.0-smoothstep(0.15,1.0,length((p-vec2(413.0,556.0))/vec2(48.0,61.0)));
  float r=1.0-smoothstep(0.15,1.0,length((p-vec2(647.0,519.0))/vec2(57.0,66.0)));
  vec2 sampleUV=(p-u_gaze*vec2(7.0,5.0)*(l+r))/vec2(1090.0,1443.0);
  gl_FragColor=texture2D(u_image,sampleUV);
}`;
const server = createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><body></body></html>'); return; }
    const filename = path.resolve(root, `.${pathname}`);
    if (!filename.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    response.setHeader('Content-Type', { '.mjs': 'text/javascript', '.png': 'image/png' }[path.extname(filename)] || 'application/octet-stream');
    response.end(fs.readFileSync(filename));
  } catch { response.writeHead(404).end(); }
});

async function audit(page) {
  return page.evaluate(async legacyFragment => {
    const { loadCharacter, composeCharacterFrame, drawCharacter } = await import('/renderer/faithful-character.mjs');
    const { createPetState, advance } = await import('/renderer/state.mjs');
    const meshUrl = new URL('/renderer/mesh-rig.mjs', location.href).href;
    const meshCode = await (await fetch(meshUrl)).text();
    const reference = async fragment => {
      if (!/const fragmentSource\s*=\s*`[\s\S]*?`;/.test(meshCode)) throw new Error('Cannot locate production fragment shader for reference mesh');
      const code = meshCode.replace(/const fragmentSource\s*=\s*`[\s\S]*?`;/, `const fragmentSource = ${JSON.stringify(fragment)};`)
        .replace(/from\s+(['"])(\.[^'"]+)\1/g, (_, quote, name) => `from ${JSON.stringify(new URL(name, meshUrl).href)}`);
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      try { return (await import(url)).createMeshRig(); } finally { URL.revokeObjectURL(url); }
    };
    const atlas = await loadCharacter();
    const old = await reference(legacyFragment);
    const doubled = await reference(legacyFragment.replace('u_gaze*vec2(7.0,5.0)', 'u_gaze*vec2(14.0,10.0)'));
    const checks = [], appearances = [], closed = [], stateChecks = [];
    const check = (name, passed, details = {}) => checks.push({ name, passed: !!passed, ...details });
    const probe = document.createElement('canvas').getContext('webgl');
    const debug = probe?.getExtension('WEBGL_debug_renderer_info');
    const renderer = debug ? probe.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null;
    check('Production and frozen reference render on hardware WebGL', atlas.mesh.accelerated && old.accelerated && doubled.accelerated
      && renderer && !/swiftshader|llvmpipe|software|basic render/i.test(renderer), { renderer });
    if (!checks[0].passed) return { passed: false, checks, appearances, closed, sheets: [] };
    const W = 1090, H = 1443;
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const small = document.createElement('canvas'); small.width = 600; small.height = 800;
    const smallContext = small.getContext('2d', { willReadFrequently: true });
    const nativeRead = CanvasRenderingContext2D.prototype.getImageData;
    const counters = { canvas2d: 0, webgl: 0, uploads: 0 }, restores = [];
    const monitor = (proto, name, count) => {
      if (!proto?.[name]) return;
      const original = proto[name]; proto[name] = function (...args) { counters[count]++; return original.apply(this, args); };
      restores.push(() => { proto[name] = original; });
    };
    monitor(CanvasRenderingContext2D.prototype, 'getImageData', 'canvas2d');
    for (const proto of [window.WebGLRenderingContext?.prototype, window.WebGL2RenderingContext?.prototype]) {
      monitor(proto, 'readPixels', 'webgl'); monitor(proto, 'texImage2D', 'uploads');
    }
    const settings = { hairMotion: false, eyeTracking: true };
    let frames = 0;
    function capture(mesh, source, key, state, preference = {}) {
      ctx.clearRect(0, 0, W, H); ctx.drawImage(mesh.draw(source, key, state, { ...settings, ...preference }, true), 0, 0);
      frames++;
      return nativeRead.call(ctx, 0, 0, W, H).data;
    }
    function differences(a, b, tolerance = 0, width = W) {
      let pixels = 0, maximum = 0, first = null;
      for (let i = 0; i < a.length; i += 4) {
        const delta = Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]),Math.abs(a[i+3]-b[i+3]));
        maximum = Math.max(maximum, delta);
        if (delta > tolerance) { pixels++; first ??= { x:(i/4)%width,y:Math.floor(i/4/width),delta }; }
      }
      return { pixels, maximum, first };
    }
    const sheet = document.createElement('canvas'); sheet.width = 1500; sheet.height = 730;
    const sheetCtx = sheet.getContext('2d'); sheetCtx.fillStyle = '#f8f3f7'; sheetCtx.fillRect(0,0,sheet.width,sheet.height);
    const tile = (col, row, label) => {
      sheetCtx.drawImage(canvas,285,365,470,320,col*500+15,row*365+35,470,320);
      sheetCtx.fillStyle='#49243d';sheetCtx.font='18px sans-serif';sheetCtx.fillText(label,col*500+15,row*365+25);
    };
    const cases = [
      { pose:'idle',expression:null,cat:false,glasses:false },
      { pose:'idle',expression:'heart',cat:true,glasses:true },
      { pose:'tea',expression:'blush',cat:false,glasses:true },
      { pose:'cake',expression:null,cat:true,glasses:false },
      { pose:'megaphone',expression:'blush',cat:true,glasses:true },
    ];
    const vectors = [[-1,-1],[1,1],[-1,.4],[.35,-.8],[0,0]];
    try {
      for (const appearance of cases) {
        const state = { ...createPetState(), ...appearance, time:0,motionTime:0 };
        const source = composeCharacterFrame(atlas.images,state,false), key=JSON.stringify(appearance);
        const neutral = capture(old,source,key,state);
        const directions = [];
        for (const [x,y] of vectors) {
          state.gaze={x,y};
          const previousState=JSON.stringify(state.gaze);
          const oldPixels=capture(old,source,key,state);
          const oldDouble=capture(doubled,source,key,state);
          const strengthOne=capture(atlas.mesh,source,key,state,{eyeWarpStrength:1});
          const defaultDiff=differences(oldPixels,capture(atlas.mesh,source,key,state));
          const oneDiff=differences(oldPixels,strengthOne);
          const strengthTwo=capture(atlas.mesh,source,key,state,{eyeWarpStrength:2});
          const twoDiff=differences(oldDouble,strengthTwo);
          const oldHalf=capture(old,source,key,{...state,gaze:{x:x/2,y:y/2}});
          const halfDiff=differences(oldHalf,capture(atlas.mesh,source,key,state,{eyeWarpStrength:.5}));
          const zeroDiff=differences(neutral,capture(atlas.mesh,source,key,state,{eyeWarpStrength:0}));
          const offDiff=differences(neutral,capture(atlas.mesh,source,key,state,{eyeWarpStrength:2,eyeTracking:false}));
          const lowClampDiff=differences(neutral,capture(atlas.mesh,source,key,state,{eyeWarpStrength:-20}));
          const highClampDiff=differences(strengthTwo,capture(atlas.mesh,source,key,state,{eyeWarpStrength:20}));
          const absentDefaultDiff=differences(oldPixels,capture(atlas.mesh,source,key,state,{eyeWarpStrength:undefined}));
          directions.push({x,y,oneDiff,defaultDiff,twoDiff,halfDiff,zeroDiff,offDiff,lowClampDiff,highClampDiff,absentDefaultDiff,
            gazeStateUnchanged:JSON.stringify(state.gaze)===previousState,changedAtTwo:differences(neutral,strengthTwo).pixels});
        }
        const before={...counters};
        for(let i=0;i<72;i++) {
          state.gaze={x:Math.sin(i*.21),y:Math.cos(i*.27)};
          atlas.mesh.draw(source,key,state,{...settings,eyeWarpStrength:(i%21)/10},true);
        }
        const extraCalls=Object.fromEntries(Object.keys(counters).map(name=>[name,counters[name]-before[name]]));
        appearances.push({...appearance,directions,extraCalls});
        if(appearance.pose==='idle') {
          state.gaze={x:1,y:-1};
          for(const [col,strength] of [0,1,2].entries()) {
            capture(atlas.mesh,source,key,state,{eyeWarpStrength:strength});
            tile(col,appearance.expression?1:0,`${appearance.expression||'neutral'} / ${strength*100}%`);
          }
        }
      }
      const failures=[];
      for(const a of appearances)for(const d of a.directions){
        if(['oneDiff','defaultDiff','twoDiff','halfDiff','zeroDiff','offDiff','lowClampDiff','highClampDiff','absentDefaultDiff'].some(name=>d[name].pixels)
          || !d.gazeStateUnchanged || ((d.x||d.y)&&!d.changedAtTwo))failures.push({pose:a.pose,expression:a.expression,...d});
      }
      check('0%, 50%, 100%, 200% match the frozen radial formula exactly; limits and off are honored',failures.length===0,{failures});
      check('Uniform-only changes and pointer updates cause no application readbacks or texture uploads',
        appearances.every(a=>Object.values(a.extraCalls).every(value=>value===0)),{failures:appearances.filter(a=>Object.values(a.extraCalls).some(Boolean))});
      const closedCases=[
        {pose:'idle',expression:null,blink:1},{pose:'idle',expression:'sleep',blink:0},
        {pose:'tea',expression:'smile',blink:0},{pose:'cake',expression:'wink',blink:0},
        {pose:'megaphone',expression:null,blink:0},{pose:'idle',expression:'cry',blink:0},
      ];
      for(const appearance of closedCases){
        const state={...createPetState(),...appearance,cat:true,glasses:true,time:0,motionTime:0,gaze:{x:1,y:-1}};
        drawCharacter(smallContext,atlas,state,{...settings,eyeWarpStrength:0});
        const baseline=nativeRead.call(smallContext,0,0,600,800).data;
        drawCharacter(smallContext,atlas,state,{...settings,eyeWarpStrength:2});
        const actual=nativeRead.call(smallContext,0,0,600,800).data;
        closed.push({...appearance,...differences(baseline,actual,0,600)});frames+=2;
      }
      check('Blink and special expressions remain unchanged at maximum eye warp',closed.every(a=>!a.pixels),{failures:closed.filter(a=>a.pixels)});
      const state=createPetState();state.target={x:.8,y:-.35};state.nextBlink=Infinity;
      for(const strength of [0,.5,1,2]) {
        advance(state,.016,{eyeTracking:true,eyeWarpStrength:strength});
        stateChecks.push({strength,gaze:{...state.gaze},unchanged:state.gaze.x===.8&&state.gaze.y===-.35});
      }
      check('Amplitude never rescales or delays the pointer state response',stateChecks.every(a=>a.unchanged),{stateChecks});
      return {passed:checks.every(a=>a.passed),checks,renderer,frames,appearances,closed,stateChecks,counters,
        sheets:[{name:'amplitude-comparison.png',data:sheet.toDataURL('image/png')}]};
    }finally{for(const restore of restores.reverse())restore();probe.getExtension('WEBGL_lose_context')?.loseContext();}
  },LEGACY_FRAGMENT);
}

(async()=>{
  const started=performance.now();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try {
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const before=hashes(),result=await audit(page),after=hashes();
    const stable=JSON.stringify(before)===JSON.stringify(after);
    result.checks.push({name:'Renderer sources were stable throughout the comparison',passed:stable});
    result.passed&&=stable&&errors.length===0;result.browserErrors=errors;result.sourceHashes=after;result.elapsedMs=performance.now()-started;
    fs.mkdirSync(outputDir,{recursive:true});
    for(const sheet of result.sheets)fs.writeFileSync(path.join(outputDir,sheet.name),Buffer.from(sheet.data.split(',')[1],'base64'));
    result.sheets=result.sheets.map(sheet=>path.join(outputDir,sheet.name));
    const output=path.join(outputDir,'report.json');fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify({passed:result.passed,frames:result.frames,appearances:result.appearances.length,
      checks:result.checks.map(({name,passed,failures})=>({name,passed,failures:failures?.length})),elapsedMs:result.elapsedMs,output}));
    if(!result.passed)process.exitCode=1;
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
