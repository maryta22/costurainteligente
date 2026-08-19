import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  rootsInUnitInterval,
  solveCubic,
  solveLinear,
  solveQuadratic,
} from '@core/numeric/roots';

const coefficient = () => fc.double({ min: -50, max: 50, noNaN: true });

const evaluateCubic = (a: number, b: number, c: number, d: number, x: number): number =>
  ((a * x + b) * x + c) * x + d;

describe('solveLinear', () => {
  it('resuelve el caso general', () => {
    expect(solveLinear(2, -6)).toEqual([3]);
  });

  it('sin pendiente no hay raíz', () => {
    expect(solveLinear(0, 5)).toEqual([]);
  });
});

describe('solveQuadratic', () => {
  it('devuelve las raíces ordenadas', () => {
    expect(solveQuadratic(1, -3, 2)).toEqual([1, 2]);
  });

  it('raíz doble', () => {
    const roots = solveQuadratic(1, -2, 1);
    expect(roots).toHaveLength(1);
    expect(roots[0]).toBeCloseTo(1, 12);
  });

  it('sin raíces reales devuelve lista vacía', () => {
    expect(solveQuadratic(1, 0, 1)).toEqual([]);
  });

  it('degrada a lineal si el coeficiente principal es nulo', () => {
    expect(solveQuadratic(0, 2, -6)).toEqual([3]);
  });

  /*
   * La prueba que justifica no usar la fórmula escolar. Con b² ≫ 4ac, uno de
   * los numeradores `−b ± √Δ` resta cantidades casi iguales y pierde casi toda
   * su precisión. Aquí las raíces son 1e-8 y 1e8: la formulación ingenua
   * devuelve un error relativo enorme en la pequeña.
   */
  it('no sufre cancelación catastrófica con raíces de escalas muy dispares', () => {
    // (x − 1e8)(x − 1e−8) = x² − (1e8 + 1e−8)x + 1
    const roots = solveQuadratic(1, -(1e8 + 1e-8), 1);

    expect(roots).toHaveLength(2);
    expect(roots[0]).toBeCloseTo(1e-8, 15);
    expect(roots[1]).toBeCloseTo(1e8, 0);
  });

  it('las raíces anulan el polinomio', () => {
    fc.assert(
      fc.property(coefficient(), coefficient(), coefficient(), (a, b, c) => {
        fc.pre(Math.abs(a) > 0.1);
        for (const root of solveQuadratic(a, b, c)) {
          expect(Math.abs((a * root + b) * root + c)).toBeLessThan(1e-6);
        }
      }),
    );
  });
});

describe('solveCubic', () => {
  it('encuentra las tres raíces reales', () => {
    // (x + 1)(x − 2)(x − 3) = x³ − 4x² + x + 6
    const roots = solveCubic(1, -4, 1, 6);
    expect(roots).toHaveLength(3);
    expect(roots[0]).toBeCloseTo(-1, 9);
    expect(roots[1]).toBeCloseTo(2, 9);
    expect(roots[2]).toBeCloseTo(3, 9);
  });

  it('encuentra la única raíz real cuando las otras son complejas', () => {
    // x³ + x + 1 tiene una sola raíz real
    const roots = solveCubic(1, 0, 1, 1);
    expect(roots).toHaveLength(1);
    expect(evaluateCubic(1, 0, 1, 1, roots[0] ?? 0)).toBeCloseTo(0, 9);
  });

  it('raíz triple', () => {
    // (x − 2)³
    for (const root of solveCubic(1, -6, 12, -8)) {
      expect(root).toBeCloseTo(2, 5);
    }
  });

  it('degrada a cuadrática si el coeficiente principal es nulo', () => {
    expect(solveCubic(0, 1, -3, 2)).toEqual([1, 2]);
  });

  /*
   * Casus irreducibilis: con tres raíces reales, la fórmula de Cardano exige
   * raíces cúbicas de complejos y en coma flotante deja residuos imaginarios.
   * Por eso se usa la forma trigonométrica. Esta propiedad lo verifica sobre
   * cúbicas construidas a partir de tres raíces reales conocidas.
   */
  it('recupera cualquier terna de raíces reales', () => {
    /*
     * Las raíces se generan SEPARADAS por construcción, con una raíz base y dos
     * saltos positivos, en lugar de generarlas libres y descartar las juntas.
     * Descartar habría rechazado la mayoría de los casos. La separación no es
     * una concesión: las raíces casi múltiples están mal condicionadas por
     * naturaleza —una perturbación de 1e-16 en un coeficiente las desplaza
     * ~1e-8— y ninguna implementación puede recuperarlas con precisión.
     */
    fc.assert(
      fc.property(
        fc.double({ min: -20, max: 20, noNaN: true }),
        fc.double({ min: 0.2, max: 15, noNaN: true }),
        fc.double({ min: 0.2, max: 15, noNaN: true }),
        (base, gap1, gap2) => {
          const expected = [base, base + gap1, base + gap1 + gap2];
          const [r1, r2, r3] = expected;
          if (r1 === undefined || r2 === undefined || r3 === undefined) return;

          const b = -(r1 + r2 + r3);
          const c = r1 * r2 + r2 * r3 + r3 * r1;
          const d = -(r1 * r2 * r3);

          const found = solveCubic(1, b, c, d);
          expect(found).toHaveLength(3);

          for (let i = 0; i < 3; i++) {
            expect(found[i]).toBeCloseTo(expected[i] ?? 0, 4);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('todas las raíces devueltas anulan el polinomio', () => {
    fc.assert(
      fc.property(coefficient(), coefficient(), coefficient(), coefficient(), (a, b, c, d) => {
        fc.pre(Math.abs(a) > 1);
        for (const root of solveCubic(a, b, c, d)) {
          expect(Math.abs(evaluateCubic(a, b, c, d, root))).toBeLessThan(1e-4);
        }
      }),
    );
  });
});

describe('rootsInUnitInterval', () => {
  it('descarta lo que cae fuera de [0, 1]', () => {
    expect(rootsInUnitInterval([-0.5, 0.25, 0.75, 1.5])).toEqual([0.25, 0.75]);
  });

  it('recupera las raíces desplazadas por redondeo justo fuera del extremo', () => {
    expect(rootsInUnitInterval([-1e-13, 1 + 1e-13])).toEqual([0, 1]);
  });

  it('elimina duplicados', () => {
    expect(rootsInUnitInterval([0.5, 0.5 + 1e-12, 0.5 - 1e-12])).toHaveLength(1);
  });
});
