'use strict';

const MAX_SHAPE_RECTS = 4096;
const MAX_VIEWPORT_SIZE = 32768;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const dimension = value => finite(value) && value > 0 && value <= MAX_VIEWPORT_SIZE;
const compareRects = (a, b) => a.y - b.y || a.x - b.x || a.height - b.height || a.width - b.width;

function uniqueRects(rects) {
  const distinct = new Map();
  for (const rect of rects) distinct.set(`${rect.x},${rect.y},${rect.width},${rect.height}`, rect);
  return [...distinct.values()].sort(compareRects);
}

function sanitizePacket(value) {
  if (!value || !dimension(value.width) || !dimension(value.height)
    || !Array.isArray(value.rects) || !value.rects.length || value.rects.length > MAX_SHAPE_RECTS) return null;
  const rects = [];
  for (const rect of value.rects) {
    if (!rect || !finite(rect.x) || !finite(rect.y) || !dimension(rect.width) || !dimension(rect.height)) return null;
    const right = rect.x + rect.width, bottom = rect.y + rect.height;
    if (!finite(right) || !finite(bottom)) return null;
    const x = Math.max(0, rect.x), y = Math.max(0, rect.y);
    const clippedRight = Math.min(value.width, right), clippedBottom = Math.min(value.height, bottom);
    if (clippedRight > x && clippedBottom > y) rects.push({ x, y, width: clippedRight - x, height: clippedBottom - y });
  }
  // Electron interprets [] as restoring the FULL rectangular window, so an
  // empty or entirely clipped packet must never reach the native API.
  if (!rects.length) return null;
  return { width: value.width, height: value.height, rects: uniqueRects(rects) };
}

/**
 * Install a cached native drawing/hit region on this frameless window.
 * Input rectangles use CSS viewport coordinates. Electron accepts DIP and
 * performs native DPI scaling itself; never multiply by devicePixelRatio here.
 * A region clips visuals too, so callers supply the complete animation envelope
 * plus visible controls, rather than an asynchronous mask of the current frame.
 *
 * The host calls refresh() after placement, resizing, or display changes. This
 * owner has no polling, listeners, focus effects, or click-through preferences.
 * Native regions survive movement but do not rescale themselves across DPI.
 */
function createWindowShape(window, { screen } = {}) {
  let packet = null, packetKey = null, appliedPacketKey = null;
  let appliedGeometryKey = null, appliedNativeKey = null, disposed = false;
  let applying = false;
  let nativeUpdates=0,rectangleCount=0;

  function refresh() {
    if (disposed || !packet || applying || typeof window.setShape !== 'function' || window.isDestroyed()) return false;
    try {
      const bounds = window.getBounds(), content = window.getContentBounds();
      if (!dimension(content.width) || !dimension(content.height)) return false;
      const display = screen.getDisplayMatching(bounds);
      if (!display || !finite(display.scaleFactor) || display.scaleFactor <= 0) return false;
      const geometryKey = JSON.stringify([content.width, content.height, display.id, display.scaleFactor]);
      if (packetKey === appliedPacketKey && geometryKey === appliedGeometryKey) return true;

      const sx = content.width / packet.width, sy = content.height / packet.height;
      const rects = uniqueRects(packet.rects.map(rect => {
        const x = Math.max(0, Math.floor(rect.x * sx));
        const y = Math.max(0, Math.floor(rect.y * sy));
        const right = Math.min(Math.ceil(content.width), Math.ceil((rect.x + rect.width) * sx));
        const bottom = Math.min(Math.ceil(content.height), Math.ceil((rect.y + rect.height) * sy));
        return { x, y, width: right - x, height: bottom - y };
      }).filter(rect => rect.width > 0 && rect.height > 0));
      if (!rects.length) return false;
      const nativeKey = geometryKey + ':' + JSON.stringify(rects);
      if (nativeKey !== appliedNativeKey) {
        // SetWindowRgn can synchronously emit window-position/resize events.
        // Guard re-entry until the call succeeds; a thrown call remains retryable.
        applying = true;
        try { window.setShape(rects); } finally { applying = false; }
        appliedNativeKey = nativeKey;
        nativeUpdates++;rectangleCount=rects.length;
      }
      appliedPacketKey = packetKey;
      appliedGeometryKey = geometryKey;
      return true;
    } catch {
      return false;
    }
  }

  function update(value) {
    if (disposed) return false;
    const next = sanitizePacket(value);
    if (!next) return false;
    packet = next;
    packetKey = JSON.stringify(next);
    return refresh();
  }

  function dispose() {
    disposed = true;
    packet = null;
    packetKey = appliedPacketKey = appliedGeometryKey = appliedNativeKey = null;
    // Do not clear the native region: [] would restore the rectangular blocker.
  }

  return { update, refresh, dispose, get disposed() { return disposed; },
    get status(){return {applied:packetKey!==null&&packetKey===appliedPacketKey,rectangles:rectangleCount,nativeUpdates};} };
}

module.exports = { createWindowShape, MAX_SHAPE_RECTS, MAX_VIEWPORT_SIZE };
