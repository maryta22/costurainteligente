import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  distanceToPolygonBoundary,
  polygonArea,
  polygonBounds,
  polygonCentroid,
  polygonContains,
  polygonEdges,
  polygonIsSimple,
  polygonOrientation,
  polygonPerimeter,
  signedArea,
  withOrientation,
} from '@core/geometry/polygon';
import type { Polygon } from '@core/geometry/polygon';
import { equals, vec2 } from '@core/geometry/vec2';

/** Cuadrado de 100 mm, antihorario. */
const SQUARE_CCW: Polygon = [vec2(0, 0), vec2(100, 0), vec2(100, 100), vec2(0, 100)];
const SQUARE_CW: Polygon = [...SQUARE_CCW].reverse();

/** Polígono en forma de L, para probar la concavidad. */
const L_SHAPE: Polygon = [
  vec2(0, 0),
  vec2(100, 0),
  vec2(100, 40),
  vec2(40, 40),
  vec2(40, 100),
  vec2(0, 100),
];

describe('área con signo', () => {
  it('es positiva en sentido antihorario y negativa en horario', () => {
    expect(signedArea(SQUARE_CCW)).toBeCloseTo(10_000, 9);
    expect(signedArea(SQUARE_CW)).toBeCloseTo(-10_000, 9);
  });

  it('el valor absoluto no depende del sentido', () => {
    expect(polygonArea(SQUARE_CCW)).toBeCloseTo(polygonArea(SQUARE_CW), 9);
  });

  it('calcula bien un polígono cóncavo', () => {
    // 100×100 menos el cuadrante que falta, de 60×60.
    expect(polygonArea(L_SHAPE)).toBeCloseTo(10_000 - 3_600, 9);
  });

  it('un triángulo mide base × altura / 2', () => {
    expect(polygonArea([vec2(0, 0), vec2(80, 0), vec2(0, 60)])).toBeCloseTo(2_400, 9);
  });

  it('menos de tres vértices no encierran área', () => {
    expect(signedArea([])).toBe(0);
    expect(signedArea([vec2(0, 0), vec2(10, 10)])).toBe(0);
  });

  it('es invariante frente a la traslación', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e3, max: 1e3, noNaN: true }),
        fc.double({ min: -1e3, max: 1e3, noNaN: true }),
        (dx, dy) => {
          const moved = L_SHAPE.map((p) => vec2(p.x + dx, p.y + dy));
          expect(signedArea(moved)).toBeCloseTo(signedArea(L_SHAPE), 6);
        },
      ),
    );
  });
});

describe('orientación', () => {
  /*
   * El SIGNO del área es información de dominio, no un detalle: decide hacia
   * qué lado se añade el margen de costura y si una pieza reflejada ha
   * invertido su orientación.
   */
  it('clasifica correctamente el sentido', () => {
    expect(polygonOrientation(SQUARE_CCW)).toBe('ccw');
    expect(polygonOrientation(SQUARE_CW)).toBe('cw');
    expect(polygonOrientation([vec2(0, 0), vec2(10, 10), vec2(20, 20)])).toBe('degenerate');
  });

  it('withOrientation normaliza sin alterar la forma', () => {
    const normalized = withOrientation(SQUARE_CW, 'ccw');

    expect(polygonOrientation(normalized)).toBe('ccw');
    expect(polygonArea(normalized)).toBeCloseTo(polygonArea(SQUARE_CW), 9);
  });

  it('withOrientation no toca lo que ya está bien', () => {
    expect(withOrientation(SQUARE_CCW, 'ccw')).toBe(SQUARE_CCW);
  });
});

describe('perímetro y aristas', () => {
  it('el perímetro incluye la arista de cierre', () => {
    expect(polygonPerimeter(SQUARE_CCW)).toBeCloseTo(400, 9);
  });

  it('hay tantas aristas como vértices', () => {
    expect(polygonEdges(SQUARE_CCW)).toHaveLength(4);
    expect(polygonEdges(L_SHAPE)).toHaveLength(6);
  });

  it('la última arista cierra sobre el primer vértice', () => {
    const edges = polygonEdges(SQUARE_CCW);
    const last = edges.at(-1);
    if (last === undefined) return;

    expect(equals(last.a, vec2(0, 100), 1e-9)).toBe(true);
    expect(equals(last.b, vec2(0, 0), 1e-9)).toBe(true);
  });
});

