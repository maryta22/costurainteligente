import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  cubicBounds,
  cubicDerivative,
  cubicFromLine,
  cubicLength,
  cubicLengthUpTo,
  cubicPointAt,
  cubicPointAtLength,
  cubicReverse,
  cubicSeg,
  cubicSplitAt,
  cubicSubsegment,
  cubicTAtLength,
  cubicTangent,
  cubicToPolyline,
  cubicTransform,
} from '@core/geometry/cubic';
import type { CubicSeg } from '@core/geometry/cubic';
import { lineSeg } from '@core/geometry/line';
import { compose, rotation, scaling, translation } from '@core/geometry/mat3';
import { distance, equals, length, sub, vec2 } from '@core/geometry/vec2';

const coord = () => fc.double({ min: -500, max: 500, noNaN: true });
const point = () => fc.tuple(coord(), coord()).map(([x, y]) => vec2(x, y));
const curve = () =>
  fc.tuple(point(), point(), point(), point()).map(([a, b, c, d]) => cubicSeg(a, b, c, d));

/**
 * Referencia INDEPENDIENTE de la longitud: suma de cuerdas con muestreo denso.
 *
 * No comparte una sola línea de código con la cuadratura de Gauss-Legendre que
 * se quiere validar, así que un error de concepto en una no puede esconderse
 * en la otra. La suma de cuerdas subestima siempre, con error O(1/n²); con
 * 200 000 muestras queda muy por debajo de 1e-6 mm en las curvas de este test.
 */
function chordSumLength(c: CubicSeg, samples = 200_000): number {
  let total = 0;
  let previous = cubicPointAt(c, 0);

  for (let i = 1; i <= samples; i++) {
    const next = cubicPointAt(c, i / samples);
    total += distance(previous, next);
    previous = next;
  }

  return total;
}

describe('evaluación', () => {
  it('interpola los extremos', () => {
    fc.assert(
      fc.property(curve(), (c) => {
        expect(equals(cubicPointAt(c, 0), c.p0, 1e-9)).toBe(true);
        expect(equals(cubicPointAt(c, 1), c.p3, 1e-9)).toBe(true);
      }),
    );
  });

  it('una cúbica elevada desde una recta es esa recta', () => {
    const c = cubicFromLine(lineSeg(vec2(0, 0), vec2(90, 30)));

    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      expect(equals(cubicPointAt(c, t), vec2(90 * t, 30 * t), 1e-9)).toBe(true);
    }
  });

  it('la derivada en los extremos es 3× el vector de tirador', () => {
    const c = cubicSeg(vec2(0, 0), vec2(10, 0), vec2(20, 10), vec2(30, 10));
    expect(equals(cubicDerivative(c, 0), vec2(30, 0), 1e-9)).toBe(true);
    expect(equals(cubicDerivative(c, 1), vec2(30, 0), 1e-9)).toBe(true);
  });

  /*
   * Un tirador pegado a su extremo anula la derivada primera y deja la
   * dirección indefinida. Es un caso habitual —se usa para forzar una salida
   * recta— y la tangente debe seguir estando bien definida: en ese punto se
   * apoyan el margen de costura y la normal.
   */
  it('la tangente sobrevive a un punto de control repetido', () => {
    const c = cubicSeg(vec2(0, 0), vec2(0, 0), vec2(50, 20), vec2(100, 0));
    const tangent = cubicTangent(c, 0);

    expect(Number.isNaN(tangent.x)).toBe(false);
    expect(length(tangent)).toBeCloseTo(1, 9);
  });

  it('la tangente es unitaria en todo el recorrido', () => {
    fc.assert(
      fc.property(curve(), fc.double({ min: 0, max: 1, noNaN: true }), (c, t) => {
        fc.pre(distance(c.p0, c.p3) > 1);
        expect(length(cubicTangent(c, t))).toBeCloseTo(1, 6);
      }),
    );
  });
});

