import { describe, expect, it } from 'vitest';

import { arcSeg } from '@core/geometry/arc';
import {
  closestPointOnContour,
  contour,
  contourBounds,
  contourFromPoints,
  contourLength,
  contourLocationAtLength,
  contourPointAtLength,
  contourReverse,
  contourToPolyline,
  contourTransform,
  segmentLengths,
  validateContour,
} from '@core/geometry/contour';
import { cubicSeg } from '@core/geometry/cubic';
import { lineSeg } from '@core/geometry/line';
import { rotation, scaling } from '@core/geometry/mat3';
import { distance, equals, vec2 } from '@core/geometry/vec2';

/** Cuadrado de 100 mm de lado, recorrido en sentido antihorario. */
const SQUARE = contourFromPoints(
  [vec2(0, 0), vec2(100, 0), vec2(100, 100), vec2(0, 100)],
  true,
);

/** Contorno mixto: recta + cuarto de arco + cúbica. */
const MIXED = contour([
  lineSeg(vec2(0, 0), vec2(100, 0)),
  arcSeg(vec2(100, 50), 50, -Math.PI / 2, Math.PI / 2),
  cubicSeg(vec2(150, 50), vec2(150, 100), vec2(50, 120), vec2(0, 100)),
]);

describe('construcción', () => {
  it('contourFromPoints cierra el polígono', () => {
    expect(SQUARE.segments).toHaveLength(4);
    expect(SQUARE.closed).toBe(true);
    expect(validateContour(SQUARE)).toHaveLength(0);
  });

  it('sin cerrar produce un segmento menos', () => {
    const open = contourFromPoints([vec2(0, 0), vec2(100, 0), vec2(100, 100)]);
    expect(open.segments).toHaveLength(2);
    expect(open.closed).toBe(false);
  });
});

describe('longitud', () => {
  it('suma las longitudes de sus segmentos', () => {
    expect(contourLength(SQUARE)).toBeCloseTo(400, 9);
  });

  it('coincide con la suma explícita de partes', () => {
    const parts = segmentLengths(MIXED);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(contourLength(MIXED), 9);
  });

  it('el tramo de arco aporta su longitud exacta', () => {
    const lengths = segmentLengths(MIXED);
    expect(lengths[1]).toBeCloseTo((Math.PI / 2) * 50, 9);
  });
});

describe('localización por longitud de arco', () => {
  /*
   * Es la primitiva de la que dependerán los piquetes: se guardan como
   * `(arista, longitud recorrida)` y nunca como coordenada absoluta, para que
   * sobrevivan a cualquier cambio de medidas.
   */
  it('sitúa el punto en el segmento correcto', () => {
    const atStart = contourLocationAtLength(SQUARE, 0);
    expect(atStart?.segmentIndex).toBe(0);
    expect(equals(atStart?.point ?? vec2(0, 0), vec2(0, 0), 1e-9)).toBe(true);

    const midFirst = contourLocationAtLength(SQUARE, 50);
    expect(midFirst?.segmentIndex).toBe(0);
    expect(equals(midFirst?.point ?? vec2(0, 0), vec2(50, 0), 1e-9)).toBe(true);

    const secondEdge = contourLocationAtLength(SQUARE, 150);
    expect(secondEdge?.segmentIndex).toBe(1);
    expect(equals(secondEdge?.point ?? vec2(0, 0), vec2(100, 50), 1e-9)).toBe(true);

    const thirdEdge = contourLocationAtLength(SQUARE, 250);
    expect(thirdEdge?.segmentIndex).toBe(2);
    expect(equals(thirdEdge?.point ?? vec2(0, 0), vec2(50, 100), 1e-9)).toBe(true);
  });

  it('recorrer el contorno de un extremo a otro cubre toda la longitud', () => {
    const total = contourLength(MIXED);
    let previous = contourPointAtLength(MIXED, 0);
    let accumulated = 0;

    for (let i = 1; i <= 400; i++) {
      const next = contourPointAtLength(MIXED, (total * i) / 400);
      if (previous === null || next === null) continue;
      accumulated += distance(previous, next);
      previous = next;
    }

    // La suma de cuerdas se aproxima al total por debajo.
    expect(accumulated).toBeGreaterThan(total - 0.05);
    expect(accumulated).toBeLessThanOrEqual(total + 1e-6);
  });

  it('satura fuera del recorrido', () => {
    expect(equals(contourPointAtLength(SQUARE, -10) ?? vec2(1, 1), vec2(0, 0), 1e-9)).toBe(true);
    expect(equals(contourPointAtLength(SQUARE, 1e6) ?? vec2(1, 1), vec2(0, 0), 1e-9)).toBe(true);
  });

  it('un contorno vacío no tiene localización', () => {
    expect(contourLocationAtLength(contour([]), 10)).toBeNull();
  });
});

describe('inversión', () => {
  /*
   * Invertir exige dar la vuelta a la LISTA y a CADA SEGMENTO. Si sólo se
   * invirtiera la lista, los segmentos quedarían encadenados fin contra fin y
   * el contorno dejaría de ser continuo — un fallo que `validateContour`
   * detecta y que este test comprueba.
   */
  it('conserva la continuidad y la longitud', () => {
    const reversed = contourReverse(MIXED);

    expect(validateContour(reversed)).toHaveLength(0);
    expect(contourLength(reversed)).toBeCloseTo(contourLength(MIXED), 6);
  });

  it('recorre los mismos puntos en orden inverso', () => {
    const total = contourLength(MIXED);
    const reversed = contourReverse(MIXED);

    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
      const forward = contourPointAtLength(MIXED, total * fraction);
      const backward = contourPointAtLength(reversed, total * (1 - fraction));
      if (forward === null || backward === null) continue;
      expect(distance(forward, backward)).toBeLessThan(0.01);
    }
  });
});

