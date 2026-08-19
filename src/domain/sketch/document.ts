import type { Rect } from '@core/geometry/rect';
import { rectFromPoints } from '@core/geometry/rect';
import type { LineSeg } from '@core/geometry/line';
import { lineSeg } from '@core/geometry/line';
import type { Vec2 } from '@core/geometry/vec2';
import { add } from '@core/geometry/vec2';

import { createLineId, createPointId } from './ids';
import type { EntityRef, LineId, PointId, SketchDocument, SketchLine, SketchPoint } from './types';

/**
 * Operaciones sobre el documento de boceto.
 *
 * Todas son funciones puras que devuelven un documento nuevo. El estado global
 * (Zustand) se limita a guardar el resultado; no hay mutación en su interior.
 * Esto es lo que hace que el historial de deshacer sea una simple pila de
 * referencias y que los tests no necesiten ningún andamiaje.
 */

export const emptyDocument: SketchDocument = Object.freeze({
  points: Object.freeze([]) as readonly SketchPoint[],
  lines: Object.freeze([]) as readonly SketchLine[],
});

export function findPoint(doc: SketchDocument, id: PointId): SketchPoint | undefined {
  return doc.points.find((pt) => pt.id === id);
}

export function findLine(doc: SketchDocument, id: LineId): SketchLine | undefined {
  return doc.lines.find((ln) => ln.id === id);
}

/** Índice por identificador. Útil cuando hay que resolver muchos puntos seguidos. */
export function indexPoints(doc: SketchDocument): ReadonlyMap<PointId, SketchPoint> {
  return new Map(doc.points.map((pt) => [pt.id, pt]));
}

/**
 * Segmento en coordenadas de mundo de una línea.
 *
 * Devuelve `undefined` si algún extremo no existe. Un documento consistente no
 * debería permitirlo —`removePoints` limpia las líneas dependientes—, pero el
 * tipo lo hace explícito en lugar de confiar en un invariante no comprobado.
 */
export function lineSegment(doc: SketchDocument, line: SketchLine): LineSeg | undefined {
  const a = findPoint(doc, line.a);
  const b = findPoint(doc, line.b);
  return a && b ? lineSeg(a.p, b.p) : undefined;
}

export function addPoint(
  doc: SketchDocument,
  p: Vec2,
  id: PointId = createPointId(),
): { readonly document: SketchDocument; readonly id: PointId } {
  return {
    document: { ...doc, points: [...doc.points, { id, p }] },
    id,
  };
}

/**
 * Añade una línea entre dos puntos existentes.
 *
 * Rechaza las líneas degeneradas (mismo punto en ambos extremos) y las
 * duplicadas en cualquier orden: dos puntos sólo pueden estar unidos por una
 * línea. Devolver el documento sin cambios en lugar de lanzar mantiene a las
 * herramientas de interacción libres de manejo de errores.
 */
export function addLine(
  doc: SketchDocument,
  a: PointId,
  b: PointId,
  id: LineId = createLineId(),
): { readonly document: SketchDocument; readonly id: LineId | null } {
  if (a === b) return { document: doc, id: null };

  const exists = doc.lines.some(
    (ln) => (ln.a === a && ln.b === b) || (ln.a === b && ln.b === a),
  );
  if (exists) return { document: doc, id: null };

  return { document: { ...doc, lines: [...doc.lines, { id, a, b }] }, id };
}

export function movePoint(doc: SketchDocument, id: PointId, p: Vec2): SketchDocument {
  const index = doc.points.findIndex((pt) => pt.id === id);
  if (index < 0) return doc;

  const points = doc.points.slice();
  const current = doc.points[index];
  if (current === undefined) return doc;
  points[index] = { ...current, p };

  return { ...doc, points };
}

/** Desplaza un conjunto de puntos por un mismo delta. Una sola pasada. */
export function translatePoints(
  doc: SketchDocument,
  ids: Iterable<PointId>,
  delta: Vec2,
): SketchDocument {
  const target = new Set(ids);
  if (target.size === 0) return doc;

  return {
    ...doc,
    points: doc.points.map((pt) => (target.has(pt.id) ? { ...pt, p: add(pt.p, delta) } : pt)),
  };
}

/**
 * Elimina puntos y, con ellos, toda línea que los referencie.
 *
 * La integridad topológica es responsabilidad del dominio, no de la interfaz:
 * si esta limpieza viviera en el componente de React, cualquier otra ruta de
 * borrado (atajo, script, importación) dejaría líneas huérfanas.
 */
export function removePoints(doc: SketchDocument, ids: Iterable<PointId>): SketchDocument {
  const target = new Set(ids);
  if (target.size === 0) return doc;

  return {
    points: doc.points.filter((pt) => !target.has(pt.id)),
    lines: doc.lines.filter((ln) => !target.has(ln.a) && !target.has(ln.b)),
  };
}

export function removeLines(doc: SketchDocument, ids: Iterable<LineId>): SketchDocument {
  const target = new Set(ids);
  if (target.size === 0) return doc;
  return { ...doc, lines: doc.lines.filter((ln) => !target.has(ln.id)) };
}

/** Elimina un conjunto heterogéneo de entidades en una sola operación. */
export function removeEntities(
  doc: SketchDocument,
  refs: readonly EntityRef[],
): SketchDocument {
  const pointIds: PointId[] = [];
  const lineIds: LineId[] = [];

  for (const ref of refs) {
    if (ref.kind === 'point') pointIds.push(ref.id);
    else lineIds.push(ref.id);
  }

  return removePoints(removeLines(doc, lineIds), pointIds);
}

/** Rectángulo envolvente del boceto. `null` si no hay puntos. */
export function documentBounds(doc: SketchDocument): Rect | null {
  return rectFromPoints(doc.points.map((pt) => pt.p));
}

export const isEmpty = (doc: SketchDocument): boolean =>
  doc.points.length === 0 && doc.lines.length === 0;
