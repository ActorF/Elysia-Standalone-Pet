'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {trayTemplate}=require('../electron/tray-menu.cjs');
const {DEFAULT_SETTINGS,sanitizeAppearance}=require('../electron/host-policy.cjs');
test('the tray exposes every persistent switch, expression, skin and pose without a panel action',()=>{
  const calls=[],settings={...DEFAULT_SETTINGS};
  const template=trayTemplate({settings,appearance:sanitizeAppearance(),action:action=>calls.push(action),updateSettings:patch=>calls.push(patch),recover:reset=>calls.push({recover:reset}),resize:scale=>calls.push({scale}),quit:()=>calls.push('quit')});
  assert.equal(JSON.stringify(template).includes('show-controls'),false);
  const toggles=template.filter(item=>item.type==='checkbox');
  assert.equal(toggles.length,7);
  for(const item of toggles)item.click({checked:false});
  assert.deepEqual(new Set(calls.flatMap(Object.keys)),new Set(['eyeTracking','hairMotion','keyDisplay','alwaysOnTop','clickThrough','legacyHotkeys','alternateHotkeys']));
  const submenus=template.filter(item=>item.submenu);
  assert.equal(submenus[0].submenu.length,10);assert.equal(submenus[1].submenu.length,2);assert.equal(submenus[2].submenu.length,4);
  for(const menu of submenus.slice(0,3))for(const item of menu.submenu)item.click();
  assert.equal(calls.filter(item=>item.type==='expression').length,10);
  assert.equal(calls.filter(item=>item.type==='toggle-skin').length,2);
  assert.equal(calls.filter(item=>item.type==='pose').length,4);
  template[1].click();assert.deepEqual(calls.at(-1),{recover:true});
});
test('tray zoom offers one percent and arbitrary continued growth past presets',()=>{
  const sizes=[];
  const template=trayTemplate({settings:{...DEFAULT_SETTINGS,scale:10000},appearance:sanitizeAppearance(),resize:scale=>sizes.push(scale)});
  const sizeMenu=template.find(item=>item.label?.startsWith('大小：'));
  assert.ok(sizeMenu);
  sizeMenu.submenu.find(item=>item.label==='1%').click();
  sizeMenu.submenu.find(item=>item.label==='放大一倍').click();
  assert.deepEqual(sizes,[.01,20000]);
});
