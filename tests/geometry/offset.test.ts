import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { offsetPolygon, offsetPolygonUniform, removeSelfIntersections } from '@core/geometry/offset';
import type { Polygon } from '@core/geometry/polygon';
import {
  distanceToPolygonBoundary,
  polygonArea,
  polygonContains,
  polygonIsSimple,
  polygonOrientation,
} from '@core/geometry/polygon';
import { vec2 } from '@core/geometry/vec2';

const SQUARE: Polygon = [vec2(0, 0), vec2(100, 0), vec2(100, 100), vec2(0, 100)];

/** L cóncava: el vértice reflexivo es el que genera lazos al desplazar. */
const L_SHAPE: Polygon = [
  vec2(0, 0),
  vec2(100, 0),
  vec2(100, 40),
  vec2(40, 40),
  vec2(40, 100),
  vec2(0, 100),
];

describe('desplazamiento uniforme', () => {
  it('un cuadrado crece en todas direcciones', () => {
    const result = offsetPolygonUniform(SQUARE, 10);

    expect(result).toHaveLength(4);
    expect(polygonArea(result)).toBeCloseTo(120 * 120, 6);
    expect(polygonOrientation(result)).toBe('ccw');
  });

  /*
   * Verificación de SIGNO, que es el error que hay que hacer imposible: con el
   * convenio antihorario, una anchura positiva debe añadir material. Si el
   * signo se invirtiera, los márgenes de costura se dibujarían hacia dentro de
   * la pieza y el patrón saldría pequeño sin que nada avisara.
   */
  it('el desplazamiento va hacia FUERA, nunca hacia dentro', () => {
    fc.assert(
      fc.property(fc.double({ min: 1, max: 30, noNaN: true }), (width) => {
        const result = offsetPolygonUniform(SQUARE, width);

        expect(polygonArea(result)).toBeGreaterThan(polygonArea(SQUARE));
        for (const vertex of SQUARE) expect(polygonContains(result, vertex)).toBe(true);
      }),
    );
  });

  it('cada lado queda a la distancia pedida', () => {
    const width = 12;
    const result = offsetPolygonUniform(SQUARE, width);

    for (const point of [vec2(50, 0), vec2(100, 50), vec2(50, 100), vec2(0, 50)]) {
      expect(distanceToPolygonBoundary(result, point)).toBeCloseTo(width, 6);
    }
  });

  it('un desplazamiento nulo devuelve el contorno original', () => {
    const result = offsetPolygonUniform(SQUARE, 0);
    expect(polygonArea(result)).toBeCloseTo(polygonArea(SQUARE), 6);
  });
});

describe('anchura variable', () => {
  /*
   * ES LA RAZÓN DE QUE NO SIRVA UNA BIBLIOTECA DE INFLADO GENÉRICA.
   *
   * Los patrones reales llevan un margen distinto por arista: 6 mm en un escote
   * curvo, 15 en un costado, 40 en un bajo. Las bibliotecas de offset trabajan
   * con un único delta para todo el polígono.
   */
  it('cada lado se desplaza su propia distancia', () => {
    // Lados en orden: abajo, derecha, arriba, izquierda.
    const widths = [40, 15, 6, 0];
    const result = offsetPolygon(SQUARE, widths);

    expect(distanceToPolygonBoundary(result, vec2(50, 0))).toBeCloseTo(40, 6);
    expect(distanceToPolygonBoundary(result, vec2(100, 50))).toBeCloseTo(15, 6);
    expect(distanceToPolygonBoundary(result, vec2(50, 100))).toBeCloseTo(6, 6);
    expect(distanceToPolygonBoundary(result, vec2(0, 50))).toBeCloseTo(0, 6);
  });

  it('el área crece con el margen medio', () => {
    const narrow = offsetPolygon(SQUARE, [5, 5, 5, 5]);
    const wide = offsetPolygon(SQUARE, [40, 15, 6, 0]);

    expect(polygonArea(wide)).toBeGreaterThan(polygonArea(narrow));
  });

  /*
   * Cuando dos aristas contiguas llevan márgenes distintos y son colineales, la
   * línea de corte tiene que dar un ESCALÓN perpendicular: no hay esquina que
   * mitrar, y sin el escalón el margen saltaría de golpe dejando un hueco.
   */
  it('un cambio de margen entre lados colineales produce un escalón', () => {
    const strip: Polygon = [vec2(0, 0), vec2(50, 0), vec2(100, 0), vec2(100, 50), vec2(0, 50)];
    const result = offsetPolygon(strip, [30, 5, 5, 5, 5]);

    // El escalón añade un vértice respecto al desplazamiento uniforme.
    expect(result.length).toBeGreaterThan(offsetPolygonUniform(strip, 5).length);

    /*
     * Se comprueba que la línea de corte PASA POR los puntos esperados, en vez
     * de medir la distancia desde la línea de costura. Esa medida daría el
     * punto más próximo de TODO el contorno, y la pared vertical del escalón
     * está más cerca del centro del primer tramo que su propia línea
     * desplazada — mediría el escalón, no el margen.
     */
    expect(distanceToPolygonBoundary(result, vec2(25, -30))).toBeCloseTo(0, 6);
    expect(distanceToPolygonBoundary(result, vec2(75, -5))).toBeCloseTo(0, 6);

    // Y que entre ambos hay una pared vertical: el escalón.
    expect(distanceToPolygonBoundary(result, vec2(50, -18))).toBeCloseTo(0, 6);
  });

  it('margen cero en un lado deja ese lado intacto', () => {
    const result = offsetPolygon(SQUARE, [10, 10, 10, 0]);
    expect(distanceToPolygonBoundary(result, vec2(0, 50))).toBeCloseTo(0, 6);
  });
});