describe('centroide', () => {
  it('el del cuadrado está en su centro', () => {
    expect(equals(polygonCentroid(SQUARE_CCW) ?? vec2(0, 0), vec2(50, 50), 1e-9)).toBe(true);
  });

  /*
   * El centroide del ÁREA no coincide con la media de los vértices. La media
   * se desplaza hacia donde hay más vértices, que en un contorno aplanado es
   * donde más curvatura había — un artefacto de la tolerancia de render que no
   * debe influir en dónde se coloca la etiqueta de una pieza.
   */
  it('no coincide con la media de los vértices en un polígono irregular', () => {
    const centroid = polygonCentroid(L_SHAPE);
    expect(centroid).not.toBeNull();
    if (centroid === null) return;

    const meanX = L_SHAPE.reduce((s, p) => s + p.x, 0) / L_SHAPE.length;
    const meanY = L_SHAPE.reduce((s, p) => s + p.y, 0) / L_SHAPE.length;

    expect(Math.hypot(centroid.x - meanX, centroid.y - meanY)).toBeGreaterThan(1);
    expect(polygonContains(L_SHAPE, centroid)).toBe(true);
  });

  it('no falla con un polígono degenerado', () => {
    const centroid = polygonCentroid([vec2(0, 0), vec2(10, 10), vec2(20, 20)]);
    expect(centroid).not.toBeNull();
    expect(Number.isNaN(centroid?.x ?? Number.NaN)).toBe(false);
  });
});

describe('contención', () => {
  it('distingue dentro y fuera', () => {
    expect(polygonContains(SQUARE_CCW, vec2(50, 50))).toBe(true);
    expect(polygonContains(SQUARE_CCW, vec2(150, 50))).toBe(false);
    expect(polygonContains(SQUARE_CCW, vec2(-1, 50))).toBe(false);
  });

  it('acierta en la muesca de un polígono cóncavo', () => {
    expect(polygonContains(L_SHAPE, vec2(20, 20))).toBe(true);
    expect(polygonContains(L_SHAPE, vec2(20, 80))).toBe(true);
    expect(polygonContains(L_SHAPE, vec2(80, 20))).toBe(true);
    // El cuadrante ausente de la L.
    expect(polygonContains(L_SHAPE, vec2(80, 80))).toBe(false);
  });

  /*
   * El fallo clásico del trazado de rayos: un vértice exactamente a la altura
   * del rayo se cuenta dos veces o ninguna. La comparación semiabierta en Y lo
   * evita.
   */
  it('no falla cuando el rayo pasa justo por un vértice', () => {
    const diamond: Polygon = [vec2(0, 0), vec2(50, -50), vec2(100, 0), vec2(50, 50)];

    expect(polygonContains(diamond, vec2(50, 0))).toBe(true);
    expect(polygonContains(diamond, vec2(-10, 0))).toBe(false);
    expect(polygonContains(diamond, vec2(110, 0))).toBe(false);
  });

  it('el resultado no depende del sentido de recorrido', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -50, max: 150, noNaN: true }),
        fc.double({ min: -50, max: 150, noNaN: true }),
        (x, y) => {
          const p = vec2(x, y);
          expect(polygonContains(SQUARE_CCW, p)).toBe(polygonContains(SQUARE_CW, p));
        },
      ),
    );
  });

  it('un polígono con menos de tres vértices no contiene nada', () => {
    expect(polygonContains([vec2(0, 0), vec2(10, 0)], vec2(5, 0))).toBe(false);
  });
});

describe('simplicidad', () => {
  /*
   * Un contorno auto-intersecado no tiene interior bien definido: ni área
   * fiable, ni margen de costura, ni triangulación posible. Detectarlo es
   * requisito para la Fase 3.
   */
  it('acepta polígonos simples, convexos y cóncavos', () => {
    expect(polygonIsSimple(SQUARE_CCW)).toBe(true);
    expect(polygonIsSimple(L_SHAPE)).toBe(true);
  });

  it('rechaza un polígono en forma de lazo', () => {
    // Cuadrado con dos vértices intercambiados: se cruza en el centro.
    const bowtie: Polygon = [vec2(0, 0), vec2(100, 100), vec2(100, 0), vec2(0, 100)];
    expect(polygonIsSimple(bowtie)).toBe(false);
  });

  it('un triángulo nunca puede cortarse a sí mismo', () => {
    expect(polygonIsSimple([vec2(0, 0), vec2(10, 0), vec2(5, 8)])).toBe(true);
  });
});

describe('distancia a la frontera', () => {
  it('es cero sobre la frontera y positiva dentro', () => {
    expect(distanceToPolygonBoundary(SQUARE_CCW, vec2(50, 0))).toBeCloseTo(0, 9);
    expect(distanceToPolygonBoundary(SQUARE_CCW, vec2(50, 50))).toBeCloseTo(50, 9);
    expect(distanceToPolygonBoundary(SQUARE_CCW, vec2(50, 130))).toBeCloseTo(30, 9);
  });
});

describe('caja envolvente', () => {
  it('coincide con los extremos de los vértices', () => {
    const bounds = polygonBounds(L_SHAPE);
    expect(bounds?.min.x).toBe(0);
    expect(bounds?.max.x).toBe(100);
    expect(bounds?.max.y).toBe(100);
  });

  it('un polígono vacío no tiene caja', () => {
    expect(polygonBounds([])).toBeNull();
  });
});
