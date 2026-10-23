/** Multiplier for the existing eye warp; 100% retains the original rendering. */
export function eyeWarpStrength(settings = {}) {
  if (settings.eyeTracking === false) return 0;
  return Number.isFinite(settings.eyeWarpStrength)
    ? Math.max(0, Math.min(2, settings.eyeWarpStrength)) : 1;
}
