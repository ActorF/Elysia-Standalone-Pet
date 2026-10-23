/** Motion preferences share one phase across hair, clothes and legs. */
const bounded = (value, min, max) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 1;

export const motionAmplitude = (settings = {}) => settings.hairMotion === false
  ? 0 : bounded(settings.motionAmplitude, 0, 2);
export const motionSpeed = (settings = {}) => bounded(settings.motionSpeed, .25, 3);

/** Live animation integrates speed; still-frame previews start from their requested time. */
export function motionTime(state, settings = {}) {
  return Number.isFinite(state.motionTime) ? state.motionTime
    : (Number.isFinite(state.time) ? state.time : 0) * motionSpeed(settings);
}
