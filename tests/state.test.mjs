/** @fileoverview Tests independent face / pose / skin state, shortcut parity and animation stability. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPRESSIONS, SKINS, POSES, createPetState, applyAction, actionForKey, advance } from '../renderer/state.mjs';
import hostPolicy from '../electron/host-policy.cjs';

test('number row and keypad map faces; F keys exclusively map skins and poses on both hosts', () => {
  assert.equal(EXPRESSIONS.length, 10);
  assert.deepEqual(EXPRESSIONS.map(item => item.key), ['1','2','3','4','5','6','7','8','9','0']);
  for (const item of EXPRESSIONS) {
    const expected = { type: 'expression', id: item.id };
    assert.deepEqual(actionForKey(`Digit${item.key}`), expected);
    assert.deepEqual(actionForKey(`Numpad${item.key}`), expected);
    assert.deepEqual(hostPolicy.actionForKey(item.key), expected);
  }
  for (const [items, type] of [[SKINS, 'toggle-skin'], [POSES, 'pose']]) for (const item of items) {
    assert.deepEqual(actionForKey(item.key), { type, id: item.id });
    assert.deepEqual(hostPolicy.actionForKey(item.key), { type, id: item.id });
  }
  for (const removed of ['KeyM', 'Minus', 'Equal', 'F7']) assert.equal(actionForKey(removed), null);
});

test('each face and face reset preserve the selected pose and both skin switches', () => {
  for (const pose of POSES) {
    const state = createPetState();
    applyAction(state, { type: 'pose', id: pose.id });
    for (const skin of SKINS) applyAction(state, { type: 'toggle-skin', id: skin.id });
    for (const face of EXPRESSIONS) {
      applyAction(state, { type: 'expression', id: face.id });
      assert.equal(state.expression, face.id);
      assert.equal(state.pose, pose.id); assert.equal(state.cat, true); assert.equal(state.glasses, true);
      applyAction(state, { type: 'expression', id: face.id });
      assert.equal(state.expression, null);
      assert.equal(state.pose, pose.id); assert.equal(state.cat, true); assert.equal(state.glasses, true);
    }
  }
});

test('poses are idempotent exclusive selections and skins toggle independently of faces and poses', () => {
  const state = createPetState();
  applyAction(state, { type: 'expression', id: 'cry' });
  applyAction(state, { type: 'toggle-skin', id: 'cat' });
  for (const pose of POSES) {
    for (let i = 0; i < 2; i++) {
      applyAction(state, { type: 'pose', id: pose.id });
      assert.equal(state.pose, pose.id); assert.equal(state.expression, 'cry'); assert.equal(state.cat, true);
    }
  }
  applyAction(state, { type: 'toggle-skin', id: 'glasses' });
  assert.equal(state.cat, true); assert.equal(state.glasses, true);
  applyAction(state, { type: 'toggle-skin', id: 'cat' });
  assert.equal(state.cat, false); assert.equal(state.glasses, true); assert.equal(state.expression, 'cry'); assert.equal(state.pose, 'tea');
  const snapshot = structuredClone(state);
  for (const action of [null, {type:'pose',id:'cat'}, {type:'toggle-skin',id:'pose'}, ...['pat','squint','star','glasses','tea','missing'].map(id=>({type:'expression',id}))]) applyAction(state, action);
  assert.deepEqual(state, snapshot, 'Removed expressions and malformed actions cannot alter the live state');
  applyAction(state, { type: 'reset' });
  assert.equal(state.expression, null); assert.equal(state.pose, 'idle'); assert.equal(state.cat, false); assert.equal(state.glasses, false);
});

test('cursor and spring stay bounded through long pauses and disabled tracking returns to center', () => {
  const state = createPetState(); state.target = { x: 10000, y: -10000 };
  for (let i = 0; i < 2000; i++) advance(state, i % 37 ? 1 / 60 : 400);
  assert.ok(state.gaze.x <= 1 && state.gaze.y >= -1);
  assert.ok(Number.isFinite(state.hair) && Math.abs(state.hair) < .2);
  for (let i = 0; i < 300; i++) advance(state, 1 / 60, { eyeTracking: false, hairMotion: false });
  assert.ok(Math.abs(state.gaze.x) < 1e-5);
  assert.ok(Math.abs(state.hair) < 1e-5);
});
