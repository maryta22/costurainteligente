import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { adaptiveQuadrature, gaussLegendre } from '@core/numeric/quadrature';
import { bisect, safeNewton, solveIncreasing } from '@core/numeric/solve';

describe('gaussLegendre', () => {
  /*
   * La regla de 8 puntos es EXACTA para polinomios de grado ≤ 15 (2n − 1). No
   * «muy precisa»: exacta salvo redondeo. Es la propiedad que hace que la
   * cuadratura adaptativa converja en una o dos bisecciones sobre curvas
   * suaves.
   */
  it('es exacta para polinomios de grado 15', () => {
    const f = (x: number): number => Math.pow(x, 15);
    // ∫₀¹ x¹⁵ dx = 1/16
    expect(gaussLegendre(f, 0, 1)).toBeCloseTo(1 / 16, 12);
  });

  it('integra exactamente una constante y una recta', () => {
    expect(gaussLegendre(() => 3, 2, 5)).toBeCloseTo(9, 12);
    expect(gaussLegendre((x) => x, 0, 4)).toBeCloseTo(8, 12);
  });

  it('es aditiva sobre subintervalos', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.1, max: 3, noNaN: true }), (k) => {
        const f = (x: number): number => Math.sin(k * x);
        const whole = gaussLegendre(f, 0, 1);
        const halves = gaussLegendre(f, 0, 0.5) + gaussLegendre(f, 0.5, 1);
        expect(halves).toBeCloseTo(whole, 8);
      }),
    );
  });
});

describe('adaptiveQuadrature', () => {
  it('reproduce integrales con primitiva conocida', () => {
    // ∫₀^π sin x dx = 2
    expect(adaptiveQuadrature(Math.sin, 0, Math.PI, 1e-12)).toBeCloseTo(2, 10);
    // ∫₁^e (1/x) dx = 1
    expect(adaptiveQuadrature((x) => 1 / x, 1, Math.E, 1e-12)).toBeCloseTo(1, 10);
    // ∫₀¹ 4/(1+x²) dx = π
    expect(adaptiveQuadrature((x) => 4 / (1 + x * x), 0, 1, 1e-12)).toBeCloseTo(Math.PI, 10);
  });

  /*
   * El integrando real de este proyecto es `|B'(t)|`, una raíz cuadrada. Las
   * raíces tienen derivadas no acotadas cerca de cero, que es donde una regla
   * fija falla y la subdivisión adaptativa gana.
   */
  it('resuelve integrandos con raíz cuadrada', () => {
    // ∫₀¹ √x dx = 2/3
    expect(adaptiveQuadrature(Math.sqrt, 0, 1, 1e-10)).toBeCloseTo(2 / 3, 7);
    // Longitud de la parábola y = x² en [0,1]: ∫₀¹ √(1+4x²) dx
    const expected = (2 * Math.sqrt(5) + Math.asinh(2)) / 4;
    expect(adaptiveQuadrature((x) => Math.sqrt(1 + 4 * x * x), 0, 1, 1e-12)).toBeCloseTo(
      expected,
      10,
    );
  });
});

describe('bisect', () => {
  it('encuentra la raíz de una función continua', () => {
    const root = bisect((x) => x * x - 2, 0, 2, { tolerance: 1e-12 });
    expect(root).not.toBeNull();
    expect(root ?? 0).toBeCloseTo(Math.SQRT2, 9);
  });

  it('devuelve null si el intervalo no encierra un cambio de signo', () => {
    expect(bisect((x) => x * x + 1, -1, 1)).toBeNull();
  });

  it('reconoce una raíz situada en un extremo', () => {
    expect(bisect((x) => x, 0, 1, { tolerance: 1e-12 })).toBe(0);
  });
});

describe('safeNewton', () => {
  it('converge sobre una función bien condicionada', () => {
    const x = safeNewton((t) => t * t - 2, (t) => 2 * t, 0, 2, 1, { tolerance: 1e-14 });
    expect(x).toBeCloseTo(Math.SQRT2, 12);
  });

  /*
   * La razón de ser de la salvaguarda. Con derivada nula en el punto de
   * partida, Newton puro divide por cero y diverge; aquí el paso se sustituye
   * por una bisección y la convergencia se mantiene.
   */
  it('no diverge si la derivada se anula en el punto inicial', () => {
    const f = (t: number): number => t * t * t - 1;
    const df = (t: number): number => 3 * t * t;

    const x = safeNewton(f, df, -1, 2, 0, { tolerance: 1e-12 });
    expect(x).toBeCloseTo(1, 8);
  });

  it('no se escapa del intervalo acotado', () => {
    const x = safeNewton((t) => Math.sin(t), (t) => Math.cos(t), 3, 3.5, 3.4, {
      tolerance: 1e-12,
    });
    expect(x).toBeGreaterThanOrEqual(3);
    expect(x).toBeLessThanOrEqual(3.5);
    expect(x).toBeCloseTo(Math.PI, 8);
  });
});

describe('solveIncreasing', () => {
  const f = (x: number): number => x * x;

  it('invierte una función creciente', () => {
    expect(solveIncreasing(f, 4, 0, 10, { tolerance: 1e-12 })).toBeCloseTo(2, 8);
  });

  /*
   * Saturación en lugar de fallo: pedir el punto situado a 500 mm de una curva
   * que mide 300 debe devolver su extremo. Es lo que necesita la colocación de
   * piquetes cuando una medida se pasa de largo.
   */
  it('satura fuera del recorrido', () => {
    expect(solveIncreasing(f, -5, 0, 10)).toBe(0);
    expect(solveIncreasing(f, 1e6, 0, 10)).toBe(10);
  });
});
