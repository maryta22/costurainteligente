import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  ORIGIN,
  add,
  angleOf,
  cross,
  distance,
  dot,
  equals,
  fromPolar,
  length,
  lerpVec,
  midpoint,
  mirror,
  normalize,
  perpLeft,
  perpRight,
  rotate,
  rotateAround,
  scale,
  sub,
  vec2,
} from '@core/geometry/vec2';
import { TAU, degToRad } from '@core/geometry/math';

const coord = () => fc.double({ min: -1e4, max: 1e4, noNaN: true });
const point = () => fc.tuple(coord(), coord()).map(([x, y]) => vec2(x, y));

describe('álgebra básica', () => {
  it('sub es la inversa de add', () => {
    fc.assert(
      fc.property(point(), point(), (a, b) => {
        expect(equals(sub(add(a, b), b), a, 1e-6)).toBe(true);
      }),
    );
  });

  it('distance coincide con length del vector diferencia', () => {
    fc.assert(
      fc.property(point(), point(), (a, b) => {
        expect(distance(a, b)).toBeCloseTo(length(sub(b, a)), 6);
      }),
    );
  });

  it('midpoint equidista de ambos extremos', () => {
    fc.assert(
      fc.property(point(), point(), (a, b) => {
        const m = midpoint(a, b);
        expect(distance(a, m)).toBeCloseTo(distance(b, m), 6);
      }),
    );
  });

  it('lerpVec en t=0 y t=1 devuelve los extremos', () => {
    const a = vec2(3, 7);
    const b = vec2(-11, 2);
    expect(equals(lerpVec(a, b, 0), a)).toBe(true);
    expect(equals(lerpVec(a, b, 1), b)).toBe(true);
  });
});

describe('normalize', () => {
  it('devuelve módulo 1 para vectores no nulos', () => {
    fc.assert(
      fc.property(point(), (v) => {
        fc.pre(length(v) > 1e-3);
        expect(length(normalize(v))).toBeCloseTo(1, 9);
      }),
    );
  });

  it('el vector nulo no produce NaN', () => {
    const n = normalize(ORIGIN);
    expect(Number.isNaN(n.x)).toBe(false);
    expect(Number.isNaN(n.y)).toBe(false);
    expect(equals(n, ORIGIN)).toBe(true);
  });
});

describe('perpendiculares y orientación', () => {
  it('perpLeft es ortogonal y gira +90°', () => {
    const v = vec2(3, 0);
    expect(dot(v, perpLeft(v))).toBeCloseTo(0, 9);
    expect(equals(perpLeft(v), vec2(0, 3), 1e-9)).toBe(true);
  });

  it('perpRight es la opuesta de perpLeft', () => {
    fc.assert(
      fc.property(point(), (v) => {
        expect(equals(perpRight(v), scale(perpLeft(v), -1), 1e-6)).toBe(true);
      }),
    );
  });

  /*
   * El signo del producto vectorial es la primitiva de orientación de la que
   * dependerán el sentido de recorrido de los contornos y el lado hacia el que
   * se aplica el margen de costura.
   */
  it('cross es positivo cuando b queda a la izquierda de a', () => {
    expect(cross(vec2(1, 0), vec2(0, 1))).toBeGreaterThan(0);
    expect(cross(vec2(1, 0), vec2(0, -1))).toBeLessThan(0);
    expect(cross(vec2(1, 0), vec2(2, 0))).toBeCloseTo(0, 12);
  });
});

describe('rotación', () => {
  it('conserva el módulo', () => {
    fc.assert(
      fc.property(point(), fc.double({ min: -TAU, max: TAU, noNaN: true }), (v, angle) => {
        expect(length(rotate(v, angle))).toBeCloseTo(length(v), 6);
      }),
    );
  });

  it('una vuelta completa devuelve el vector original', () => {
    fc.assert(
      fc.property(point(), (v) => {
        expect(equals(rotate(v, TAU), v, 1e-6)).toBe(true);
      }),
    );
  });

  it('rotateAround conserva la distancia al pivote', () => {
    fc.assert(
      fc.property(point(), point(), fc.double({ min: -TAU, max: TAU, noNaN: true }),
        (v, pivot, angle) => {
          expect(distance(rotateAround(v, pivot, angle), pivot)).toBeCloseTo(
            distance(v, pivot),
            5,
          );
        },
      ),
    );
  });
});

describe('fromPolar', () => {
  it('es la inversa de (length, angleOf)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 5000, noNaN: true }),
        fc.double({ min: -Math.PI + 1e-6, max: Math.PI, noNaN: true }),
        (d, angle) => {
          const v = fromPolar(d, angle);
          expect(length(v)).toBeCloseTo(d, 6);
          expect(angleOf(v)).toBeCloseTo(angle, 6);
        },
      ),
    );
  });

  it('90° apunta hacia Y positiva — arriba en mundo', () => {
    const v = fromPolar(50, degToRad(90));
    expect(v.x).toBeCloseTo(0, 9);
    expect(v.y).toBeCloseTo(50, 9);
  });
});

describe('mirror', () => {
  it('refleja respecto al eje vertical', () => {
    const reflected = mirror(vec2(30, 10), vec2(0, 0), vec2(0, 1));
    expect(equals(reflected, vec2(-30, 10), 1e-9)).toBe(true);
  });

  it('es involutiva', () => {
    fc.assert(
      fc.property(point(), point(), point(), (v, a, b) => {
        fc.pre(distance(a, b) > 1);
        expect(equals(mirror(mirror(v, a, b), a, b), v, 1e-4)).toBe(true);
      }),
    );
  });

  it('un punto sobre el eje no se mueve', () => {
    const onAxis = vec2(5, 5);
    expect(equals(mirror(onAxis, vec2(0, 0), vec2(10, 10)), onAxis, 1e-9)).toBe(true);
  });
});
