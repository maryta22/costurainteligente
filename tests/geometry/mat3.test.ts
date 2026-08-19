import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  IDENTITY,
  applyToPoint,
  applyToVector,
  compose,
  determinant,
  invert,
  isMirrored,
  isSimilarity,
  multiply,
  reflection,
  rotation,
  rotationAround,
  scaling,
  toSvgMatrix,
  translation,
  uniformScale,
} from '@core/geometry/mat3';
import { distance, equals, vec2 } from '@core/geometry/vec2';

const coord = () => fc.double({ min: -500, max: 500, noNaN: true });
const point = () => fc.tuple(coord(), coord()).map(([x, y]) => vec2(x, y));
const angle = () => fc.double({ min: -Math.PI, max: Math.PI, noNaN: true });

describe('identidad y composición', () => {
  it('la identidad no mueve nada', () => {
    fc.assert(
      fc.property(point(), (p) => {
        expect(equals(applyToPoint(IDENTITY, p), p, 1e-12)).toBe(true);
      }),
    );
  });

  /*
   * `multiply(m, n)` aplica primero `n`. Comprobarlo explícitamente evita el
   * error clásico de transposición, que produce transformaciones que «casi»
   * funcionan y sólo se delatan al componer rotación con traslación.
   */
  it('multiply(m, n) aplica primero n', () => {
    const first = translation(10, 0);
    const then = scaling(2);
    const combined = multiply(then, first);

    expect(equals(applyToPoint(combined, vec2(0, 0)), vec2(20, 0), 1e-12)).toBe(true);
  });

  it('compose aplica de izquierda a derecha', () => {
    const m = compose(translation(100, 0), rotation(Math.PI / 2));
    // Rotar (10,0) 90° da (0,10); trasladar después da (100,10).
    expect(equals(applyToPoint(m, vec2(10, 0)), vec2(100, 10), 1e-9)).toBe(true);
  });
});

describe('rotación', () => {
  it('conserva las distancias', () => {
    fc.assert(
      fc.property(point(), point(), angle(), (a, b, radians) => {
        const m = rotation(radians);
        expect(distance(applyToPoint(m, a), applyToPoint(m, b))).toBeCloseTo(distance(a, b), 6);
      }),
    );
  });

  it('rotationAround deja quieto el pivote', () => {
    fc.assert(
      fc.property(point(), angle(), (pivot, radians) => {
        expect(equals(applyToPoint(rotationAround(pivot, radians), pivot), pivot, 1e-8)).toBe(
          true,
        );
      }),
    );
  });
});

describe('vector frente a punto', () => {
  /*
   * Una dirección de hilo o una tangente deben rotarse y escalarse pero NUNCA
   * trasladarse. Confundir ambos casos produce hilos que se desplazan al mover
   * la pieza — un error sutil que sólo se ve al cortar.
   */
  it('applyToVector ignora la traslación', () => {
    const m = compose(translation(1000, -500), rotation(Math.PI / 2));
    const direction = vec2(1, 0);

    expect(equals(applyToVector(m, direction), vec2(0, 1), 1e-9)).toBe(true);
    expect(equals(applyToPoint(m, direction), vec2(1000, -499), 1e-9)).toBe(true);
  });
});

describe('reflexión', () => {
  it('refleja respecto al eje vertical', () => {
    const m = reflection(vec2(0, 0), vec2(0, 1));
    expect(equals(applyToPoint(m, vec2(30, 10)), vec2(-30, 10), 1e-9)).toBe(true);
  });

  it('refleja respecto a un eje arbitrario', () => {
    const m = reflection(vec2(0, 0), vec2(1, 1));
    expect(equals(applyToPoint(m, vec2(1, 0)), vec2(0, 1), 1e-9)).toBe(true);
  });

  it('es involutiva', () => {
    fc.assert(
      fc.property(point(), point(), point(), (p, a, b) => {
        fc.pre(distance(a, b) > 1);
        const m = reflection(a, b);
        expect(equals(applyToPoint(m, applyToPoint(m, p)), p, 1e-6)).toBe(true);
      }),
    );
  });

  it('tiene determinante negativo — invierte la orientación', () => {
    expect(isMirrored(reflection(vec2(0, 0), vec2(1, 1)))).toBe(true);
    expect(isMirrored(rotation(1.3))).toBe(false);
    expect(isMirrored(scaling(2))).toBe(false);
  });
});

describe('semejanzas', () => {
  /*
   * Sólo bajo una semejanza la imagen de una circunferencia sigue siendo una
   * circunferencia. De esta comprobación depende que un arco se pueda
   * transformar como arco o haya que convertirlo a cúbicas.
   */
  it('reconoce rotación, escalado uniforme y reflexión', () => {
    expect(isSimilarity(rotation(0.7))).toBe(true);
    expect(isSimilarity(scaling(3))).toBe(true);
    expect(isSimilarity(reflection(vec2(0, 0), vec2(1, 2)))).toBe(true);
    expect(isSimilarity(compose(translation(5, 5), rotation(1), scaling(2)))).toBe(true);
  });

  it('rechaza escalado no uniforme y cizalla', () => {
    expect(isSimilarity(scaling(2, 3))).toBe(false);
    expect(isSimilarity({ a: 1, b: 0, c: 0.5, d: 1, e: 0, f: 0 })).toBe(false);
  });

  it('uniformScale devuelve el factor', () => {
    expect(uniformScale(scaling(2.5))).toBeCloseTo(2.5, 9);
    expect(uniformScale(compose(rotation(1.1), scaling(4)))).toBeCloseTo(4, 9);
  });
});

describe('inversión', () => {
  it('deshace la transformación', () => {
    fc.assert(
      fc.property(point(), coord(), coord(), angle(), (p, dx, dy, radians) => {
        const m = compose(translation(dx, dy), rotation(radians), scaling(1.7));
        const inverse = invert(m);

        expect(inverse).not.toBeNull();
        if (inverse === null) return;

        expect(equals(applyToPoint(inverse, applyToPoint(m, p)), p, 1e-6)).toBe(true);
      }),
    );
  });

  it('una matriz singular no se puede invertir', () => {
    expect(invert(scaling(0, 1))).toBeNull();
  });

  it('determinante de un escalado es el producto de factores', () => {
    expect(determinant(scaling(2, 3))).toBeCloseTo(6, 9);
  });
});

describe('serialización SVG', () => {
  it('emite las componentes en el orden del atributo transform', () => {
    expect(toSvgMatrix({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 })).toBe('matrix(1 2 3 4 5 6)');
  });
});
