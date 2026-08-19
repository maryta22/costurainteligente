import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { TAU, clamp, inverseLerp, lerp, niceStep, normalizeAngle, roundToStep } from '@core/geometry/math';
import { gridLines, snapToGrid, visibleGridStep } from '@core/geometry/grid';
import { vec2 } from '@core/geometry/vec2';

describe('clamp y lerp', () => {
  it('clamp respeta los límites', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
  });

  it('inverseLerp deshace lerp', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e3, max: 1e3, noNaN: true }),
        fc.double({ min: -1e3, max: 1e3, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (a, b, t) => {
          fc.pre(Math.abs(b - a) > 1e-3);
          expect(inverseLerp(a, b, lerp(a, b, t))).toBeCloseTo(t, 6);
        },
      ),
    );
  });

  it('inverseLerp no divide por cero en un intervalo degenerado', () => {
    expect(inverseLerp(5, 5, 5)).toBe(0);
  });
});

describe('normalizeAngle', () => {
  it('devuelve siempre [0, 2π)', () => {
    fc.assert(
      fc.property(fc.double({ min: -100, max: 100, noNaN: true }), (angle) => {
        const n = normalizeAngle(angle);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThan(TAU);
      }),
    );
  });

  /*
   * Regresión. Un negativo diminuto hacía que `r + TAU` se redondease a
   * exactamente `TAU`, devolviendo un valor fuera del intervalo semiabierto.
   */
  it('un ángulo negativo diminuto devuelve 0, no 2π', () => {
    expect(normalizeAngle(-1e-17)).toBe(0);
    expect(normalizeAngle(-Number.MIN_VALUE)).toBeLessThan(TAU);
  });

  it('conserva los valores ya normalizados', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI, 12);
  });
});

describe('niceStep', () => {
  it('devuelve valores de la serie 1-2-5', () => {
    expect(niceStep(0.7)).toBeCloseTo(1, 12);
    expect(niceStep(1)).toBeCloseTo(1, 12);
    expect(niceStep(1.5)).toBeCloseTo(2, 12);
    expect(niceStep(3)).toBeCloseTo(5, 12);
    expect(niceStep(7)).toBeCloseTo(10, 12);
    expect(niceStep(23)).toBeCloseTo(50, 12);
    expect(niceStep(120)).toBeCloseTo(200, 12);
  });

  it('nunca devuelve un paso menor que el solicitado', () => {
    fc.assert(
      fc.property(fc.double({ min: 1e-3, max: 1e5, noNaN: true }), (min) => {
        expect(niceStep(min)).toBeGreaterThanOrEqual(min - 1e-9);
      }),
    );
  });

  it('una entrada no válida no rompe la rejilla', () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-3)).toBe(1);
    expect(niceStep(Number.NaN)).toBe(1);
  });
});

describe('rejilla', () => {
  it('roundToStep ajusta al múltiplo más próximo', () => {
    expect(roundToStep(12, 5)).toBe(10);
    expect(roundToStep(13, 5)).toBe(15);
    expect(roundToStep(-12, 5)).toBe(-10);
  });

  it('snapToGrid cae siempre sobre un múltiplo del paso', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        fc.constantFrom(1, 5, 10, 25),
        (x, y, step) => {
          const snapped = snapToGrid(vec2(x, y), step);
          expect(Math.abs(snapped.x % step)).toBeLessThan(1e-6);
          expect(Math.abs(snapped.y % step)).toBeLessThan(1e-6);
        },
      ),
    );
  });

  it('un paso no positivo deja el punto intacto', () => {
    const p = vec2(3.7, -1.2);
    expect(snapToGrid(p, 0)).toBe(p);
  });

  /*
   * Al alejar la vista, el paso visible crece para que las líneas no se
   * amontonen; al acercarla nunca baja del paso lógico del documento.
   */
  it('visibleGridStep crece al reducir la escala y nunca baja del paso base', () => {
    const base = 10;
    const cerca = visibleGridStep(base, 4, 9);
    const lejos = visibleGridStep(base, 0.05, 9);

    expect(cerca).toBeGreaterThanOrEqual(base);
    expect(lejos).toBeGreaterThan(cerca);
  });

  it('gridLines cubre el rectángulo pedido', () => {
    const rect = { min: vec2(-12, -7), max: vec2(33, 21) };
    const { vertical, horizontal } = gridLines(rect, 10);

    expect(vertical).toEqual([-10, 0, 10, 20, 30]);
    expect(horizontal).toEqual([0, 10, 20]);
  });

  it('gridLines se rinde en lugar de generar millones de elementos', () => {
    const rect = { min: vec2(-1e6, -1e6), max: vec2(1e6, 1e6) };
    const { vertical, horizontal } = gridLines(rect, 1);

    expect(vertical).toHaveLength(0);
    expect(horizontal).toHaveLength(0);
  });
});
