// Check that the renderer bridge never exposes raw IPC events or unrestricted channel access.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('preload keeps event metadata private and removes subscriptions cleanly', () => {
  const listeners = new Map();
  const invocations = [];
  let exposedName, bridge;
  const fakeElectron = {
    contextBridge: { exposeInMainWorld(name, api) { exposedName = name; bridge = api; } },
    ipcRenderer: {
      on(channel, listener) { listeners.set(channel, listener); },
      removeListener(channel, listener) { if (listeners.get(channel) === listener) listeners.delete(channel); },
      invoke(...args) { invocations.push(args); return Promise.resolve({}); },
      send(...args) { invocations.push(args); },
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8'), {
    require(name) { assert.equal(name, 'electron'); return fakeElectron; },
  });
  assert.equal(exposedName, 'elysiaDesktop');
  assert.equal(bridge.send, undefined);
  assert.equal(bridge.invoke, undefined);
  let received;
  const unsubscribe = bridge.onPointer((...args) => { received = args; });
  const payload = { localX: 12, localY: 34 };
  listeners.get('pet:pointer')({ sender: 'must remain hidden' }, payload);
  assert.deepEqual(received, [payload]);
  unsubscribe();
  assert.equal(listeners.has('pet:pointer'), false);
  bridge.setSettings({ clickThrough: true });
  bridge.setAppearance({ cat: true, pose: 'tea' });
  bridge.showMenu();
  assert.deepEqual(invocations, [['pet:set-settings', { clickThrough: true }], ['pet:set-appearance', { cat: true, pose: 'tea' }], ['pet:menu']]);
});
