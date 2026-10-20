'use strict';

// Electron 43.8.0 implements moveTop() on Windows with SetWindowPos and
// SWP_NOACTIVATE. Do not replace it with focus(), show(), or a native helper.
// https://github.com/electron/electron/blob/v43.8.0/shell/browser/native_window_views.cc
// https://www.electronjs.org/docs/latest/api/browser-window#winsetalwaysontopflag-level-relativelevel
const TOPMOST_LEVEL = 'screen-saver';
const REASSERT_INTERVAL_MS = 750;
const controllers = new WeakMap();

/**
 * Keep a visible Windows pet above ordinary/topmost application windows without
 * taking keyboard focus. Reassertion cannot override the Windows secure desktop
 * or promise coverage over exclusive full-screen rendering or competing apps
 * that continuously reorder themselves.
 *
 * setEnabled(false) immediately stops maintenance and removes native topmost.
 * refresh() is useful after a display/layout change. dispose() releases every
 * listener/timer and topmost status; it is also called automatically on closed.
 * Repeated factory calls for the same live window return the existing owner.
 */
function createTopmostController(window, options = {}) {
  const existing = controllers.get(window);
  if (existing) return existing;
  const schedule = options.setInterval ?? setInterval;
  const cancel = options.clearInterval ?? clearInterval;
  const intervalMs = Number.isFinite(options.intervalMs)
    ? Math.max(500, Math.min(5000, options.intervalMs)) : REASSERT_INTERVAL_MS;
  let enabled = options.enabled !== false, disposed = false, timer = null, raising = false;

  const alive = () => !window.isDestroyed();
  const visible = () => alive() && window.isVisible() && !window.isMinimized();
  function stopTimer() {
    if (timer !== null) { cancel(timer); timer = null; }
  }
  function report(error) {
    if (!alive()) { dispose(); return; }
    options.onError?.(error);
  }
  function refresh() {
    if (disposed) return false;
    if (!alive()) { dispose(); return false; }
    if (!enabled || !visible()) { stopTimer(); return false; }
    if (timer === null) {
      timer = schedule(refresh, intervalMs);
      timer?.unref?.();
    }
    if (raising) return false;
    raising = true;
    try {
      // 'floating' intentionally places Windows windows behind the taskbar.
      // This supported level avoids that placement; moveTop restores ordering
      // within the native topmost group after another app has risen above us.
      window.setAlwaysOnTop(true, TOPMOST_LEVEL);
      if (!disposed && enabled && visible()) window.moveTop();
      return !disposed && enabled;
    } catch (error) {
      report(error);
      return false;
    } finally { raising = false; }
  }
  function enable() {
    if (!alive()) { dispose(); return; }
    // Setting the property is safe before first show, and makes preference
    // toggles observable even in a hidden smoke-test window. moveTop includes
    // SWP_SHOWWINDOW internally, so only refresh's visible guard may call it.
    if (!visible()) {
      try { window.setAlwaysOnTop(true, TOPMOST_LEVEL); } catch (error) { report(error); }
    }
    refresh();
  }
  function setEnabled(value) {
    if (disposed) return;
    const next = Boolean(value);
    if (enabled === next) return;
    enabled = next;
    if (enabled) { enable(); return; }
    stopTimer();
    if (alive()) {
      try { window.setAlwaysOnTop(false); } catch (error) { report(error); }
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true; enabled = false; stopTimer();
    for (const event of ['show', 'restore', 'blur', 'leave-full-screen']) window.removeListener(event, refresh);
    for (const event of ['hide', 'minimize']) window.removeListener(event, stopTimer);
    window.removeListener('closed', dispose);
    controllers.delete(window);
    if (alive()) {
      try { window.setAlwaysOnTop(false); } catch (error) { options.onError?.(error); }
    }
  }
  const controller = { setEnabled, refresh, dispose, get enabled() { return enabled; }, get disposed() { return disposed; } };
  controllers.set(window, controller);
  if (!alive()) { dispose(); return controller; }
  for (const event of ['show', 'restore', 'blur', 'leave-full-screen']) window.on(event, refresh);
  for (const event of ['hide', 'minimize']) window.on(event, stopTimer);
  window.once('closed', dispose);
  if (enabled) enable();
  else {
    try { window.setAlwaysOnTop(false); } catch (error) { report(error); }
  }
  return controller;
}

module.exports = { createTopmostController, TOPMOST_LEVEL, REASSERT_INTERVAL_MS };
