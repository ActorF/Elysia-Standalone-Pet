'use strict';
const { EXPRESSION_KEYS, SKIN_KEYS, POSE_KEYS } = require('./host-policy.cjs');

function settingsAction(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.type === 'reset') return { type: 'reset' };
  const choices = { expression: EXPRESSION_KEYS, pose: POSE_KEYS, 'toggle-skin': SKIN_KEYS };
  if (!Object.hasOwn(choices, value.type) || !Object.values(choices[value.type]).includes(value.id)) return null;
  return { type: value.type, id: value.id };
}

function isSettingsSender(event, window, expectedUrl) {
  return !!window && !window.isDestroyed() && !window.webContents.isDestroyed()
    && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame
    && event.senderFrame?.url === expectedUrl;
}

function settingsWindowBounds(area, previous) {
  const minWidth = Math.min(500, area.width), minHeight = Math.min(540, area.height);
  const width = Math.min(area.width, Math.max(minWidth, previous?.width ?? 600));
  const height = Math.min(area.height, Math.max(minHeight, previous?.height ?? 780));
  const x = Math.max(area.x, Math.min(area.x + area.width - width, previous?.x ?? area.x + (area.width - width) / 2));
  const y = Math.max(area.y, Math.min(area.y + area.height - height, previous?.y ?? area.y + (area.height - height) / 2));
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height), minWidth, minHeight };
}

module.exports = { settingsAction, isSettingsSender, settingsWindowBounds };
