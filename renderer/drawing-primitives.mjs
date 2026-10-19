/** @fileoverview Canvas drawing primitives shared by the active expression renderer. */
const INK = '#57283f';

export function ellipse(ctx, x, y, rx, ry, fill, stroke, width = 3) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
}

export function path(ctx, points, stroke = INK, width = 4, fill) {
  ctx.beginPath();
  for (const [command, ...args] of points) ctx[command](...args);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); }
}

export function star(ctx, x, y, radius, color) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? radius * .44 : radius;
    ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath(); ctx.fillStyle = color; ctx.fill();
}
