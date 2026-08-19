import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { screenPoint, screenSize } from '@core/geometry/screen';
import { vec2 } from '@core/geometry/vec2';
import { rectContainsRect } from '@core/geometry/rect';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  createViewport,
  fitToRect,
  panByScreen,
  scaleOf,
  screenToWorld,
  screenToWorldLength,
  setZoomAtScreen,
  visibleWorldRect,
  worldToScreen,
  worldToScreenLength,
} from '@core/geometry/viewport';
import { CSS_PX_PER_INCH, MM_PER_INCH, PX_PER_MM } from '@core/units';

const SIZE = screenSize(1200, 800);
const BASE = createViewport(vec2(0, 0), 1, SIZE);

/** Coordenadas de mundo realistas para un patrón: ±2 m. */
const worldCoord = () => fc.double({ min: -2000, max: 2000, noNaN: true });
const screenCoord = (max: number) => fc.double({ min: 0, max, noNaN: true });
const zoomValue = () => fc.double({ min: MIN_ZOOM, max: MAX_ZOOM, noNaN: true });

describe('escala física', () => {
  it('a zoom 1 la escala es exactamente 96 dpi', () => {
    expect(scaleOf(BASE)).toBeCloseTo(CSS_PX_PER_INCH / MM_PER_INCH, 12);
  });

  /*
   * CRITERIO DE SALIDA DE LA FASE 1.
   *
   * Un segmento que el modelo declara de 100 mm debe ocupar 100 mm físicos en
   * una pantalla estándar cuando el zoom es 1. En unidades CSS eso son
   * 100 / 25.4 pulgadas × 96 px/pulgada ≈ 377.95 px.
   */
  it('100 mm del modelo miden 100 mm en pantalla a escala 1:1', () => {
    const a = worldToScreen(BASE, vec2(0, 0));
    const b = worldToScreen(BASE, vec2(100, 0));

    const widthPx = b.x - a.x;
    const widthInches = widthPx / CSS_PX_PER_INCH;
    const widthMm = widthInches * MM_PER_INCH;

    expect(widthMm).toBeCloseTo(100, 10);
    expect(widthPx).toBeCloseTo(377.952755, 5);
  });

  it('worldToScreenLength y screenToWorldLength son inversas', () => {
    fc.assert(
      fc.property(zoomValue(), fc.double({ min: 0.1, max: 5000, noNaN: true }), (zoom, mm) => {
        const vp = createViewport(vec2(0, 0), zoom, SIZE);
        const back = screenToWorldLength(vp, worldToScreenLength(vp, mm));
        expect(back).toBeCloseTo(mm, 6);
      }),
    );
  });
});

describe('convenio de ejes (decisión D4)', () => {
  it('mayor Y de mundo produce menor Y de pantalla', () => {
    const low = worldToScreen(BASE, vec2(0, 10));
    const high = worldToScreen(BASE, vec2(0, 90));
    expect(high.y).toBeLessThan(low.y);
  });

  it('X conserva el sentido', () => {
    const left = worldToScreen(BASE, vec2(-50, 0));
    const right = worldToScreen(BASE, vec2(50, 0));
    expect(right.x).toBeGreaterThan(left.x);
  });

  it('el centro del viewport cae en el centro del lienzo', () => {
    const vp = createViewport(vec2(137, -42), 2.5, SIZE);
    const center = worldToScreen(vp, vp.center);
    expect(center.x).toBeCloseTo(SIZE.width / 2, 10);
    expect(center.y).toBeCloseTo(SIZE.height / 2, 10);
  });
});

describe('ida y vuelta mundo ↔ pantalla', () => {
  it('screenToWorld(worldToScreen(p)) === p', () => {
    fc.assert(
      fc.property(worldCoord(), worldCoord(), worldCoord(), worldCoord(), zoomValue(),
        (x, y, cx, cy, zoom) => {
          const vp = createViewport(vec2(cx, cy), zoom, SIZE);
          const back = screenToWorld(vp, worldToScreen(vp, vec2(x, y)));
          expect(back.x).toBeCloseTo(x, 6);
          expect(back.y).toBeCloseTo(y, 6);
        },
      ),
    );
  });

  it('worldToScreen(screenToWorld(s)) === s', () => {
    fc.assert(
      fc.property(screenCoord(SIZE.width), screenCoord(SIZE.height), zoomValue(),
        (sx, sy, zoom) => {
          const vp = createViewport(vec2(11, -7), zoom, SIZE);
          const back = worldToScreen(vp, screenToWorld(vp, screenPoint(sx, sy)));
          expect(back.x).toBeCloseTo(sx, 6);
          expect(back.y).toBeCloseTo(sy, 6);
        },
      ),
    );
  });
});