describe('aplanamiento', () => {
  it('no deja vértices duplicados en las junturas', () => {
    const polyline = contourToPolyline(MIXED, 0.05);

    for (let i = 0; i + 1 < polyline.length; i++) {
      const a = polyline[i];
      const b = polyline[i + 1];
      if (a === undefined || b === undefined) continue;
      expect(distance(a, b)).toBeGreaterThan(0);
    }
  });

  it('un contorno cerrado no repite el primer vértice al final', () => {
    const polyline = contourToPolyline(SQUARE, 0.05);

    expect(polyline).toHaveLength(4);
    const first = polyline[0];
    const last = polyline.at(-1);
    if (first === undefined || last === undefined) return;
    expect(equals(first, last)).toBe(false);
  });
});

describe('transformación', () => {
  it('el escalado uniforme multiplica la longitud', () => {
    expect(contourLength(contourTransform(SQUARE, scaling(2.5)))).toBeCloseTo(1000, 6);
  });

  it('la rotación la conserva', () => {
    expect(contourLength(contourTransform(MIXED, rotation(0.9)))).toBeCloseTo(
      contourLength(MIXED),
      4,
    );
  });

  /*
   * Bajo escalado no uniforme la imagen de un arco es una elipse, que el modelo
   * no representa. La respuesta correcta es sustituirlo por cúbicas — no
   * devolver un arco incorrecto. Un cuarto de circunferencia cabe en UNA
   * cúbica, así que el número de segmentos no tiene por qué crecer: lo que debe
   * comprobarse es que no quede ningún arco y que el contorno siga siendo
   * continuo.
   */
  it('un escalado no uniforme convierte el arco en cúbicas', () => {
    const transformed = contourTransform(MIXED, scaling(2, 3));

    expect(MIXED.segments.some((s) => s.kind === 'arc')).toBe(true);
    expect(transformed.segments.some((s) => s.kind === 'arc')).toBe(false);
    expect(transformed.segments.length).toBeGreaterThanOrEqual(MIXED.segments.length);
    expect(validateContour(transformed)).toHaveLength(0);
  });

  it('un arco de más de 90° sí produce varias cúbicas', () => {
    const wide = contour([arcSeg(vec2(0, 0), 50, 0, Math.PI)]);
    const transformed = contourTransform(wide, scaling(2, 3));

    expect(transformed.segments.length).toBeGreaterThan(1);
    expect(validateContour(transformed)).toHaveLength(0);
  });
});

describe('caja envolvente', () => {
  it('envuelve todo el contorno', () => {
    const bounds = contourBounds(SQUARE);
    expect(bounds?.min.x).toBeCloseTo(0, 9);
    expect(bounds?.max.x).toBeCloseTo(100, 9);
  });

  it('un contorno vacío no tiene caja', () => {
    expect(contourBounds(contour([]))).toBeNull();
  });
});

describe('punto más próximo', () => {
  it('encuentra el segmento correcto', () => {
    const result = closestPointOnContour(SQUARE, vec2(50, -20));

    expect(result?.segmentIndex).toBe(0);
    expect(result?.distance).toBeCloseTo(20, 6);
    expect(equals(result?.point ?? vec2(0, 0), vec2(50, 0), 1e-6)).toBe(true);
  });

  it('un contorno vacío devuelve null', () => {
    expect(closestPointOnContour(contour([]), vec2(0, 0))).toBeNull();
  });
});

describe('validación', () => {
  /*
   * Un hueco de dos décimas de milímetro es invisible en pantalla, pasa por el
   * exportador sin protestar y reaparece como un agujero en la malla varias
   * fases después. Detectarlo en el momento de generarlo es la diferencia
   * entre un aviso y una tarde de depuración.
   */
  it('detecta un hueco entre segmentos', () => {
    const broken = contour([
      lineSeg(vec2(0, 0), vec2(100, 0)),
      lineSeg(vec2(100.2, 0), vec2(100.2, 100)),
    ]);

    const issues = validateContour(broken);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe('gap');
  });

  it('detecta un contorno declarado cerrado que no lo está', () => {
    const open = contour(
      [lineSeg(vec2(0, 0), vec2(100, 0)), lineSeg(vec2(100, 0), vec2(100, 100))],
      true,
    );

    expect(validateContour(open).some((issue) => issue.kind === 'not-closed')).toBe(true);
  });

  it('detecta segmentos de longitud nula', () => {
    const degenerate = contour([lineSeg(vec2(5, 5), vec2(5, 5))]);
    expect(validateContour(degenerate)[0]?.kind).toBe('zero-length');
  });

  it('un contorno vacío se reporta como tal', () => {
    expect(validateContour(contour([]))).toEqual([{ kind: 'empty' }]);
  });

  it('los contornos bien formados no producen avisos', () => {
    expect(validateContour(SQUARE)).toHaveLength(0);
    expect(validateContour(MIXED)).toHaveLength(0);
  });
});
