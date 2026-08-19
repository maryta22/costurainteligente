import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { arcSeg } from '@core/geometry/arc';
import { cubicFromLine, cubicSeg } from '@core/geometry/cubic';
import {
  intersectArcArc,
  intersectBySubdivision,
  intersectInfiniteLines,
  intersectLineArc,
  intersectLineCubic,
  intersectLineLine,
  intersectSegments,
  nearestIntersection,
} from '@core/geometry/intersect';
import { lineSeg } from '@core/geometry/line';
import { segmentPointAt } from '@core/geometry/segment';
import { distance, equals, vec2 } from '@core/geometry/vec2';

describe('recta × recta', () => {
  it('encuentra el cruce en aspa', () => {
    const results = intersectLineLine(
      lineSeg(vec2(-10, 0), vec2(10, 0)),
      lineSeg(vec2(0, -10), vec2(0, 10)),
    );

    expect(results).toHaveLength(1);
    expect(equals(results[0]?.point ?? vec2(9, 9), vec2(0, 0), 1e-9)).toBe(true);
    expect(results[0]?.tA).toBeCloseTo(0.5, 9);
    expect(results[0]?.tB).toBeCloseTo(0.5, 9);
  });

  it('no inventa cruces fuera de los extremos', () => {
    // Las rectas soporte se cortan en (0,0), pero los segmentos no llegan.
    expect(
      intersectLineLine(lineSeg(vec2(5, 0), vec2(10, 0)), lineSeg(vec2(0, 5), vec2(0, 10))),
    ).toHaveLength(0);
  });

  it('las paralelas no se cortan', () => {
    expect(
      intersectLineLine(lineSeg(vec2(0, 0), vec2(10, 0)), lineSeg(vec2(0, 5), vec2(10, 5))),
    ).toHaveLength(0);
  });

  /*
   * Dos segmentos colineales que se solapan tienen por solución un SEGMENTO,
   * no un punto. Devolver lista vacía es lo correcto; quien necesite detectar
   * solapamientos ha de hacerlo aparte. Documentado como limitación conocida.
   */
  it('los colineales solapados no producen puntos discretos', () => {
    expect(
      intersectLineLine(lineSeg(vec2(0, 0), vec2(10, 0)), lineSeg(vec2(5, 0), vec2(15, 0))),
    ).toHaveLength(0);
  });

  it('el cruce cae sobre ambos segmentos', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -100, max: 100, noNaN: true }),
        fc.double({ min: -100, max: 100, noNaN: true }),
        fc.double({ min: -100, max: 100, noNaN: true }),
        fc.double({ min: -100, max: 100, noNaN: true }),
        (x1, y1, x2, y2) => {
          const a = lineSeg(vec2(-100, 0), vec2(100, 0));
          const b = lineSeg(vec2(x1, y1), vec2(x2, y2));

          for (const hit of intersectLineLine(a, b)) {
            expect(distance(hit.point, segmentPointAt(a, hit.tA))).toBeLessThan(1e-6);
            expect(distance(hit.point, segmentPointAt(b, hit.tB))).toBeLessThan(1e-6);
          }
        },
      ),
    );
  });

  it('intersectInfiniteLines ignora los extremos', () => {
    const point = intersectInfiniteLines(
      lineSeg(vec2(5, 0), vec2(10, 0)),
      lineSeg(vec2(0, 5), vec2(0, 10)),
    );

    expect(equals(point ?? vec2(9, 9), vec2(0, 0), 1e-9)).toBe(true);
  });
});

