// Meaningful host boundaries: offscreen recovery, preference validation and original key coverage.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DEFAULT_SETTINGS, EXPRESSION_KEYS, SKIN_KEYS, POSE_KEYS, sanitizeAppearance, sanitizeSettings, dimensions, freeBounds, fitBounds, restoreBounds, recoverBounds, pointerPayload, actionForKey, isLocalResource } = require('../electron/host-policy.cjs');

test('preferences reject unexpected values and allow one percent through extreme zoom', () => {
  const next = sanitizeSettings({ alwaysOnTop: 'false', clickThrough: true, scale: Infinity, legacyHotkeys: 0, injected: 'ignore' });
  assert.equal(next.alwaysOnTop, true);
  assert.equal(next.clickThrough, true);
  assert.equal(next.scale, 1);
  assert.equal(next.legacyHotkeys, true);
  assert.equal('injected' in next, false);
  assert.equal(sanitizeSettings({ scale: -30 }).scale, 0.01);
  assert.equal(sanitizeSettings({ scale: 30 }).scale, 30);
  assert.equal(sanitizeSettings({ scale: 1e20 }).scale, 1e20);
  assert.equal(sanitizeSettings({ scale: 1.012345 }).scale, 1.012345);
  assert.deepEqual(dimensions(1), { width: 420, height: 560 });
  assert.equal(sanitizeSettings({ eyeTracking: false, hairMotion: false }).hairMotion, false);
  assert.equal(DEFAULT_SETTINGS.clickThrough, false);
  const skins = sanitizeSettings({ cat: true, glasses: true });
  assert.equal(skins.cat, true); assert.equal(skins.glasses, true);
  assert.equal(sanitizeSettings({ scale: 1.1 }, skins).cat, true, 'Unrelated settings retain persisted skins');
  assert.equal(sanitizeSettings({ cat: 'false', glasses: 0 }, skins).glasses, true, 'Skin values must be booleans');
});

