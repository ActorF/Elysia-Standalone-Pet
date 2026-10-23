import test from 'node:test';
import assert from 'node:assert/strict';
import host from '../electron/host-policy.cjs';
import { eyeWarpStrength } from '../renderer/gaze-settings.mjs';
import { createPetState, setGazeTarget, advance } from '../renderer/state.mjs';

test('renderer eye-warp bounds agree with persisted settings, including old preferences', () => {
  for (const value of [undefined, null, '0.5', NaN, Infinity, -Infinity, -10, 0, .25, .85, 1, 1.5, 2, 10]) {
    const saved = host.sanitizeSettings({ eyeWarpStrength: value });
    assert.equal(eyeWarpStrength({ eyeWarpStrength: value }), saved.eyeWarpStrength);
  }
  assert.equal(eyeWarpStrength({}), 1);
  assert.equal(eyeWarpStrength({ eyeTracking: false, eyeWarpStrength: 2 }), 0);
});

test('eye-warp strength never changes pointer response, blink timing or body animation', () => {
  const original = createPetState(), adjusted = createPetState();
  for (const [x, y] of [[1, -1], [-1, 1], [.2, -.4], [0, 0]]) {
    setGazeTarget(original, x, y); setGazeTarget(adjusted, x, y);
    advance(original, 1 / 60, { eyeWarpStrength: 1 });
    advance(adjusted, 1 / 60, { eyeWarpStrength: 2 });
    assert.deepEqual(adjusted, original);
  }
});
