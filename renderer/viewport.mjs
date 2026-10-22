/** Map a fixed 600 × 800 character into a bounded native screen viewport. */
import {KEY_EFFECT_BOUNDS} from './key-cloud.mjs';
export function characterView(width, height, viewport) {
  if (viewport && [viewport.characterX, viewport.characterY, viewport.characterWidth, viewport.characterHeight].every(Number.isFinite)
      && viewport.characterWidth > 0 && viewport.characterHeight > 0) {
    return { x: viewport.characterX, y: viewport.characterY,
      scale: Math.min(viewport.characterWidth / 600, viewport.characterHeight / 800) };
  }
  const scale = Math.min(width / KEY_EFFECT_BOUNDS.width, height / 800);
  return { x: (width - KEY_EFFECT_BOUNDS.width * scale) / 2 + KEY_EFFECT_BOUNDS.left * scale,
    y: (height - 800 * scale) / 2, scale };
}

export function canvasBacking(width, height, pixelRatio = 1) {
  // Scaling the pet never allocates a bitmap as large as the virtual character.
  const ratio = Math.min(Math.max(1, pixelRatio), 4096 / width, 4096 / height, Math.sqrt(8_000_000 / (width * height)));
  return { width: Math.max(1, Math.floor(width * ratio)), height: Math.max(1, Math.floor(height * ratio)) };
}