test('explicit recovery fits a normal pet and anchors an oversized pet on negative-coordinate monitors', () => {
  const workArea = { x: -1920, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(fitBounds({ x: 9999, y: 9999, width: 420, height: 560 }, workArea), { x: -420, y: 480, width: 420, height: 560 });
  assert.deepEqual(fitBounds({ x: -9999, y: -9999, width: 420, height: 560 }, workArea), { x: -1920, y: 0, width: 420, height: 560 });
  assert.equal(fitBounds({ x: 0, y: 0, width: 2000, height: 2000 }, workArea).x, -1920);
  assert.deepEqual(fitBounds({ x: -5000, y: -5000, width: 2000, height: 2000 }, workArea), { x: -1920, y: 0, width: 2000, height: 2000 });
});

const primaryDisplay = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const leftDisplay = { bounds: { x: -1920, y: -180, width: 1920, height: 1080 }, workArea: { x: -1920, y: -180, width: 1920, height: 1040 } };
const petBounds = (x, y, width = 420, height = 560) => ({ x, y, width, height });

test('ordinary dragging is unbounded across all four edges and can leave the entire desktop', () => {
  for (const [x, y] of [[-410, 200], [1910, 200], [700, -550], [700, 1070], [-6000, -6000], [6000, 6000]]) {
    const desired = petBounds(x, y);
    assert.deepEqual(freeBounds(desired), desired, 'Drag coordinates must not be fitted to any monitor');
  }
  assert.deepEqual(freeBounds(petBounds(-420.4, -551.7)), petBounds(-420, -552));
  assert.equal(freeBounds(petBounds(Number.MAX_VALUE, -Number.MAX_VALUE)).x, 2147483647, 'Only native coordinate overflow is bounded');
});

test('restart preserves partial placement at every screen edge, including a one-pixel sliver', () => {
  for (const desired of [petBounds(-410, 200), petBounds(1910, 200), petBounds(700, -550), petBounds(700, 1070), petBounds(-419, -559)]) {
    assert.deepEqual(restoreBounds(desired, [primaryDisplay]), desired);
  }
  // Physical bounds, not the work area: the user's chosen taskbar overlap survives.
  const taskbarOnly = petBounds(700, 1050);
  assert.deepEqual(restoreBounds(taskbarOnly, [primaryDisplay]), taskbarOnly);
  const onlyLegsAtTop = petBounds(700, -460);
  assert.deepEqual(restoreBounds(onlyLegsAtTop, [primaryDisplay]), onlyLegsAtTop);
});

test('negative and vertically offset monitor coordinates remain intentional placements', () => {
  const displays = [primaryDisplay, leftDisplay];
  for (const desired of [petBounds(-2300, -400), petBounds(-700, -720), petBounds(-200, -200)]) {
    assert.deepEqual(restoreBounds(desired, displays), desired);
  }
  const acrossBoundary = petBounds(-210, 200);
  assert.deepEqual(restoreBounds(acrossBoundary, displays), acrossBoundary);
});

test('resizing and display metric changes retain a partly offscreen position', () => {
  const resized = petBounds(-610, -800, 672, 896);
  assert.deepEqual(freeBounds(resized), resized, 'Scale changes do not force a window onto the desktop');
  assert.deepEqual(restoreBounds(resized, [primaryDisplay]), resized);
  const newMetrics = { bounds: { x: 0, y: 0, width: 1280, height: 720 }, workArea: { x: 0, y: 0, width: 1280, height: 680 } };
  const partialAfterResize = petBounds(1200, 600);
  assert.deepEqual(restoreBounds(partialAfterResize, [newMetrics]), partialAfterResize);
});

test('removed monitors and fully offscreen saved positions recover to the nearest available display', () => {
  const removedMonitorPosition = petBounds(-1500, 100);
  assert.deepEqual(restoreBounds(removedMonitorPosition, [primaryDisplay]), petBounds(0, 100));
  assert.deepEqual(restoreBounds(petBounds(-6000, -6000), [primaryDisplay, leftDisplay]), petBounds(-1920, -180));
  assert.deepEqual(restoreBounds(petBounds(6000, 6000), [primaryDisplay, leftDisplay]), petBounds(1500, 480));
  assert.deepEqual(restoreBounds(petBounds(-420, 200), [primaryDisplay]), petBounds(0, 200), 'An edge touch without visible area is recovered');
  assert.deepEqual(restoreBounds(petBounds(-420, 200), []), petBounds(-420, 200), 'A transient empty display list must not invent a screen');
});

test('explicit recovery always brings a partly visible pet fully back into the available work area', () => {
  for (const desired of [petBounds(-410, 200), petBounds(1910, 200), petBounds(700, -550), petBounds(700, 1070), petBounds(700, 1050)]) {
    const actual = recoverBounds(desired, [primaryDisplay]), area = primaryDisplay.workArea;
    assert.ok(actual.x >= area.x && actual.y >= area.y);
    assert.ok(actual.x + actual.width <= area.x + area.width && actual.y + actual.height <= area.y + area.height);
    assert.equal(actual.width, desired.width); assert.equal(actual.height, desired.height);
  }
  assert.deepEqual(recoverBounds(petBounds(-1800, -500), [primaryDisplay, leftDisplay]), petBounds(-1800, -180));
  const oversized = petBounds(-100, -100, 2500, 1600);
  assert.deepEqual(restoreBounds(oversized, [primaryDisplay]), oversized, 'Oversize pet does not jump while any part is visible');
  assert.deepEqual(recoverBounds(oversized, [primaryDisplay]), petBounds(0, 0, 2500, 1600), 'Recovery keeps chosen size and makes top-left controls reachable');
});

test('cursor remains meaningful outside the pet and uses desktop DIP coordinates', () => {
  const cursor = pointerPayload({ x: -1000, y: 400 }, { x: 100, y: 100, width: 420, height: 560 });
  assert.deepEqual(cursor, { x: -1000, y: 400, localX: -1100, localY: 300, width: 420, height: 560, inside: false });
  assert.equal(pointerPayload({ x: 120, y: 120 }, { x: 100, y: 100, width: 420, height: 560 }).inside, true);
});

test('digit faces, independent F-key skins and exclusive F-key poses map to distinct actions', () => {
  assert.equal(Object.keys(EXPRESSION_KEYS).length, 10);
  assert.equal(Object.keys(SKIN_KEYS).length, 2);
  assert.equal(Object.keys(POSE_KEYS).length, 4);
  assert.deepEqual(actionForKey('1'), { type: 'expression', id: 'blush' });
  assert.deepEqual(actionForKey('F1'), { type: 'toggle-skin', id: 'cat' });
  assert.deepEqual(actionForKey('F2'), { type: 'toggle-skin', id: 'glasses' });
  assert.deepEqual(actionForKey('F3'), { type: 'pose', id: 'idle' });
  assert.deepEqual(actionForKey('F4'), { type: 'pose', id: 'megaphone' });
  assert.deepEqual(actionForKey('F5'), { type: 'pose', id: 'cake' });
  assert.deepEqual(actionForKey('F6'), { type: 'pose', id: 'tea' });
  assert.equal(actionForKey('M'), null);
  assert.deepEqual(actionForKey('Backspace'), { type: 'reset' });
  assert.equal(actionForKey('A'), null);
  assert.equal(actionForKey('__proto__'), null);
});

test('native menus accept only the fixed appearance state and ignore arbitrary renderer fields', () => {
  assert.deepEqual(sanitizeAppearance({expression:'sleep',pose:'tea',cat:true,glasses:true,extra:42}), {expression:'sleep',pose:'tea',cat:true,glasses:true});
  assert.deepEqual(sanitizeAppearance({expression:'pat',pose:'unknown',cat:'true',glasses:1}), {expression:null,pose:'idle',cat:false,glasses:false});
  assert.deepEqual(sanitizeAppearance(null), {expression:null,pose:'idle',cat:false,glasses:false});
});

test('resource boundary blocks remote and escaped paths while accepting local assets', () => {
  const root = path.resolve(__dirname, '..');
  assert.equal(isLocalResource(pathToFileURL(path.join(root, 'renderer', 'index.html')).href, root), true);
  assert.equal(isLocalResource(pathToFileURL(path.join(root, '..', 'secret.txt')).href, root), false);
  assert.equal(isLocalResource('https://example.com/pet.js', root), false);
  assert.equal(isLocalResource('file://remote-server/share/pet.js', root), false);
  assert.equal(isLocalResource('javascript:alert(1)', root), false);
});
