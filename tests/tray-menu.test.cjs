'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {trayTemplate}=require('../electron/tray-menu.cjs');

test('the sample tray has only settings and exit, with no appearance or preference submenus',()=>{
  const calls=[];
  const menu=trayTemplate({openSettings:()=>calls.push('settings'),quit:()=>calls.push('quit')});
  assert.deepEqual(menu.map(item=>item.label),['设置','退出']);
  assert.equal(menu.some(item=>item.submenu||item.type==='separator'||item.type==='checkbox'),false);
  menu[0].click();assert.deepEqual(calls,['settings']);
  menu[1].click();assert.deepEqual(calls,['settings','quit']);
});