describe('subdivisión', () => {
  it('De Casteljau conserva la curva exactamente', () => {
    fc.assert(
      fc.property(curve(), fc.double({ min: 0.05, max: 0.95, noNaN: true }), (c, split) => {
        const [left, right] = cubicSplitAt(c, split);

        for (let i = 0; i <= 8; i++) {
          const u = i / 8;
          expect(equals(cubicPointAt(left, u), cubicPointAt(c, split * u), 1e-7)).toBe(true);
          expect(
            equals(cubicPointAt(right, u), cubicPointAt(c, split + (1 - split) * u), 1e-7),
          ).toBe(true);
        }
      }),
    );
  });

  it('cubicSubsegment extrae el tramo pedido', () => {
    const c = cubicSeg(vec2(0, 0), vec2(30, 90), vec2(70, -40), vec2(100, 50));
    const piece = cubicSubsegment(c, 0.25, 0.75);

    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      expect(equals(cubicPointAt(piece, u), cubicPointAt(c, 0.25 + 0.5 * u), 1e-7)).toBe(true);
    }
  });

  it('invertir intercambia los extremos y recorre igual', () => {
    fc.assert(
      fc.property(curve(), fc.double({ min: 0, max: 1, noNaN: true }), (c, t) => {
        expect(equals(cubicPointAt(cubicReverse(c), t), cubicPointAt(c, 1 - t), 1e-7)).toBe(true);
      }),
    );
  });
});

describe('caja envolvente exacta', () => {
  /*
   * La curva NO llega a sus puntos de control: la caja del polígono de control
   * sería (0,0)-(100,100), pero la altura real de esta cúbica es
   * y(t) = 300·t·(1−t), cuyo máximo en t = 0.5 vale 75.
   *
   * Esa holgura del 25 % es la que separa una poda eficiente de una que
   * multiplica el trabajo en las intersecciones y en el test de acierto.
   */
  it('es más ajustada que la del polígono de control', () => {
    const c = cubicSeg(vec2(0, 0), vec2(0, 100), vec2(100, 100), vec2(100, 0));
    const bounds = cubicBounds(c);

    expect(bounds.min.x).toBeCloseTo(0, 9);
    expect(bounds.max.x).toBeCloseTo(100, 9);
    expect(bounds.min.y).toBeCloseTo(0, 9);
    expect(bounds.max.y).toBeCloseTo(75, 9);
  });

  it('contiene la curva completa', () => {
    fc.assert(
      fc.property(curve(), (c) => {
        const bounds = cubicBounds(c);

        for (let i = 0; i <= 40; i++) {
          const p = cubicPointAt(c, i / 40);
          expect(p.x).toBeGreaterThanOrEqual(bounds.min.x - 1e-6);
          expect(p.x).toBeLessThanOrEqual(bounds.max.x + 1e-6);
          expect(p.y).toBeGreaterThanOrEqual(bounds.min.y - 1e-6);
          expect(p.y).toBeLessThanOrEqual(bounds.max.y + 1e-6);
        }
      }),
    );
  });
});