describe('zoom anclado al cursor', () => {
  /*
   * La propiedad que define un zoom usable: el detalle señalado por el cursor
   * no se mueve. Sin ella, ampliar obliga a recolocar la vista tras cada paso.
   */
  it('el punto de mundo bajo el ancla no se desplaza', () => {
    fc.assert(
      fc.property(screenCoord(SIZE.width), screenCoord(SIZE.height), zoomValue(), zoomValue(),
        (sx, sy, from, to) => {
          const anchor = screenPoint(sx, sy);
          const before = createViewport(vec2(250, -80), from, SIZE);
          const after = setZoomAtScreen(before, anchor, to);

          const worldBefore = screenToWorld(before, anchor);
          const worldAfter = screenToWorld(after, anchor);

          expect(worldAfter.x).toBeCloseTo(worldBefore.x, 5);
          expect(worldAfter.y).toBeCloseTo(worldBefore.y, 5);
        },
      ),
    );
  });

  it('el zoom se satura en los límites', () => {
    const anchor = screenPoint(600, 400);
    expect(setZoomAtScreen(BASE, anchor, 1e9).zoom).toBe(MAX_ZOOM);
    expect(setZoomAtScreen(BASE, anchor, 1e-9).zoom).toBe(MIN_ZOOM);
  });

  it('cambiar el zoom no altera las coordenadas de mundo del modelo', () => {
    const p = vec2(123.456, -78.9);
    const zoomed = setZoomAtScreen(BASE, screenPoint(300, 200), 7.5);
    const back = screenToWorld(zoomed, worldToScreen(zoomed, p));
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
  });
});

describe('desplazamiento de la vista', () => {
  it('el contenido acompaña al cursor píxel a píxel', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        zoomValue(),
        (dx, dy, zoom) => {
          const vp = createViewport(vec2(0, 0), zoom, SIZE);
          const p = vec2(60, 40);

          const before = worldToScreen(vp, p);
          const after = worldToScreen(panByScreen(vp, dx, dy), p);

          expect(after.x - before.x).toBeCloseTo(dx, 6);
          expect(after.y - before.y).toBeCloseTo(dy, 6);
        },
      ),
    );
  });

  it('no altera el zoom', () => {
    expect(panByScreen(BASE, 137, -42).zoom).toBe(BASE.zoom);
  });
});

describe('encuadre', () => {
  it('el rectángulo pedido queda íntegramente visible', () => {
    const rect = { min: vec2(-300, -150), max: vec2(500, 900) };
    const fitted = fitToRect(BASE, rect, 40);
    expect(rectContainsRect(visibleWorldRect(fitted), rect)).toBe(true);
  });

  it('un rectángulo degenerado recentra sin cambiar el zoom', () => {
    const point = { min: vec2(42, 42), max: vec2(42, 42) };
    const fitted = fitToRect(BASE, point);
    expect(fitted.zoom).toBe(BASE.zoom);
    expect(fitted.center.x).toBe(42);
    expect(fitted.center.y).toBe(42);
  });
});

describe('rectángulo visible', () => {
  it('sus dimensiones equivalen al lienzo dividido por la escala', () => {
    const vp = createViewport(vec2(10, 20), 3, SIZE);
    const rect = visibleWorldRect(vp);
    expect(rect.max.x - rect.min.x).toBeCloseTo(SIZE.width / scaleOf(vp), 9);
    expect(rect.max.y - rect.min.y).toBeCloseTo(SIZE.height / scaleOf(vp), 9);
  });

  it('a zoom 1 el ancho visible en mm es el ancho del lienzo entre PX_PER_MM', () => {
    const rect = visibleWorldRect(BASE);
    expect(rect.max.x - rect.min.x).toBeCloseTo(SIZE.width / PX_PER_MM, 9);
  });
});
