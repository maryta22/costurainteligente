import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  closestPointOnLine,
  distancePointToLine,
  lineImplicit,
  lineLength,
  lineMidpoint,
  lineNormal,
  linePointAt,
  lineSeg,
  offsetLine,
  perpendicularFoot,
} from '@core/geometry/line';
import { distance, equals, length, vec2 } from '@core/geometry/vec2';

const coord = () => fc.double({ min: -1e3, max: 1e3, noNaN: true });
const point = () => fc.tuple(coord(), coord()).map(([x, y]) => vec2(x, y));

describe('métricas básicas', () => {
  it('la longitud sigue el teorema de Pitágoras', () => {
    expect(lineLength(lineSeg(vec2(0, 0), vec2(3, 4)))).toBeCloseTo(5, 12);
  });

  it('un segmento degenerado mide cero', () => {
    expect(lineLength(lineSeg(vec2(7, 7), vec2(7, 7)))).toBe(0);
  });

  it('t = 0.5 coincide con el punto medio', () => {
    fc.assert(
      fc.property(point(), point(), (a, b) => {
        const s = lineSeg(a, b);
        expect(equals(linePointAt(s, 0.5), lineMidpoint(s), 1e-9)).toBe(true);
      }),
    );
  });
});

describe('normal', () => {
  it('es unitaria y queda a la izquierda del recorrido', () => {
    // Recorriendo hacia +X, la izquierda es +Y.
    expect(equals(lineNormal(lineSeg(vec2(0, 0), vec2(10, 0))), vec2(0, 1), 1e-9)).toBe(true);
    // Recorriendo hacia +Y, la izquierda es −X.
    expect(equals(lineNormal(lineSeg(vec2(0, 0), vec2(0, 10))), vec2(-1, 0), 1e-9)).toBe(true);
  });

  it('es perpendicular al segmento y de módulo 1', () => {
    fc.assert(
      fc.property(point(), point(), (a, b) => {
        fc.pre(distance(a, b) > 1);
        const s = lineSeg(a, b);
        const n = lineNormal(s);

        expect(length(n)).toBeCloseTo(1, 9);
        expect(n.x * (b.x - a.x) + n.y * (b.y - a.y)).toBeCloseTo(0, 6);
      }),
    );
  });
});

describe('closestPointOnLine', () => {
  it('la proyección cae dentro del segmento', () => {
    fc.assert(
      fc.property(point(), point(), point(), (a, b, p) => {
        const result = closestPointOnLine(lineSeg(a, b), p);
        expect(result.t).toBeGreaterThanOrEqual(0);
        expect(result.t).toBeLessThanOrEqual(1);
      }),
    );
  });

  it('ningún punto muestreado del segmento está más cerca', () => {
    fc.assert(
      fc.property(point(), point(), point(), (a, b, p) => {
        const s = lineSeg(a, b);
        const best = closestPointOnLine(s, p).distance;

        for (let i = 0; i <= 20; i++) {
          expect(best).toBeLessThanOrEqual(distance(p, linePointAt(s, i / 20)) + 1e-6);
        }
      }),
    );
  });

  it('satura fuera de los extremos en lugar de extender la recta', () => {
    const s = lineSeg(vec2(0, 0), vec2(10, 0));

    const before = closestPointOnLine(s, vec2(-50, 0));
    expect(before.t).toBe(0);
    expect(equals(before.point, vec2(0, 0))).toBe(true);

    const after = closestPointOnLine(s, vec2(50, 0));
    expect(after.t).toBe(1);
    expect(equals(after.point, vec2(10, 0))).toBe(true);
  });

  it('un segmento degenerado devuelve su extremo sin producir NaN', () => {
    const result = closestPointOnLine(lineSeg(vec2(4, 4), vec2(4, 4)), vec2(0, 0));
    expect(result.t).toBe(0);
    expect(result.distance).toBeCloseTo(Math.hypot(4, 4), 12);
  });

  /*
   * Regresión de análisis dimensional. El umbral de degeneración comparaba una
   * longitud AL CUADRADO contra una tolerancia lineal, lo que trataba como
   * puntos todos los segmentos de menos de 0.001 mm y devolvía el extremo
   * equivocado.
   */
  it('un segmento micrométrico sigue siendo un segmento', () => {
    const result = closestPointOnLine(lineSeg(vec2(0, 1e-3), vec2(0, 0)), vec2(0, 0));

    expect(result.distance).toBeCloseTo(0, 12);
    expect(result.t).toBeCloseTo(1, 9);
  });
});

describe('distancePointToLine', () => {
  it('la distancia perpendicular es la altura', () => {
    expect(distancePointToLine(lineSeg(vec2(0, 0), vec2(10, 0)), vec2(5, 3))).toBeCloseTo(3, 12);
  });

  it('un punto sobre el segmento está a distancia cero', () => {
    expect(distancePointToLine(lineSeg(vec2(0, 0), vec2(10, 10)), vec2(5, 5))).toBeCloseTo(0, 12);
  });
});

describe('perpendicularFoot', () => {
  /*
   * A diferencia de `closestPointOnLine`, el pie de la perpendicular NO se
   * satura: cae sobre la recta infinita. Es la construcción de trazado
   * «bajar una perpendicular», que muchas veces cae fuera del tramo dibujado.
   */
  it('cae sobre la recta infinita, aunque sea fuera del segmento', () => {
    const s = lineSeg(vec2(0, 0), vec2(10, 0));
    expect(equals(perpendicularFoot(s, vec2(50, 7)), vec2(50, 0), 1e-9)).toBe(true);
    expect(equals(perpendicularFoot(s, vec2(-20, 7)), vec2(-20, 0), 1e-9)).toBe(true);
  });
});

describe('lineImplicit', () => {
  it('vale cero sobre la recta y cambia de signo a cada lado', () => {
    const s = lineSeg(vec2(0, 0), vec2(10, 0));

    expect(lineImplicit(s, vec2(5, 0))).toBeCloseTo(0, 12);
    expect(lineImplicit(s, vec2(5, 1))).toBeGreaterThan(0); // izquierda
    expect(lineImplicit(s, vec2(5, -1))).toBeLessThan(0); // derecha
  });
});

describe('offsetLine', () => {
  it('desplaza hacia la normal izquierda conservando la dirección', () => {
    const s = lineSeg(vec2(0, 0), vec2(100, 0));
    const offset = offsetLine(s, 10);

    expect(equals(offset.a, vec2(0, 10), 1e-9)).toBe(true);
    expect(equals(offset.b, vec2(100, 10), 1e-9)).toBe(true);
    expect(lineLength(offset)).toBeCloseTo(lineLength(s), 9);
  });

  it('un desplazamiento negativo va hacia la derecha', () => {
    const offset = offsetLine(lineSeg(vec2(0, 0), vec2(100, 0)), -10);
    expect(offset.a.y).toBeCloseTo(-10, 9);
  });

  it('el segmento desplazado queda a la distancia pedida', () => {
    fc.assert(
      fc.property(point(), point(), fc.double({ min: 1, max: 50, noNaN: true }), (a, b, d) => {
        fc.pre(distance(a, b) > 1);
        const s = lineSeg(a, b);
        expect(distancePointToLine(s, offsetLine(s, d).a)).toBeCloseTo(d, 6);
      }),
    );
  });
});
