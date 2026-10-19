// Pure host policy: validated preferences, screen placement and original expression keys.
'use strict';

const path = require('node:path');
const { fileURLToPath } = require('node:url');
const DEFAULT_SETTINGS = Object.freeze({
  alwaysOnTop: true, clickThrough: false, scale: 1, legacyHotkeys: true, alternateHotkeys: false,
  eyeTracking: true, hairMotion: true,
});
const EXPRESSION_KEYS = Object.freeze({
  '1': 'glasses', '2': 'blush', '3': 'angry', '4': 'sleep', '5': 'surprise',
  '6': 'squint', '7': 'dizzy', '8': 'wink', '9': 'cry', '0': 'heart',
  '-': 'star', '=': 'smile', F1: 'cat', F2: 'cake', F3: 'tea', F4: 'awkward', F5: 'pat',
});

function sanitizeSettings(input = {}, previous = DEFAULT_SETTINGS) {
  const next = { ...previous };
  for (const key of ['alwaysOnTop', 'clickThrough', 'legacyHotkeys', 'alternateHotkeys', 'eyeTracking', 'hairMotion']) {
    if (typeof input[key] === 'boolean') next[key] = input[key];
  }
  if (Number.isFinite(input.scale)) next.scale = Math.round(Math.min(1.6, Math.max(0.6, input.scale)) * 100) / 100;
  return next;
}

function dimensions(scale) {
  return { width: Math.round(420 * scale), height: Math.round(560 * scale) };
}

function fitBounds(bounds, workArea) {
  return {
    ...bounds,
    x: Math.round(Math.min(Math.max(bounds.x, workArea.x), workArea.x + Math.max(0, workArea.width - bounds.width))),
    y: Math.round(Math.min(Math.max(bounds.y, workArea.y), workArea.y + Math.max(0, workArea.height - bounds.height))),
  };
}

function pointerPayload(point, bounds) {
  const localX = point.x - bounds.x;
  const localY = point.y - bounds.y;
  return {
    x: point.x, y: point.y, localX, localY, width: bounds.width, height: bounds.height,
    inside: localX >= 0 && localY >= 0 && localX < bounds.width && localY < bounds.height,
  };
}

function actionForKey(key) {
  if (Object.hasOwn(EXPRESSION_KEYS, key)) return { type: 'expression', id: EXPRESSION_KEYS[key] };
  if (key === 'M') return { type: 'toggle-megaphone' };
  if (key === 'Backspace') return { type: 'reset' };
  return null;
}

function isLocalResource(url, root) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:' || parsed.host) return false;
    const relative = path.relative(path.resolve(root), path.resolve(fileURLToPath(parsed)));
    return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  } catch { return false; }
}

module.exports = { DEFAULT_SETTINGS, EXPRESSION_KEYS, sanitizeSettings, dimensions, fitBounds, pointerPayload, actionForKey, isLocalResource };