describe('longitud de arco — criterio de salida de la Fase 2', () => {
  it('una cúbica recta mide su cuerda', () => {
    const c = cubicFromLine(lineSeg(vec2(0, 0), vec2(300, 400)));
    expect(cubicLength(c)).toBeCloseTo(500, 9);
  });

  /*
   * CRITERIO DE ACEPTACIÓN: error por debajo de 0.01 mm frente a un método
   * independiente, sobre curvas del tamaño de una pieza real.
   */
  it('coincide con la suma densa de cuerdas por debajo de 0.001 mm', () => {
    const curves: readonly CubicSeg[] = [
      cubicSeg(vec2(0, 0), vec2(0, 200), vec2(200, 200), vec2(200, 0)),
      cubicSeg(vec2(0, 0), vec2(120, 300), vec2(-40, 260), vec2(180, 40)),
      cubicSeg(vec2(-150, 60), vec2(-20, -180), vec2(140, 190), vec2(300, -70)),
      // Sisa realista: arranque casi vertical y llegada casi horizontal.
      cubicSeg(vec2(0, 0), vec2(2, 60), vec2(40, 118), vec2(96, 124)),
    ];

    for (const c of curves) {
      const reference = chordSumLength(c);
      expect(Math.abs(cubicLength(c) - reference)).toBeLessThan(0.001);
    }
  });

  /*
   * Se pide tolerancia estricta en las tres integraciones. Con la de por
   * defecto, cada una puede desviarse 0.001 mm y la suma de dos mitades
   * acumularía hasta 0.002 mm frente al total: comparar por debajo de eso
   * estaría midiendo el ajuste de la tolerancia, no la aditividad.
   */
  it('la longitud es aditiva al partir la curva', () => {
    const tight = 1e-9;

    fc.assert(
      fc.property(curve(), fc.double({ min: 0.05, max: 0.95, noNaN: true }), (c, t) => {
        const [left, right] = cubicSplitAt(c, t);
        const parts = cubicLength(left, tight) + cubicLength(right, tight);
        expect(Math.abs(parts - cubicLength(c, tight))).toBeLessThan(1e-6);
      }),
      { numRuns: 60 },
    );
  });

  it('la cuerda nunca supera la longitud de la curva', () => {
    fc.assert(
      fc.property(curve(), (c) => {
        expect(cubicLength(c)).toBeGreaterThanOrEqual(distance(c.p0, c.p3) - 1e-6);
      }),
    );
  });

  it('cubicLengthUpTo crece de 0 al total', () => {
    const c = cubicSeg(vec2(0, 0), vec2(40, 120), vec2(160, 90), vec2(200, 0));
    const total = cubicLength(c);

    expect(cubicLengthUpTo(c, 0)).toBe(0);
    expect(cubicLengthUpTo(c, 1)).toBeCloseTo(total, 6);

    let previous = 0;
    for (let i = 1; i <= 20; i++) {
      const value = cubicLengthUpTo(c, i / 20);
      expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = value;
    }
  });
});

describe('parametrización por longitud de arco', () => {
  const c = cubicSeg(vec2(0, 0), vec2(10, 180), vec2(190, 160), vec2(200, 0));

  /*
   * El contrato de `cubicTAtLength` es converger hasta la tolerancia recibida,
   * no más allá. Con la de por defecto (LENGTH_TOL_MM = 0.001 mm) el residuo
   * queda en ese orden, muy por debajo del criterio de la fase (0.01 mm); si se
   * pide más precisión, la entrega.
   */
  it('cubicTAtLength invierte cubicLengthUpTo dentro de la tolerancia pedida', () => {
    const total = cubicLength(c);

    for (let i = 0; i <= 10; i++) {
      const target = (total * i) / 10;

      const withDefault = cubicLengthUpTo(c, cubicTAtLength(c, target));
      expect(Math.abs(withDefault - target)).toBeLessThanOrEqual(0.01);

      const tight = cubicLengthUpTo(c, cubicTAtLength(c, target, 1e-9), 1e-12);
      expect(Math.abs(tight - target)).toBeLessThan(1e-6);
    }
  });

  /*
   * La propiedad que hace posible el muestreo emparejable de dos aristas
   * cosidas (§7 de docs/ARCHITECTURE.md): repartir por longitud de arco da
   * tramos IGUALES, cosa que repartir el parámetro no consigue ni de lejos.
   */
  it('dividir por longitud produce tramos iguales, dividir por parámetro no', () => {
    const total = cubicLength(c);
    const pieces = 8;

    const byLength: number[] = [];
    const byParameter: number[] = [];

    let previousLengthPoint = cubicPointAt(c, 0);
    let previousParamPoint = cubicPointAt(c, 0);

    for (let i = 1; i <= pieces; i++) {
      const lengthPoint = cubicPointAtLength(c, (total * i) / pieces);
      const paramPoint = cubicPointAt(c, i / pieces);

      byLength.push(distance(previousLengthPoint, lengthPoint));
      byParameter.push(distance(previousParamPoint, paramPoint));

      previousLengthPoint = lengthPoint;
      previousParamPoint = paramPoint;
    }

    const spread = (values: number[]): number =>
      Math.max(...values) / Math.min(...values);

    expect(spread(byLength)).toBeLessThan(1.02);
    expect(spread(byParameter)).toBeGreaterThan(1.3);
  });

  it('satura fuera del recorrido', () => {
    expect(cubicTAtLength(c, -10)).toBe(0);
    expect(cubicTAtLength(c, 1e6)).toBe(1);
  });
});

