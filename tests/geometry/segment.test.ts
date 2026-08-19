import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { arcLength, arcSeg } from '@core/geometry/arc';
import { cubicSeg } from '@core/geometry/cubic';
import { lineSeg } from '@core/geometry/line';
import { compose, rotation, scaling, translation } from '@core/geometry/mat3';
import type { Segment } from '@core/geometry/segment';
import {
  closestPointOnSegment,
  distancePointToSegment,
  segmentBounds,
  segmentEnd,
  segmentLength,
  segmentNormal,
  segmentPointAt,
  segmentPointAtLength,
  segmentReverse,
  segmentSplitAt,
  segmentStart,
  segmentTangent,
  segmentToCubics,
  segmentToPolyline,
  transformSegment,
} from '@core/geometry/segment';
import { distance, dot, equals, length, vec2 } from '@core/geometry/vec2';

const LINE = lineSeg(vec2(0, 0), vec2(120, 90));
const CUBIC = cubicSeg(vec2(0, 0), vec2(40, 120), vec2(160, 90), vec2(200, 0));
const ARC = arcSeg(vec2(0, 0), 100, 0.2, 1.7);

const ALL: readonly { name: string; segment: Segment }[] = [
  { name: 'recta', segment: LINE },
  { name: 'cúbica', segment: CUBIC },
  { name: 'arco', segment: ARC },
];