describe('esquinas cóncavas', () => {
  /*
   * Cada vértice reflexivo genera un lazo al desplazar hacia fuera: las dos
   * líneas desplazadas se solapan. El resultado debe seguir siendo un polígono
   * SIMPLE tras la limpieza — si no lo fuera, no tendría interior definido y no
   * se podría triangular en la Fase 11.
   */
  it('el resultado sigue siendo simple pese a los lazos', () => {
    for (const width of [2, 5, 10, 18]) {
      const result = offsetPolygonUniform(L_SHAPE, width);

      expect(polygonIsSimple(result)).toBe(true);
      expect(polygonOrientation(result)).toBe('ccw');
      expect(polygonArea(result)).toBeGreaterThan(polygonArea(L_SHAPE));
    }
  });

  it('los vértices originales quedan dentro del contorno desplazado', () => {
    const result = offsetPolygonUniform(L_SHAPE, 8);
    for (const vertex of L_SHAPE) expect(polygonContains(result, vertex)).toBe(true);
  });

  it('la esquina convexa mantiene la distancia en sus dos lados', () => {
    const width = 8;
    const result = offsetPolygonUniform(L_SHAPE, width);

    expect(distanceToPolygonBoundary(result, vec2(50, 0))).toBeCloseTo(width, 5);
    expect(distanceToPolygonBoundary(result, vec2(0, 50))).toBeCloseTo(width, 5);
  });
});

describe('juntas', () => {
  it('miter produce un pico y bevel lo corta', () => {
    const spike: Polygon = [vec2(0, 0), vec2(100, 0), vec2(50, 8)];

    const mitered = offsetPolygon(spike, [10, 10, 10], { join: 'miter', miterLimit: 20 });
    const beveled = offsetPolygon(spike, [10, 10, 10], { join: 'bevel' });

    expect(polygonArea(mitered)).toBeGreaterThan(polygonArea(beveled));
    expect(mitered.length).toBeLessThan(beveled.length);
  });

  /*
   * Sin límite de pico, una esquina muy aguda produce un miter de longitud
   * desbocada: el margen de una punta de 1° se dispararía metros.
   */
  it('el límite de pico acota las esquinas agudas', () => {
    const spike: Polygon = [vec2(0, 0), vec2(200, 0), vec2(100, 3)];

    const unlimited = offsetPolygon(spike, [10, 10, 10], { join: 'miter', miterLimit: 1000 });
    const limited = offsetPolygon(spike, [10, 10, 10], { join: 'miter', miterLimit: 2 });

    expect(polygonArea(limited)).toBeLessThan(polygonArea(unlimited));
  });

  it('round redondea con la tolerancia pedida', () => {
    const triangle: Polygon = [vec2(0, 0), vec2(100, 0), vec2(50, 80)];
    const rounded = offsetPolygon(triangle, [10, 10, 10], { join: 'round', arcTolerance: 0.05 });

    expect(rounded.length).toBeGreaterThan(triangle.length * 3);
    expect(polygonIsSimple(rounded)).toBe(true);
  });
});

describe('removeSelfIntersections', () => {
  it('deja intacto un polígono simple', () => {
    expect(removeSelfIntersections(SQUARE)).toHaveLength(4);
  });

  it('deshace un lazo en forma de pajarita', () => {
    const bowtie: Polygon = [vec2(0, 0), vec2(100, 100), vec2(100, 0), vec2(0, 100)];
    const cleaned = removeSelfIntersections(bowtie);

    expect(polygonIsSimple(cleaned)).toBe(true);
    expect(cleaned.length).toBeGreaterThanOrEqual(3);
  });

  it('conserva el sentido de recorrido esperado', () => {
    const bowtie: Polygon = [vec2(0, 0), vec2(100, 100), vec2(100, 0), vec2(0, 100)];
    expect(polygonOrientation(removeSelfIntersections(bowtie, 'ccw'))).toBe('ccw');
  });
});

describe('robustez', () => {
  it('un polígono degenerado no rompe nada', () => {
    expect(offsetPolygonUniform([vec2(0, 0), vec2(10, 0)], 5)).toHaveLength(2);
    expect(offsetPolygonUniform([], 5)).toHaveLength(0);
  });

  it('no produce coordenadas no finitas', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 25, noNaN: true }), (width) => {
        for (const point of offsetPolygonUniform(L_SHAPE, width)) {
          expect(Number.isFinite(point.x)).toBe(true);
          expect(Number.isFinite(point.y)).toBe(true);
        }
      }),
    );
  });
});
