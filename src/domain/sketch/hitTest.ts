import type { Rect } from '@core/geometry/rect';
import { rectContainsPoint, rectFromCorners } from '@core/geometry/rect';
import { distancePointToLine } from '@core/geometry/line';
import type { Vec2 } from '@core/geometry/vec2';
import { distance } from '@core/geometry/vec2';

import { findLine, findPoint, lineSegment } from './document';
import type { EntityRef, PointId, SketchDocument } from './types';
import { lineRef, pointRef } from './types';

/**
 * Tolerancias de acierto, EN MILÍMETROS.
 *
 * Quien llama las obtiene traduciendo un radio en píxeles con
 * `screenToWorldLength`, de modo que el área sensible es constante en pantalla
 * a cualquier zoom. El dominio no conoce píxeles.
 */
export interface HitTolerance {
  readonly pointMm: number;
  readonly lineMm: number;
}

/**
 * Entidad bajo una posición de mundo.
 *
 * Los puntos tienen prioridad absoluta sobre las líneas: en un extremo
 * compartido el usuario casi siempre quiere el punto, y sin esta regla resulta
 * imposible seleccionar el vértice de una polilínea.
 *
 * Entre varios candidatos del mismo tipo gana el más próximo; a igual
 * distancia, el añadido más tarde, que es el que se dibuja encima.
 */
export function hitTest(
  doc: SketchDocument,
  world: Vec2,
  tolerance: HitTolerance,
): EntityRef | null {
  let bestPoint: { ref: EntityRef; d: number } | null = null;

  for (const pt of doc.points) {
    const d = distance(world, pt.p);
    if (d <= tolerance.pointMm && (bestPoint === null || d <= bestPoint.d)) {
      bestPoint = { ref: pointRef(pt.id), d };
    }
  }
  if (bestPoint !== null) return bestPoint.ref;

  let bestLine: { ref: EntityRef; d: number } | null = null;

  for (const ln of doc.lines) {
    const seg = lineSegment(doc, ln);
    if (seg === undefined) continue;
    const d = distancePointToLine(seg, world);
    if (d <= tolerance.lineMm && (bestLine === null || d <= bestLine.d)) {
      bestLine = { ref: lineRef(ln.id), d };
    }
  }

  return bestLine?.ref ?? null;
}

/**
 * Punto existente lo bastante cerca como para reutilizarlo en lugar de crear
 * uno nuevo. Es la base del imán a puntos de las herramientas de dibujo.
 */
export function nearestPoint(
  doc: SketchDocument,
  world: Vec2,
  radiusMm: number,
  exclude?: ReadonlySet<PointId>,
): PointId | null {
  let bestId: PointId | null = null;
  let bestDistance = radiusMm;

  for (const pt of doc.points) {
    if (exclude?.has(pt.id) === true) continue;
    const d = distance(world, pt.p);
    if (d <= bestDistance) {
      bestDistance = d;
      bestId = pt.id;
    }
  }

  return bestId;
}

/**
 * Entidades contenidas en un rectángulo de selección.
 *
 * Criterio de contención estricta, no de intersección: una línea entra en la
 * selección sólo si sus dos extremos están dentro. Es el comportamiento de los
 * editores vectoriales y evita arrastrar media geometría con un marco amplio.
 */
export function entitiesInRect(doc: SketchDocument, rect: Rect): EntityRef[] {
  const result: EntityRef[] = [];
  const inside = new Set<PointId>();

  for (const pt of doc.points) {
    if (rectContainsPoint(rect, pt.p)) {
      inside.add(pt.id);
      result.push(pointRef(pt.id));
    }
  }

  for (const ln of doc.lines) {
    if (inside.has(ln.a) && inside.has(ln.b)) result.push(lineRef(ln.id));
  }

  return result;
}

/** Rectángulo de mundo definido por dos esquinas arbitrarias. */
export const selectionRect = (a: Vec2, b: Vec2): Rect => rectFromCorners(a, b);

/**
 * Puntos que deben moverse al arrastrar una selección.
 *
 * Arrastrar una línea mueve sus dos extremos: la línea no tiene posición
 * propia, su geometría vive en los puntos. Es consecuencia directa de guardar
 * la topología por identidad (D5).
 */
export function pointsAffectedBySelection(
  doc: SketchDocument,
  selection: readonly EntityRef[],
): Set<PointId> {
  const ids = new Set<PointId>();

  for (const ref of selection) {
    if (ref.kind === 'point') {
      if (findPoint(doc, ref.id) !== undefined) ids.add(ref.id);
      continue;
    }
    const line = findLine(doc, ref.id);
    if (line !== undefined) {
      ids.add(line.a);
      ids.add(line.b);
    }
  }

  return ids;
}