describe('recta × cúbica', () => {
  /*
   * Una recta puede cortar una cúbica en TRES puntos. La reducción a las
   * raíces de un polinomio cúbico los encuentra todos de una vez; un método
   * por subdivisión tendría que separarlos por fuerza bruta.
   */
  it('encuentra los tres cortes de una curva en S', () => {
    const curve = cubicSeg(vec2(0, 0), vec2(0, 300), vec2(100, -200), vec2(100, 100));
    const results = intersectLineCubic(lineSeg(vec2(-50, 50), vec2(150, 50)), curve);

    expect(results).toHaveLength(3);
    for (const hit of results) {
      expect(hit.point.y).toBeCloseTo(50, 6);
      expect(distance(hit.point, segmentPointAt(curve, hit.tB))).toBeLessThan(1e-6);
    }
  });

  it('encuentra el corte único de una curva convexa', () => {
    const curve = cubicSeg(vec2(0, 0), vec2(0, 100), vec2(100, 100), vec2(100, 0));
    const results = intersectLineCubic(lineSeg(vec2(-10, 40), vec2(50, 40)), curve);

    expect(results).toHaveLength(1);
    expect(results[0]?.point.y).toBeCloseTo(40, 6);
  });

  it('una recta que pasa de largo no corta', () => {
    const curve = cubicSeg(vec2(0, 0), vec2(0, 100), vec2(100, 100), vec2(100, 0));
    expect(intersectLineCubic(lineSeg(vec2(-10, 500), vec2(200, 500)), curve)).toHaveLength(0);
  });

  it('la tangencia se detecta una sola vez', () => {
    // El máximo de esta cúbica está en y = 75 (véase cubic.test.ts).
    const curve = cubicSeg(vec2(0, 0), vec2(0, 100), vec2(100, 100), vec2(100, 0));
    const results = intersectLineCubic(lineSeg(vec2(-10, 75), vec2(120, 75)), curve);

    expect(results).toHaveLength(1);
    expect(results[0]?.point.x).toBeCloseTo(50, 4);
  });

  it('coincide con el resultado del método por subdivisión', () => {
    const curve = cubicSeg(vec2(0, 0), vec2(30, 140), vec2(170, 120), vec2(200, 10));
    const line = lineSeg(vec2(-20, 70), vec2(240, 70));

    const analytic = intersectLineCubic(line, curve);
    const numeric = intersectBySubdivision(line, curve, 1e-6);

    expect(numeric).toHaveLength(analytic.length);
    for (let i = 0; i < analytic.length; i++) {
      const a = analytic[i];
      const b = numeric[i];
      if (a === undefined || b === undefined) continue;
      expect(distance(a.point, b.point)).toBeLessThan(1e-3);
    }
  });

  it('una cúbica elevada desde una recta se comporta como recta', () => {
    const results = intersectLineCubic(
      lineSeg(vec2(0, -10), vec2(0, 10)),
      cubicFromLine(lineSeg(vec2(-10, 0), vec2(10, 0))),
    );

    expect(results).toHaveLength(1);
    expect(equals(results[0]?.point ?? vec2(9, 9), vec2(0, 0), 1e-6)).toBe(true);
  });
});

describe('recta × arco', () => {
  it('una secante corta en dos puntos', () => {
    const arc = arcSeg(vec2(0, 0), 100, 0, Math.PI);
    const results = intersectLineArc(lineSeg(vec2(-200, 50), vec2(200, 50)), arc);

    expect(results).toHaveLength(2);
    for (const hit of results) {
      expect(Math.hypot(hit.point.x, hit.point.y)).toBeCloseTo(100, 6);
      expect(hit.point.y).toBeCloseTo(50, 9);
    }
  });

  /*
   * La diferencia entre un arco y su circunferencia soporte. La recta corta la
   * circunferencia en dos puntos, pero sólo uno cae dentro del barrido de este
   * cuarto de arco.
   */
  it('filtra los cortes fuera del barrido', () => {
    const quarter = arcSeg(vec2(0, 0), 100, 0, Math.PI / 2);
    const results = intersectLineArc(lineSeg(vec2(-200, 50), vec2(200, 50)), quarter);

    expect(results).toHaveLength(1);
    expect(results[0]?.point.x).toBeGreaterThan(0);
  });

  it('una tangente toca en un solo punto', () => {
    const arc = arcSeg(vec2(0, 0), 100, 0, Math.PI);
    const results = intersectLineArc(lineSeg(vec2(-200, 100), vec2(200, 100)), arc);

    expect(results).toHaveLength(1);
    expect(equals(results[0]?.point ?? vec2(0, 0), vec2(0, 100), 1e-5)).toBe(true);
  });

  it('una recta lejana no corta', () => {
    const arc = arcSeg(vec2(0, 0), 100, 0, Math.PI);
    expect(intersectLineArc(lineSeg(vec2(-200, 300), vec2(200, 300)), arc)).toHaveLength(0);
  });
});