describe('aplanamiento', () => {
  it('respeta la tolerancia de cuerda pedida', () => {
    const c = cubicSeg(vec2(0, 0), vec2(0, 200), vec2(200, 200), vec2(200, 0));

    for (const tolerance of [1, 0.1, 0.01]) {
      const polyline = cubicToPolyline(c, tolerance);

      // Se mide la desviación de la curva respecto a la polilínea muestreando
      // densamente y midiendo a la arista más próxima.
      let worst = 0;
      for (let i = 0; i <= 400; i++) {
        const p = cubicPointAt(c, i / 400);
        let best = Number.POSITIVE_INFINITY;

        for (let j = 0; j + 1 < polyline.length; j++) {
          const a = polyline[j];
          const b = polyline[j + 1];
          if (a === undefined || b === undefined) continue;

          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const lenSq = dx * dx + dy * dy;
          const u = lenSq === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
          best = Math.min(best, Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy)));
        }

        worst = Math.max(worst, best);
      }

      expect(worst).toBeLessThanOrEqual(tolerance);
    }
  });

  it('una tolerancia más fina produce más vértices', () => {
    const c = cubicSeg(vec2(0, 0), vec2(0, 200), vec2(200, 200), vec2(200, 0));
    expect(cubicToPolyline(c, 0.01).length).toBeGreaterThan(cubicToPolyline(c, 1).length);
  });

  it('una cúbica recta se aplana a dos puntos', () => {
    const c = cubicFromLine(lineSeg(vec2(0, 0), vec2(100, 0)));
    expect(cubicToPolyline(c, 0.05)).toHaveLength(2);
  });
});

describe('transformación', () => {
  /*
   * Las Bézier son invariantes afines: mover los cuatro controles equivale a
   * transformar la curva punto a punto. Por eso no hace falta remuestrear ni
   * reajustar al rotar una pieza.
   */
  it('es equivalente a transformar punto a punto', () => {
    const c = cubicSeg(vec2(0, 0), vec2(40, 120), vec2(160, 90), vec2(200, 0));
    const m = compose(translation(15, -8), rotation(0.7), scaling(1.4));
    const transformed = cubicTransform(c, m);

    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const direct = cubicPointAt(c, t);
      const expected = vec2(
        m.a * direct.x + m.c * direct.y + m.e,
        m.b * direct.x + m.d * direct.y + m.f,
      );
      expect(equals(cubicPointAt(transformed, t), expected, 1e-9)).toBe(true);
    }
  });

  it('una rotación conserva la longitud', () => {
    const c = cubicSeg(vec2(0, 0), vec2(40, 120), vec2(160, 90), vec2(200, 0));
    const rotated = cubicTransform(c, rotation(1.1));
    expect(cubicLength(rotated)).toBeCloseTo(cubicLength(c), 6);
  });

  it('un escalado uniforme multiplica la longitud por el factor', () => {
    const c = cubicSeg(vec2(0, 0), vec2(40, 120), vec2(160, 90), vec2(200, 0));
    expect(cubicLength(cubicTransform(c, scaling(3)))).toBeCloseTo(3 * cubicLength(c), 5);
  });

  it('trasladar no cambia la forma', () => {
    fc.assert(
      fc.property(curve(), coord(), coord(), (c, dx, dy) => {
        const moved = cubicTransform(c, translation(dx, dy));
        expect(equals(sub(moved.p0, c.p0), vec2(dx, dy), 1e-9)).toBe(true);
        expect(cubicLength(moved)).toBeCloseTo(cubicLength(c), 4);
      }),
      { numRuns: 40 },
    );
  });
});
