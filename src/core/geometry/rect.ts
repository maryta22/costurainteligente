import type { Vec2 } from './vec2';
import { vec2 } from './vec2';

/**
 * Rectángulo alineado a los ejes en coordenadas de mundo (mm, Y hacia arriba).
 *
 * Invariante: `min.x <= max.x` y `min.y <= max.y`. Todos los constructores de
 * este módulo lo garantizan; no construir rectángulos por literal.
 */
export interface Rect {
  readonly min: Vec2;
  readonly max: Vec2;
}

export function rectFromCorners(a: Vec2, b: Vec2): Rect {
  return {
    min: vec2(Math.min(a.x, b.x), Math.min(a.y, b.y)),
    max: vec2(Math.max(a.x, b.x), Math.max(a.y, b.y)),
  };
}

export function rectFromCenter(center: Vec2, width: number, height: number): Rect {
  const hw = Math.abs(width) / 2;
  const hh = Math.abs(height) / 2;
  return {
    min: vec2(center.x - hw, center.y - hh),
    max: vec2(center.x + hw, center.y + hh),
  };
}

/** Rectángulo envolvente de una nube de puntos. `null` si la nube está vacía. */
export function rectFromPoints(points: readonly Vec2[]): Rect | null {
  const first = points[0];
  if (first === undefined) return null;

  let minX = first.x;
  let minY = first.y;
  let maxX = first.x;
  let maxY = first.y;

  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p === undefined) continue;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return { min: vec2(minX, minY), max: vec2(maxX, maxY) };
}

export const rectWidth = (r: Rect): number => r.max.x - r.min.x;
export const rectHeight = (r: Rect): number => r.max.y - r.min.y;
export const rectCenter = (r: Rect): Vec2 =>
  vec2((r.min.x + r.max.x) / 2, (r.min.y + r.max.y) / 2);

export const rectIsEmpty = (r: Rect): boolean => rectWidth(r) <= 0 && rectHeight(r) <= 0;

export function rectContainsPoint(r: Rect, p: Vec2): boolean {
  return p.x >= r.min.x && p.x <= r.max.x && p.y >= r.min.y && p.y <= r.max.y;
}

export function rectIntersects(a: Rect, b: Rect): boolean {
  return !(a.max.x < b.min.x || a.min.x > b.max.x || a.max.y < b.min.y || a.min.y > b.max.y);
}

export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.min.x >= outer.min.x &&
    inner.min.y >= outer.min.y &&
    inner.max.x <= outer.max.x &&
    inner.max.y <= outer.max.y
  );
}

export function rectExpand(r: Rect, margin: number): Rect {
  return {
    min: vec2(r.min.x - margin, r.min.y - margin),
    max: vec2(r.max.x + margin, r.max.y + margin),
  };
}

export function rectUnion(a: Rect, b: Rect): Rect {
  return {
    min: vec2(Math.min(a.min.x, b.min.x), Math.min(a.min.y, b.min.y)),
    max: vec2(Math.max(a.max.x, b.max.x), Math.max(a.max.y, b.max.y)),
  };
}
