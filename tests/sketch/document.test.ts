import { beforeEach, describe, expect, it } from 'vitest';

import { distance, vec2 } from '@core/geometry/vec2';

import {
  addLine,
  addPoint,
  documentBounds,
  emptyDocument,
  findPoint,
  isEmpty,
  lineSegment,
  movePoint,
  removeEntities,
  removePoints,
  translatePoints,
} from '@domain/sketch/document';
import { seedIdCounter } from '@domain/sketch/ids';
import { lineRef, pointRef } from '@domain/sketch/types';
import type { SketchDocument } from '@domain/sketch/types';

beforeEach(() => seedIdCounter(0));

/** Triángulo: tres puntos unidos por tres líneas. */
function triangle(): {
  doc: SketchDocument;
  ids: ReturnType<typeof addPoint>['id'][];
} {
  let doc = emptyDocument;
  const ids = [];

  for (const p of [vec2(0, 0), vec2(100, 0), vec2(50, 80)]) {
    const result = addPoint(doc, p);
    doc = result.document;
    ids.push(result.id);
  }

  const [a, b, c] = ids;
  if (a === undefined || b === undefined || c === undefined) throw new Error('setup');

  doc = addLine(doc, a, b).document;
  doc = addLine(doc, b, c).document;
  doc = addLine(doc, c, a).document;

  return { doc, ids };
}

describe('construcción', () => {
  it('el documento vacío no tiene entidades', () => {
    expect(isEmpty(emptyDocument)).toBe(true);
  });

  it('addPoint no muta el documento original', () => {
    const { document } = addPoint(emptyDocument, vec2(10, 20));
    expect(emptyDocument.points).toHaveLength(0);
    expect(document.points).toHaveLength(1);
  });

  it('addLine rechaza líneas degeneradas', () => {
    const { document, id } = addPoint(emptyDocument, vec2(0, 0));
    const result = addLine(document, id, id);
    expect(result.id).toBeNull();
    expect(result.document).toBe(document);
  });

  it('addLine rechaza duplicados en cualquier orden', () => {
    const { doc, ids } = triangle();
    const [a, b] = ids;
    if (a === undefined || b === undefined) throw new Error('setup');

    expect(addLine(doc, a, b).id).toBeNull();
    expect(addLine(doc, b, a).id).toBeNull();
    expect(doc.lines).toHaveLength(3);
  });
});

describe('geometría referida por identidad (D5)', () => {
  /*
   * La consecuencia observable de que las líneas guarden identificadores y no
   * coordenadas: mover un vértice reconfigura todas las líneas que lo comparten
   * sin tocarlas explícitamente.
   */
  it('mover un punto actualiza las líneas que lo comparten', () => {
    const { doc, ids } = triangle();
    const [a] = ids;
    if (a === undefined) throw new Error('setup');

    const moved = movePoint(doc, a, vec2(-100, -100));

    for (const line of moved.lines) {
      const segment = lineSegment(moved, line);
      expect(segment).toBeDefined();
    }

    const first = moved.lines[0];
    if (first === undefined) throw new Error('setup');
    const segment = lineSegment(moved, first);
    expect(segment?.a.x).toBe(-100);
  });

  it('borrar un punto elimina las líneas que dependen de él', () => {
    const { doc, ids } = triangle();
    const [a] = ids;
    if (a === undefined) throw new Error('setup');

    const pruned = removePoints(doc, [a]);

    expect(pruned.points).toHaveLength(2);
    expect(pruned.lines).toHaveLength(1); // sólo sobrevive la que no toca `a`
    for (const line of pruned.lines) {
      expect(findPoint(pruned, line.a)).toBeDefined();
      expect(findPoint(pruned, line.b)).toBeDefined();
    }
  });

  it('removeEntities acepta puntos y líneas a la vez', () => {
    const { doc, ids } = triangle();
    const [a] = ids;
    const firstLine = doc.lines[2];
    if (a === undefined || firstLine === undefined) throw new Error('setup');

    const pruned = removeEntities(doc, [pointRef(a), lineRef(firstLine.id)]);
    expect(pruned.points).toHaveLength(2);
    expect(pruned.lines).toHaveLength(1);
  });

  it('borrar una línea no borra sus puntos', () => {
    const { doc } = triangle();
    const line = doc.lines[0];
    if (line === undefined) throw new Error('setup');

    const pruned = removeEntities(doc, [lineRef(line.id)]);
    expect(pruned.points).toHaveLength(3);
    expect(pruned.lines).toHaveLength(2);
  });
});

describe('translatePoints', () => {
  it('desplaza sólo los puntos indicados y conserva las distancias', () => {
    const { doc, ids } = triangle();
    const [a, b] = ids;
    if (a === undefined || b === undefined) throw new Error('setup');

    const moved = translatePoints(doc, [a, b], vec2(25, -10));

    const beforeA = findPoint(doc, a);
    const afterA = findPoint(moved, a);
    const beforeB = findPoint(doc, b);
    const afterB = findPoint(moved, b);
    if (!beforeA || !afterA || !beforeB || !afterB) throw new Error('setup');

    expect(afterA.p.x - beforeA.p.x).toBe(25);
    expect(afterA.p.y - beforeA.p.y).toBe(-10);
    // Un desplazamiento rígido conserva la distancia entre los puntos movidos.
    expect(distance(afterA.p, afterB.p)).toBeCloseTo(distance(beforeA.p, beforeB.p), 12);
  });

  it('una lista vacía devuelve el mismo documento', () => {
    const { doc } = triangle();
    expect(translatePoints(doc, [], vec2(5, 5))).toBe(doc);
  });
});

describe('documentBounds', () => {
  it('envuelve todos los puntos', () => {
    const { doc } = triangle();
    const bounds = documentBounds(doc);
    expect(bounds).not.toBeNull();
    expect(bounds?.min.x).toBe(0);
    expect(bounds?.min.y).toBe(0);
    expect(bounds?.max.x).toBe(100);
    expect(bounds?.max.y).toBe(80);
  });

  it('devuelve null si no hay puntos', () => {
    expect(documentBounds(emptyDocument)).toBeNull();
  });
});
