'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createWindowShape, MAX_SHAPE_RECTS } = require('../electron/window-shape.cjs');

function fixture() {
  const window = new EventEmitter();
  Object.assign(window, {
    bounds: { x: -800, y: -120, width: 600, height: 800 },
    display: { id: 1, scaleFactor: 1.65 }, destroyed: false, shapes: [],
    isDestroyed() { return this.destroyed; },
    getBounds() { return { ...this.bounds }; },
    getContentBounds() { return { ...this.bounds }; },
    setShape(rects) { this.shapes.push(structuredClone(rects)); this.emit('resize'); },
    show() { assert.fail('Shape updates must not reveal a hidden window'); },
    focus() { assert.fail('Shape updates must not steal focus'); },
    setIgnoreMouseEvents() { assert.fail('Explicit click-through is independently owned'); },
  });
  const screen = { getDisplayMatching() { return window.display; } };
  const shape = createWindowShape(window, { screen });
  return { window, screen, shape };
}
const packet = () => ({ width: 300, height: 400, rects: [{ x: 50, y: 80, width: 100, height: 200 }] });

test('clips CSS rectangles and rounds outward in DIP without doubling native DPI', () => {
  const { window, shape } = fixture();
  assert.equal(shape.update({ width: 300, height: 400, rects: [
    { x: -.25, y: 10.2, width: 20.7, height: 30.1 },
    { x: 290.1, y: 390.1, width: 20, height: 20 },
    { x: 500, y: 500, width: 10, height: 10 },
  ] }), true);
  assert.deepEqual(window.shapes, [[{ x: 0, y: 20, width: 41, height: 61 }, { x: 580, y: 780, width: 20, height: 20 }]]);
  assert.deepEqual(window.eventNames(), []);
});

test('free movement and redundant resize notifications reuse one native region', () => {
  const { window, shape } = fixture();
  assert.equal(shape.update(packet()), true);
  window.on('resize', () => shape.refresh());
  for (let i = 0; i < 120; i++) {
    window.bounds.x = -1500 + 30 * i;
    window.bounds.y = -1000 + 20 * i;
    window.emit('resize');
    assert.equal(shape.refresh(), true);
  }
  assert.equal(window.shapes.length, 1);
});

test('actual content resizing and monitor DPI transitions reapply cached DIP geometry', () => {
  const { window, shape } = fixture();
  shape.update(packet());
  window.bounds.width = 900;
  assert.equal(shape.refresh(), true);
  assert.deepEqual(window.shapes.at(-1), [{ x: 150, y: 160, width: 300, height: 400 }]);
  window.display = { id: 2, scaleFactor: 1.1 };
  shape.refresh();
  assert.equal(window.shapes.length, 3);
  assert.deepEqual(window.shapes[1], window.shapes[2], 'Electron, not the caller, converts the same DIP region at the new DPI');
  window.display.scaleFactor = 1.5;
  shape.refresh();
  assert.equal(window.shapes.length, 4);
});

test('duplicate and reordered rectangles are canonical and caller mutation cannot change stored geometry', () => {
  const { window, shape } = fixture(), original = packet();
  original.rects.push({ x: 10, y: 10, width: 10, height: 10 }, { ...original.rects[0] });
  shape.update(original);
  shape.update({ ...original, rects: [...original.rects].reverse() });
  assert.equal(window.shapes.length, 1);
  assert.equal(window.shapes[0].length, 2);
  original.rects[0].width = 1;
  original.width = 1;
  window.bounds.width = 900;
  shape.refresh();
  assert.deepEqual(window.shapes.at(-1), [{ x: 30, y: 20, width: 30, height: 20 }, { x: 150, y: 160, width: 300, height: 400 }]);
});

test('invalid or entirely clipped packets never restore the rectangular blocker or replace the last valid shape', () => {
  const { window, shape } = fixture();
  shape.update(packet());
  const invalid = [null, {}, { ...packet(), width: Infinity }, { ...packet(), height: 0 },
    { ...packet(), width: 32769 }, { ...packet(), rects: [] },
    { ...packet(), rects: Array(MAX_SHAPE_RECTS + 1).fill(packet().rects[0]) },
    { ...packet(), rects: [{ x: NaN, y: 0, width: 1, height: 1 }] },
    { ...packet(), rects: [{ x: 0, y: 0, width: -1, height: 1 }] },
    { ...packet(), rects: [{ x: 400, y: 500, width: 10, height: 10 }] }];
  for (const value of invalid) assert.equal(shape.update(value), false);
  assert.equal(window.shapes.length, 1);
  window.bounds.width = 900;
  shape.refresh();
  assert.deepEqual(window.shapes.at(-1), [{ x: 150, y: 160, width: 300, height: 400 }]);
});

test('a native failure does not mark a region as applied and can retry unchanged input', () => {
  const { window, shape } = fixture();
  shape.update(packet());
  const native = window.setShape;
  window.setShape = () => { throw new Error('native region failure'); };
  const next = { ...packet(), rects: [{ x: 0, y: 0, width: 50, height: 50 }] };
  assert.equal(shape.update(next), false);
  assert.deepEqual(window.shapes.at(-1), [{ x: 100, y: 160, width: 200, height: 400 }]);
  window.setShape = native;
  assert.equal(shape.refresh(), true);
  assert.deepEqual(window.shapes.at(-1), [{ x: 0, y: 0, width: 100, height: 100 }]);
  assert.equal(window.shapes.length, 2);
});

test('native resize callbacks cannot recursively apply a region before its cache commits', () => {
  const { window, shape } = fixture();
  window.on('resize', () => shape.refresh());
  assert.equal(shape.update(packet()), true);
  assert.equal(window.shapes.length, 1);
  window.bounds.height = 900;
  assert.equal(shape.refresh(), true);
  assert.equal(window.shapes.length, 2);
});

test('unsupported, destroyed and disposed windows stay inert without clearing a successful region', () => {
  const { window, shape } = fixture();
  assert.equal(shape.refresh(), false);
  const native = window.setShape;
  window.setShape = undefined;
  assert.equal(shape.update(packet()), false);
  window.setShape = native;
  assert.equal(shape.refresh(), true);
  window.destroyed = true;
  assert.equal(shape.refresh(), false);
  window.destroyed = false;
  shape.dispose(); shape.dispose();
  assert.equal(shape.disposed, true);
  assert.equal(shape.refresh(), false);
  assert.equal(shape.update(packet()), false);
  assert.equal(window.shapes.length, 1);
});
