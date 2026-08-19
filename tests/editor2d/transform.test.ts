import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { screenSize } from '@core/geometry/screen';
import { vec2 } from '@core/geometry/vec2';
import { MAX_ZOOM, MIN_ZOOM, createViewport, worldToScreen } from '@core/geometry/viewport';

import { worldTransform } from '@editor2d/transform';

const NUMBER_PATTERN = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;

/**
 * Aplica manualmente la cadena de transformación SVG.
 *
 * SVG compone de derecha a izquierda: `translate(t) scale(s) translate(u)`
 * significa primero `u`, después `s`, después `t`.
 */
function applySvgTransform(transform: string, p: { x: number; y: number }) {
  const values = (transform.match(NUMBER_PATTERN) ?? []).map(Number);
  const [tx, ty, sx, sy, ux, uy] = values;

  if (
    tx === undefined || ty === undefined || sx === undefined ||
    sy === undefined || ux === undefined || uy === undefined
  ) {
    throw new Error(`Transformación no reconocida: ${transform}`);
  }

  return { x: tx + sx * (p.x + ux), y: ty + sy * (p.y + uy) };
}

describe('worldTransform', () => {
  /*
   * El render delega la conversión de coordenadas en el navegador mediante un
   * atributo `transform`, mientras que el test de acierto la calcula en
   * TypeScript con `worldToScreen`. Si ambas rutas divergieran, lo dibujado y
   * lo seleccionable dejarían de coincidir — un fallo especialmente difícil de
   * diagnosticar. Esta prueba ata las dos implementaciones.
   */
  it('coincide con worldToScreen', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -3000, max: 3000, noNaN: true }),
        fc.double({ min: -3000, max: 3000, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.double({ min: MIN_ZOOM, max: MAX_ZOOM, noNaN: true }),
        (x, y, cx, cy, zoom) => {
          const viewport = createViewport(vec2(cx, cy), zoom, screenSize(1440, 900));
          const point = vec2(x, y);

          const expected = worldToScreen(viewport, point);
          const actual = applySvgTransform(worldTransform(viewport), point);

          expect(actual.x).toBeCloseTo(expected.x, 6);
          expect(actual.y).toBeCloseTo(expected.y, 6);
        },
      ),
    );
  });

  it('la escala vertical es negativa — invierte el eje Y', () => {
    const transform = worldTransform(createViewport(vec2(0, 0), 1, screenSize(800, 600)));
    const [, , sx, sy] = (transform.match(NUMBER_PATTERN) ?? []).map(Number);

    expect(sx).toBeGreaterThan(0);
    expect(sy).toBeLessThan(0);
  });
});
