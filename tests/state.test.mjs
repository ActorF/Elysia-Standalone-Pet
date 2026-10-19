/** @fileoverview Tests semantic parity, toggling, animation stability and legacy chord mappings. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EXPRESSIONS, createPetState, applyAction, actionForKey, advance } from '../renderer/state.mjs';

test('all 17 verified original controls map to implemented expressions', async () => {
  const controls = JSON.parse(await readFile(new URL('../assets/original-controls.json', import.meta.url), 'utf8'));
  assert.deepEqual(EXPRESSIONS.map(x => x.id), controls.map(x => x.id));
  assert.equal(EXPRESSIONS.length, 17);
  for (const item of EXPRESSIONS) {
    const code = /^\d$/.test(item.key) ? `Digit${item.key}` : item.key === '-' ? 'Minus' : item.key === '=' ? 'Equal' : item.key;
    assert.deepEqual(actionForKey(code), { type: 'expression', id: item.id });
  }
});

test('repeat restores default, unknown actions do nothing, reset also hides the horn', () => {
  const state = createPetState();
  applyAction(state, { type: 'expression', id: 'cry' });
  applyAction(state, { type: 'toggle-megaphone' });
  assert.equal(state.expression, 'cry'); assert.equal(state.megaphone, true);
  applyAction(state, { type: 'expression', id: 'missing' });
  assert.equal(state.expression, 'cry');
  applyAction(state, { type: 'expression', id: 'cry' });
  assert.equal(state.expression, null); assert.equal(state.megaphone, true);
  applyAction(state, { type: 'reset' });
  assert.equal(state.megaphone, false);
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
