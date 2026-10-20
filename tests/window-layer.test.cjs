'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createTopmostController, REASSERT_INTERVAL_MS } = require('../electron/window-layer.cjs');

class FakeWindow extends EventEmitter {
  constructor({ visible = true, minimized = false } = {}) {
    super(); this.visible = visible; this.minimized = minimized; this.destroyed = false;
    this.calls = []; this.topmost = false;
  }
  isDestroyed() { return this.destroyed; }
  isVisible() { return this.visible; }
  isMinimized() { return this.minimized; }
  setAlwaysOnTop(...args) { this.calls.push(['topmost', ...args]); this.topmost = args[0]; }
  moveTop() { this.calls.push(['raise']); }
  focus() { assert.fail('Topmost maintenance must not take keyboard focus'); }
  show() { assert.fail('Topmost maintenance must not show a hidden window'); }
  restore() { assert.fail('Topmost maintenance must not restore a minimized window'); }
}
function fixture(windowOptions = {}, options = {}) {
  const window = new FakeWindow(windowOptions), timers = new Set(), scheduled = [];
  const controller = createTopmostController(window, { ...options,
    setInterval(fn, ms) { const timer = { fn, ms, unreferenced: false, unref() { this.unreferenced = true; } }; timers.add(timer); scheduled.push(timer); return timer; },
    clearInterval(timer) { timers.delete(timer); },
  });
  return { window, controller, timers, scheduled, tick() { for (const t of [...timers]) t.fn(); } };
}

test('reasserts the supported Windows level without activation and only one unreferenced timer', () => {
  const f = fixture();
  assert.deepEqual(f.window.calls, [['topmost', true, 'screen-saver'], ['raise']]);
  assert.equal(f.timers.size, 1);
  assert.equal(f.scheduled[0].ms, REASSERT_INTERVAL_MS);
  assert.equal(f.scheduled[0].unreferenced, true);
  f.window.calls.length = 0;
  // Another topmost app can cover the pet without changing isAlwaysOnTop().
  f.window.topmost = true; f.tick();
  assert.deepEqual(f.window.calls, [['topmost', true, 'screen-saver'], ['raise']]);
  assert.equal(f.scheduled.length, 1);
  for (const event of ['show', 'restore', 'blur', 'leave-full-screen']) f.window.emit(event);
  assert.equal(f.timers.size, 1);
  f.controller.dispose();
});

test('a hidden or minimized pet is never shown by moveTop or polled', () => {
  const f = fixture({ visible: false });
  assert.deepEqual(f.window.calls, [['topmost', true, 'screen-saver']]); assert.equal(f.timers.size, 0);
  assert.equal(f.window.topmost, true); f.window.calls.length = 0;
  f.window.emit('blur'); assert.deepEqual(f.window.calls, []);
  f.window.visible = true; f.window.emit('show');
  assert.equal(f.timers.size, 1);
  const stale = f.scheduled[0].fn;
  f.window.visible = false; f.window.emit('hide');
  assert.equal(f.timers.size, 0); f.window.calls.length = 0; stale();
  assert.deepEqual(f.window.calls, []);
  f.window.visible = true; f.window.minimized = true; f.window.emit('show');
  assert.equal(f.timers.size, 0); assert.deepEqual(f.window.calls, []);
  f.window.minimized = false; f.window.emit('restore'); assert.equal(f.timers.size, 1);
  f.window.minimized = true; f.window.emit('minimize'); assert.equal(f.timers.size, 0);
  f.controller.dispose();
});

test('hidden preference toggles update native topmost without showing or starting a timer', () => {
  const f = fixture({ visible: false }, { enabled: false });
  f.window.calls.length = 0;
  f.controller.setEnabled(true);
  assert.equal(f.window.topmost, true); assert.equal(f.window.visible, false);
  assert.deepEqual(f.window.calls, [['topmost', true, 'screen-saver']]);
  assert.equal(f.timers.size, 0); assert.equal(f.scheduled.length, 0);
  f.controller.setEnabled(false);
  assert.equal(f.window.topmost, false); assert.equal(f.window.visible, false);
  assert.equal(f.timers.size, 0); assert.equal(f.scheduled.length, 0);
  f.controller.dispose();
});

test('disabling topmost wins over stale timer callbacks and lifecycle events', () => {
  const f = fixture(), stale = f.scheduled[0].fn;
  f.window.calls.length = 0; f.controller.setEnabled(false);
  assert.equal(f.controller.enabled, false); assert.equal(f.timers.size, 0);
  assert.deepEqual(f.window.calls, [['topmost', false]]);
  for (const event of ['show', 'restore', 'blur']) f.window.emit(event);
  stale(); f.controller.refresh(); f.controller.setEnabled(false);
  assert.deepEqual(f.window.calls, [['topmost', false]]);
  f.controller.setEnabled(true); f.controller.setEnabled(true);
  assert.equal(f.timers.size, 1); assert.equal(f.scheduled.length, 2);
  f.controller.dispose();
});

test('initially disabled controller remains disabled even on show and restore', () => {
  const f = fixture({}, { enabled: false });
  assert.deepEqual(f.window.calls, [['topmost', false]]);
  f.window.emit('show'); f.window.emit('restore'); f.window.emit('blur');
  assert.equal(f.timers.size, 0); assert.deepEqual(f.window.calls, [['topmost', false]]);
  f.controller.dispose();
});

test('duplicate factories and repeated disposal cannot leak listeners or timers', () => {
  const f = fixture(), count = f.window.eventNames().map(e => [e, f.window.listenerCount(e)]);
  assert.equal(createTopmostController(f.window, { enabled: false }), f.controller);
  assert.deepEqual(f.window.eventNames().map(e => [e, f.window.listenerCount(e)]), count);
  assert.equal(f.timers.size, 1);
  f.controller.dispose(); f.controller.dispose();
  assert.equal(f.controller.disposed, true); assert.equal(f.timers.size, 0);
  assert.deepEqual(f.window.eventNames(), []);
  f.window.calls.length = 0;
  f.scheduled[0].fn(); f.controller.refresh(); f.controller.setEnabled(true);
  assert.deepEqual(f.window.calls, []);
});

test('destroying the native window releases maintenance without native calls after close', () => {
  const f = fixture(), stale = f.scheduled[0].fn;
  f.window.destroyed = true; f.window.calls.length = 0; f.window.emit('closed');
  assert.equal(f.timers.size, 0); assert.equal(f.controller.disposed, true);
  stale(); f.controller.dispose(); assert.deepEqual(f.window.calls, []);
  assert.deepEqual(f.window.eventNames(), []);
});

test('native destruction during a maintenance call is caught and cleaned up', () => {
  const f = fixture(); f.window.calls.length = 0;
  f.window.setAlwaysOnTop = () => { f.window.destroyed = true; throw new Error('Object has been destroyed'); };
  assert.doesNotThrow(() => f.tick());
  assert.equal(f.controller.disposed, true); assert.equal(f.timers.size, 0);
  assert.deepEqual(f.window.calls, []); assert.deepEqual(f.window.eventNames(), []);
});

test('native failures are reported without creating a busy retry loop', () => {
  const errors = [], f = fixture({}, { intervalMs: 1, onError: error => errors.push(error.message) });
  assert.equal(f.scheduled[0].ms, 500);
  f.window.moveTop = () => { throw new Error('Native reorder failed'); };
  assert.equal(f.controller.refresh(), false);
  assert.deepEqual(errors, ['Native reorder failed']); assert.equal(f.timers.size, 1); assert.equal(f.scheduled.length, 1);
  f.controller.dispose();
});