describe('arco × arco', () => {
  it('dos circunferencias secantes se cortan en dos puntos', () => {
    const a = arcSeg(vec2(0, 0), 100, -Math.PI, 2 * Math.PI);
    const b = arcSeg(vec2(120, 0), 100, -Math.PI, 2 * Math.PI);
    const results = intersectArcArc(a, b);

    expect(results).toHaveLength(2);
    for (const hit of results) {
      expect(Math.hypot(hit.point.x, hit.point.y)).toBeCloseTo(100, 6);
      expect(Math.hypot(hit.point.x - 120, hit.point.y)).toBeCloseTo(100, 6);
    }
  });

  it('las tangentes exteriores se tocan en un punto', () => {
    const a = arcSeg(vec2(0, 0), 50, -Math.PI, 2 * Math.PI);
    const b = arcSeg(vec2(100, 0), 50, -Math.PI, 2 * Math.PI);
    const results = intersectArcArc(a, b);

    expect(results).toHaveLength(1);
    expect(equals(results[0]?.point ?? vec2(9, 9), vec2(50, 0), 1e-6)).toBe(true);
  });

  it('las circunferencias separadas no se cortan', () => {
    expect(
      intersectArcArc(
        arcSeg(vec2(0, 0), 10, 0, 2 * Math.PI),
        arcSeg(vec2(1000, 0), 10, 0, 2 * Math.PI),
      ),
    ).toHaveLength(0);
  });

  it('las concéntricas idénticas no producen puntos discretos', () => {
    const arc = arcSeg(vec2(0, 0), 50, 0, 2 * Math.PI);
    expect(intersectArcArc(arc, arc)).toHaveLength(0);
  });

  it('filtra por barrido de ambos arcos', () => {
    // Sólo el corte superior cae en ambos cuartos de arco.
    const a = arcSeg(vec2(0, 0), 100, 0, Math.PI / 2);
    const b = arcSeg(vec2(120, 0), 100, Math.PI / 2, Math.PI / 2);
    const results = intersectArcArc(a, b);

    expect(results).toHaveLength(1);
    expect(results[0]?.point.y).toBeGreaterThan(0);
  });
});

describe('cúbica × cúbica (subdivisión)', () => {
  /*
   * Sin fórmula cerrada practicable: eliminar una variable entre dos
   * polinómicas de grado 3 da una resultante de grado 9. La subdivisión por
   * cajas envolventes es lenta pero sólida y sin casos especiales.
   */
  it('encuentra el cruce de dos arcos de curva', () => {
    const a = cubicSeg(vec2(0, 0), vec2(0, 100), vec2(100, 100), vec2(100, 0));
    const b = cubicSeg(vec2(0, 60), vec2(40, -40), vec2(60, 140), vec2(100, 40));

    const results = intersectSegments(a, b, 1e-6);
    expect(results.length).toBeGreaterThan(0);

    for (const hit of results) {
      const onA = segmentPointAt(a, hit.tA);
      const onB = segmentPointAt(b, hit.tB);
      expect(distance(onA, onB)).toBeLessThan(0.01);
    }
  });

  it('dos curvas separadas no se cortan', () => {
    const a = cubicSeg(vec2(0, 0), vec2(30, 40), vec2(70, 40), vec2(100, 0));
    const b = cubicSeg(vec2(0, 500), vec2(30, 540), vec2(70, 540), vec2(100, 500));

    expect(intersectSegments(a, b)).toHaveLength(0);
  });

  it('cúbica × arco también se resuelve', () => {
    const curve = cubicSeg(vec2(-150, 0), vec2(-50, 200), vec2(50, -200), vec2(150, 0));
    const arc = arcSeg(vec2(0, 0), 100, 0, 2 * Math.PI);

    const results = intersectSegments(curve, arc, 1e-5);
    expect(results.length).toBeGreaterThan(0);

    for (const hit of results) {
      expect(Math.hypot(hit.point.x, hit.point.y)).toBeCloseTo(100, 1);
    }
  });
});

describe('despacho por tipos', () => {
  it('el orden de los argumentos no cambia los puntos hallados', () => {
    const line = lineSeg(vec2(-50, 40), vec2(150, 40));
    const curve = cubicSeg(vec2(0, 0), vec2(0, 100), vec2(100, 100), vec2(100, 0));

    const forward = intersectSegments(line, curve);
    const backward = intersectSegments(curve, line);

    expect(backward).toHaveLength(forward.length);
    for (const hit of backward) {
      expect(forward.some((other) => distance(other.point, hit.point) < 1e-6)).toBe(true);
    }
  });

  it('los parámetros se intercambian al invertir el orden', () => {
    const line = lineSeg(vec2(-50, 40), vec2(150, 40));
    const curve = cubicSeg(vec2(0, 0), vec2(0, 100), vec2(100, 100), vec2(100, 0));

    const forward = intersectSegments(line, curve)[0];
    const backward = intersectSegments(curve, line)[0];
    if (forward === undefined || backward === undefined) return;

    expect(backward.tA).toBeCloseTo(forward.tB, 6);
    expect(backward.tB).toBeCloseTo(forward.tA, 6);
  });
});

describe('nearestIntersection', () => {
  it('elige el corte más próximo a la referencia', () => {
    const arc = arcSeg(vec2(0, 0), 100, 0, Math.PI);
    const results = intersectLineArc(lineSeg(vec2(-200, 50), vec2(200, 50)), arc);

    const nearest = nearestIntersection(results, vec2(200, 50));
    expect(nearest?.point.x).toBeGreaterThan(0);
  });

  it('sin cortes devuelve null', () => {
    expect(nearestIntersection([], vec2(0, 0))).toBeNull();
  });
});
