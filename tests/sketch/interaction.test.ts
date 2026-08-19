import { beforeEach, describe, expect, it } from 'vitest';

import { vec2 } from '@core/geometry/vec2';

import { addLine, addPoint, emptyDocument } from '@domain/sketch/document';
import {
  entitiesInRect,
  hitTest,
  nearestPoint,
  pointsAffectedBySelection,
  selectionRect,
} from '@domain/sketch/hitTest';
import { seedIdCounter } from '@domain/sketch/ids';
import { resolveSnap } from '@domain/sketch/snapping';
import { lineRef, pointRef } from '@domain/sketch/types';
import type { PointId, SketchDocument } from '@domain/sketch/types';

const TOLERANCE = { pointMm: 3, lineMm: 2 };

let doc: SketchDocument;
let a: PointId;
let b: PointId;
let c: PointId;

beforeEach(() => {
  seedIdCounter(0);

  const p0 = addPoint(emptyDocument, vec2(0, 0));
  const p1 = addPoint(p0.document, vec2(100, 0));
  const p2 = addPoint(p1.document, vec2(100, 100));

  a = p0.id;
  b = p1.id;
  c = p2.id;

  doc = addLine(addLine(p2.document, a, b).document, b, c).document;
});

describe('hitTest', () => {
  it('encuentra un punto dentro de la tolerancia', () => {
    expect(hitTest(doc, vec2(1, 1), TOLERANCE)).toEqual(pointRef(a));
  });

  it('no encuentra nada fuera de la tolerancia', () => {
    expect(hitTest(doc, vec2(50, 50), TOLERANCE)).toBeNull();
  });

  it('encuentra una línea por su eje', () => {
    const hit = hitTest(doc, vec2(50, 1), TOLERANCE);
    expect(hit?.kind).toBe('line');
  });

  /*
   * Regla de prioridad: en un extremo compartido conviven un punto y dos
   * líneas. Sin la prioridad del punto, seleccionar un vértice sería
   * imposible.
   */
  it('el punto gana a la línea cuando ambos están al alcance', () => {
    const hit = hitTest(doc, vec2(100, 0.5), TOLERANCE);
    expect(hit).toEqual(pointRef(b));
  });

  it('entre dos puntos gana el más próximo', () => {
    const extra = addPoint(doc, vec2(4, 0));
    const hit = hitTest(extra.document, vec2(3.5, 0), { pointMm: 10, lineMm: 2 });
    expect(hit).toEqual(pointRef(extra.id));
  });
});

describe('nearestPoint', () => {
  it('respeta el radio', () => {
    expect(nearestPoint(doc, vec2(0, 0), 1)).toBe(a);
    expect(nearestPoint(doc, vec2(50, 50), 1)).toBeNull();
  });

  it('ignora los puntos excluidos', () => {
    expect(nearestPoint(doc, vec2(0, 0), 5, new Set([a]))).toBeNull();
  });
});

describe('entitiesInRect', () => {
  it('incluye una línea sólo si sus dos extremos están dentro', () => {
    const found = entitiesInRect(doc, selectionRect(vec2(-10, -10), vec2(110, 10)));

    expect(found.filter((ref) => ref.kind === 'point')).toHaveLength(2);
    expect(found.filter((ref) => ref.kind === 'line')).toHaveLength(1);
  });

  it('un marco que sólo corta una línea no la selecciona', () => {
    const found = entitiesInRect(doc, selectionRect(vec2(40, -5), vec2(60, 5)));
    expect(found).toHaveLength(0);
  });

  it('un marco que lo abarca todo selecciona todo', () => {
    const found = entitiesInRect(doc, selectionRect(vec2(-50, -50), vec2(150, 150)));
    expect(found).toHaveLength(doc.points.length + doc.lines.length);
  });
});

describe('pointsAffectedBySelection', () => {
  it('seleccionar una línea arrastra sus dos extremos', () => {
    const line = doc.lines[0];
    if (line === undefined) throw new Error('setup');

    const affected = pointsAffectedBySelection(doc, [lineRef(line.id)]);
    expect(affected).toEqual(new Set([a, b]));
  });

  it('no duplica puntos compartidos por varias entidades seleccionadas', () => {
    const affected = pointsAffectedBySelection(doc, doc.lines.map((ln) => lineRef(ln.id)));
    expect(affected.size).toBe(3);
  });

  it('descarta referencias a entidades inexistentes', () => {
    const affected = pointsAffectedBySelection(doc, [pointRef('fantasma' as PointId)]);
    expect(affected.size).toBe(0);
  });
});

describe('resolveSnap', () => {
  const options = { gridEnabled: true, gridStepMm: 10, pointRadiusMm: 5 };

  it('el imán a puntos tiene prioridad sobre la rejilla', () => {
    // (98, 2) está a 2.83 mm de (100,0) y la rejilla lo llevaría a (100,0)
    // igualmente; se usa un punto fuera de rejilla para distinguir ambos casos.
    const off = addPoint(doc, vec2(103, 4));
    const result = resolveSnap(off.document, vec2(104, 5), options);

    expect(result.kind).toBe('point');
    expect(result.targetId).toBe(off.id);
    expect(result.point).toEqual(vec2(103, 4));
  });

  it('sin punto cercano ajusta a la rejilla', () => {
    const result = resolveSnap(doc, vec2(47, 52), options);
    expect(result.kind).toBe('grid');
    expect(result.point.x).toBe(50);
    expect(result.point.y).toBe(50);
    expect(result.targetId).toBeNull();
  });

  it('con la rejilla desactivada devuelve la posición libre', () => {
    const world = vec2(47.31, 52.77);
    const result = resolveSnap(doc, world, { ...options, gridEnabled: false });
    expect(result.kind).toBe('free');
    expect(result.point).toBe(world);
  });

  it('los puntos excluidos no capturan el imán', () => {
    const result = resolveSnap(doc, vec2(1, 1), { ...options, exclude: new Set([a]) });
    expect(result.kind).toBe('grid');
  });

  /*
   * INTEGRIDAD TOPOLÓGICA. Regresión de un fallo detectado ejecutando el
   * editor: al cerrar un contorno, el cursor puede quedar fuera del radio del
   * imán y aun así la rejilla llevarlo exactamente sobre el primer vértice.
   * Sin resolución de coincidencia se creaba un punto duplicado y el contorno
   * quedaba abierto pese a parecer cerrado en pantalla.
   */
  it('la rejilla que aterriza sobre un punto existente devuelve ese punto', () => {
    // (0,0) existe. Un cursor a 4 mm queda fuera del imán de 2 mm, pero la
    // rejilla de 10 mm lo lleva exactamente al origen.
    const result = resolveSnap(doc, vec2(4, 3), {
      gridEnabled: true,
      gridStepMm: 10,
      pointRadiusMm: 2,
    });

    expect(result.kind).toBe('point');
    expect(result.targetId).toBe(a);
    expect(result.point).toEqual(vec2(0, 0));
  });

  it('la resolución de coincidencia también actúa sin rejilla ni imán', () => {
    const result = resolveSnap(doc, vec2(100, 100), {
      gridEnabled: false,
      gridStepMm: 10,
      pointRadiusMm: 0,
    });

    expect(result.kind).toBe('point');
    expect(result.targetId).toBe(c);
  });

  it('no confunde proximidad con coincidencia', () => {
    const result = resolveSnap(doc, vec2(100.5, 100), {
      gridEnabled: false,
      gridStepMm: 10,
      pointRadiusMm: 0,
    });

    expect(result.kind).toBe('free');
    expect(result.targetId).toBeNull();
  });
});