describe.each(ALL)('contrato común — $name', ({ segment }) => {
  it('los extremos coinciden con t = 0 y t = 1', () => {
    expect(equals(segmentStart(segment), segmentPointAt(segment, 0), 1e-9)).toBe(true);
    expect(equals(segmentEnd(segment), segmentPointAt(segment, 1), 1e-9)).toBe(true);
  });

  it('la tangente es unitaria', () => {
    for (let i = 0; i <= 10; i++) {
      expect(length(segmentTangent(segment, i / 10))).toBeCloseTo(1, 6);
    }
  });

  /*
   * La normal izquierda debe ser perpendicular a la tangente y estar girada
   * +90°. El convenio de lado es lo que hará inequívoco el margen de costura.
   */
  it('la normal es unitaria y perpendicular a la tangente', () => {
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const tangent = segmentTangent(segment, t);
      const normal = segmentNormal(segment, t);

      expect(length(normal)).toBeCloseTo(1, 6);
      expect(dot(tangent, normal)).toBeCloseTo(0, 6);
      // El giro es +90°: cross(tangente, normal) = +1
      expect(tangent.x * normal.y - tangent.y * normal.x).toBeCloseTo(1, 6);
    }
  });

  it('invertir intercambia los extremos y conserva la longitud', () => {
    const reversed = segmentReverse(segment);

    expect(equals(segmentStart(reversed), segmentEnd(segment), 1e-9)).toBe(true);
    expect(equals(segmentEnd(reversed), segmentStart(segment), 1e-9)).toBe(true);
    expect(segmentLength(reversed)).toBeCloseTo(segmentLength(segment), 6);
  });

  it('partir conserva la geometría y suma la longitud', () => {
    const [left, right] = segmentSplitAt(segment, 0.4);

    expect(equals(segmentEnd(left), segmentStart(right), 1e-9)).toBe(true);
    expect(equals(segmentEnd(left), segmentPointAt(segment, 0.4), 1e-9)).toBe(true);
    expect(segmentLength(left) + segmentLength(right)).toBeCloseTo(segmentLength(segment), 4);
  });

  it('la caja envolvente contiene el segmento', () => {
    const bounds = segmentBounds(segment);

    for (let i = 0; i <= 50; i++) {
      const p = segmentPointAt(segment, i / 50);
      expect(p.x).toBeGreaterThanOrEqual(bounds.min.x - 1e-6);
      expect(p.x).toBeLessThanOrEqual(bounds.max.x + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(bounds.min.y - 1e-6);
      expect(p.y).toBeLessThanOrEqual(bounds.max.y + 1e-6);
    }
  });

  it('la polilínea empieza y acaba en los extremos', () => {
    const polyline = segmentToPolyline(segment, 0.05);
    const first = polyline[0];
    const last = polyline.at(-1);

    expect(first).toBeDefined();
    expect(last).toBeDefined();
    if (first === undefined || last === undefined) return;

    expect(equals(first, segmentStart(segment), 1e-9)).toBe(true);
    expect(equals(last, segmentEnd(segment), 1e-9)).toBe(true);
  });

  it('el punto más próximo está sobre el segmento', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -300, max: 400, noNaN: true }),
        fc.double({ min: -300, max: 400, noNaN: true }),
        (x, y) => {
          const query = vec2(x, y);
          const result = closestPointOnSegment(segment, query);

          expect(result.t).toBeGreaterThanOrEqual(0);
          expect(result.t).toBeLessThanOrEqual(1);
          expect(equals(result.point, segmentPointAt(segment, result.t), 1e-6)).toBe(true);
          expect(result.distance).toBeCloseTo(distance(query, result.point), 6);

          // Ningún punto muestreado está más cerca.
          for (let i = 0; i <= 60; i++) {
            expect(result.distance).toBeLessThanOrEqual(
              distance(query, segmentPointAt(segment, i / 60)) + 1e-3,
            );
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('segmentPointAtLength', () => {
  /*
   * La diferencia entre parámetro y longitud recorrida es el motivo de que
   * exista esta función. En una recta coinciden; en una cúbica no, y usar el
   * parámetro para colocar un piquete lo desplazaría varios milímetros.
   */
  it('en una recta coincide con el parámetro proporcional', () => {
    const total = segmentLength(LINE);
    expect(equals(segmentPointAtLength(LINE, total / 2), segmentPointAt(LINE, 0.5), 1e-9)).toBe(
      true,
    );
  });

  it('en una cúbica NO coincide con el parámetro', () => {
    const total = segmentLength(CUBIC);
    const byLength = segmentPointAtLength(CUBIC, total / 2);
    const byParameter = segmentPointAt(CUBIC, 0.5);

    expect(distance(byLength, byParameter)).toBeGreaterThan(0.5);
  });

  it('en un arco la parametrización sí es proporcional', () => {
    const total = arcLength(ARC);
    expect(equals(segmentPointAtLength(ARC, total / 2), segmentPointAt(ARC, 0.5), 1e-9)).toBe(
      true,
    );
  });
});

describe('conversión a cúbicas', () => {
  it('cada tipo produce cúbicas que recorren la misma geometría', () => {
    for (const { segment } of ALL) {
      const cubics = segmentToCubics(segment);
      expect(cubics.length).toBeGreaterThan(0);

      const first = cubics[0];
      const last = cubics.at(-1);
      if (first === undefined || last === undefined) continue;

      expect(equals(first.p0, segmentStart(segment), 1e-6)).toBe(true);
      expect(equals(last.p3, segmentEnd(segment), 1e-6)).toBe(true);
    }
  });
});

describe('transformación', () => {
  it('rectas y cúbicas conservan su tipo', () => {
    const m = compose(translation(10, 20), rotation(0.5), scaling(2));

    expect(transformSegment(LINE, m)).toHaveLength(1);
    expect(transformSegment(LINE, m)[0]?.kind).toBe('line');
    expect(transformSegment(CUBIC, m)[0]?.kind).toBe('cubic');
  });

  it('un arco bajo semejanza sigue siendo un arco', () => {
    const result = transformSegment(ARC, compose(rotation(0.4), scaling(3)));
    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe('arc');
  });

  /*
   * Bajo escalado no uniforme, la imagen de una circunferencia es una elipse.
   * El modelo no representa elipses, así que la única respuesta correcta es
   * sustituir el arco por cúbicas — y NO devolver un arco incorrecto, que es
   * el error silencioso que esta comprobación previene.
   */
  it('un arco bajo escalado no uniforme se convierte en cúbicas', () => {
    const result = transformSegment(ARC, scaling(2, 5));

    expect(result.length).toBeGreaterThan(1);
    for (const piece of result) expect(piece.kind).toBe('cubic');

    // La geometría resultante sigue siendo la elipse esperada.
    const first = result[0];
    const last = result.at(-1);
    if (first === undefined || last === undefined) return;

    const start = segmentStart(ARC);
    const end = segmentEnd(ARC);
    expect(equals(segmentStart(first), vec2(start.x * 2, start.y * 5), 1e-6)).toBe(true);
    expect(equals(segmentEnd(last), vec2(end.x * 2, end.y * 5), 1e-6)).toBe(true);
  });

  it('una rotación conserva las longitudes de todos los tipos', () => {
    const m = rotation(0.83);

    for (const { segment } of ALL) {
      const before = segmentLength(segment);
      const after = transformSegment(segment, m).reduce(
        (sum, piece) => sum + segmentLength(piece),
        0,
      );
      expect(after).toBeCloseTo(before, 4);
    }
  });
});

describe('distancePointToSegment', () => {
  it('coincide con la distancia del punto más próximo', () => {
    for (const { segment } of ALL) {
      const query = vec2(37, -55);
      expect(distancePointToSegment(segment, query)).toBeCloseTo(
        closestPointOnSegment(segment, query).distance,
        9,
      );
    }
  });
});
