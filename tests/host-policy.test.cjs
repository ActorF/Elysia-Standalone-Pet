// Meaningful host boundaries: offscreen recovery, preference validation and original key coverage.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DEFAULT_SETTINGS, EXPRESSION_KEYS, sanitizeSettings, dimensions, fitBounds, pointerPayload, actionForKey, isLocalResource } = require('../electron/host-policy.cjs');

test('preferences reject unexpected values and bound zoom to usable sizes', () => {
  const next = sanitizeSettings({ alwaysOnTop: 'false', clickThrough: true, scale: Infinity, legacyHotkeys: 0, injected: 'ignore' });
  assert.equal(next.alwaysOnTop, true);
  assert.equal(next.clickThrough, true);
  assert.equal(next.scale, 1);
  assert.equal(next.legacyHotkeys, true);
  assert.equal('injected' in next, false);
  assert.equal(sanitizeSettings({ scale: -30 }).scale, 0.6);
  assert.equal(sanitizeSettings({ scale: 30 }).scale, 1.6);
  assert.deepEqual(dimensions(1), { width: 420, height: 560 });
  assert.equal(sanitizeSettings({ eyeTracking: false, hairMotion: false }).hairMotion, false);
  assert.equal(DEFAULT_SETTINGS.clickThrough, false);
});

test('restore and drag stay visible even with negative monitor coordinates', () => {
  const workArea = { x: -1920, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(fitBounds({ x: 9999, y: 9999, width: 420, height: 560 }, workArea), { x: -420, y: 480, width: 420, height: 560 });
  assert.deepEqual(fitBounds({ x: -9999, y: -9999, width: 420, height: 560 }, workArea), { x: -1920, y: 0, width: 420, height: 560 });
  assert.equal(fitBounds({ x: 0, y: 0, width: 2000, height: 2000 }, workArea).x, -1920);
});

test('cursor remains meaningful outside the pet and uses desktop DIP coordinates', () => {
  const cursor = pointerPayload({ x: -1000, y: 400 }, { x: 100, y: 100, width: 420, height: 560 });
  assert.deepEqual(cursor, { x: -1000, y: 400, localX: -1100, localY: 300, width: 420, height: 560, inside: false });
  assert.equal(pointerPayload({ x: 120, y: 120 }, { x: 100, y: 100, width: 420, height: 560 }).inside, true);
});

test('all 17 expressions and the two added actions have stable identifiers', () => {
  assert.equal(Object.keys(EXPRESSION_KEYS).length, 17);
  assert.equal(new Set(Object.values(EXPRESSION_KEYS)).size, 17);
  assert.deepEqual(actionForKey('1'), { type: 'expression', id: 'glasses' });
  assert.deepEqual(actionForKey('F5'), { type: 'expression', id: 'pat' });
  assert.deepEqual(actionForKey('M'), { type: 'toggle-megaphone' });
  assert.deepEqual(actionForKey('Backspace'), { type: 'reset' });
  assert.equal(actionForKey('A'), null);
  assert.equal(actionForKey('__proto__'), null);
});

test('resource boundary blocks remote and escaped paths while accepting local assets', () => {
  const root = path.resolve(__dirname, '..');
  assert.equal(isLocalResource(pathToFileURL(path.join(root, 'renderer', 'index.html')).href, root), true);
  assert.equal(isLocalResource(pathToFileURL(path.join(root, '..', 'secret.txt')).href, root), false);
  assert.equal(isLocalResource('https://example.com/pet.js', root), false);
  assert.equal(isLocalResource('file://remote-server/share/pet.js', root), false);
  assert.equal(isLocalResource('javascript:alert(1)', root), false);
});
