import { describe, expect, it } from 'vitest';

import {
  CENTRIPETAL,
  CHORDAL,
  UNIFORM,
  catmullRomToCubics,
  splineThrough,
} from '@core/geometry/spline';
import { cubicPointAt, cubicTangent } from '@core/geometry/cubic';
import { contourLength, validateContour } from '@core/geometry/contour';
import { distance, equals, vec2 } from '@core/geometry/vec2';
import type { Vec2 } from '@core/geometry/vec2';

/**
 * Conjunto de puntos con espaciados MUY desiguales.
 *
 * Es el caso que separa las parametrizaciones: dos puntos casi pegados
 * seguidos de uno lejano. Se parece a una sisa real, donde el paso del hombro
 * al pico de la curva es corto y el descenso al costado, largo.
 */
const UNEVEN: readonly Vec2[] = [
  vec2(0, 0),
  vec2(100, 0),
  vec2(103, 4),
  vec2(200, 0),
];

/**
 * «Rodeo» máximo: longitud de cada tramo dividida por su propia cuerda.
 *
 * Es la métrica que detecta el defecto que importa. Una curva sana va de un
 * punto al siguiente con un rodeo del 0-10 %; una que sobreoscila se dispara
 * más allá de su punto de llegada y vuelve, formando un bucle, y entonces
 * recorre varias veces la distancia entre sus extremos.
 *
 * Medir la desviación respecto a la envolvente GLOBAL del conjunto no sirve:
 * el bucle de la parametrización uniforme ocurre DENTRO del tramo corto y no
 * llega a salirse de la envolvente de todos los puntos, de modo que esa métrica
 * lo declara inofensivo.
 */
function maxDetourRatio(points: readonly Vec2[], alpha: number): number {
  let worst = 0;

  for (const c of catmullRomToCubics(points, { alpha })) {
    const chord = distance(c.p0, c.p3);
    if (chord < 1e-9) continue;

    let arc = 0;
    let previous = cubicPointAt(c, 0);
    for (let i = 1; i <= 400; i++) {
      const next = cubicPointAt(c, i / 400);
      arc += distance(previous, next);
      previous = next;
    }

    worst = Math.max(worst, arc / chord);
  }

  return worst;
}

/** Desviación máxima de la curva respecto a la poligonal de los puntos. */
function maxDeviationFromPolyline(points: readonly Vec2[], alpha: number): number {
  let worst = 0;

  for (const c of catmullRomToCubics(points, { alpha })) {
    for (let i = 0; i <= 60; i++) {
      const p = cubicPointAt(c, i / 60);

      let nearest = Number.POSITIVE_INFINITY;
      for (let j = 0; j + 1 < points.length; j++) {
        const a = points[j];
        const b = points[j + 1];
        if (a === undefined || b === undefined) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy;
        const t =
          lenSq === 0
            ? 0
            : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
        nearest = Math.min(nearest, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
      }

      worst = Math.max(worst, nearest);
    }
  }

  return worst;
}

describe('interpolación', () => {
  /*
   * Catmull-Rom es INTERPOLANTE, no aproximante: la curva pasa exactamente por
   * los puntos dados. Es lo que exige el patronaje — el escote pasa por el
   * hombro, no cerca del hombro.
   */
  it('la curva pasa exactamente por todos los puntos', () => {
    const points = [vec2(0, 0), vec2(50, 80), vec2(140, 95), vec2(200, 30), vec2(240, -20)];
    const cubics = catmullRomToCubics(points);

    expect(cubics).toHaveLength(points.length - 1);

    for (let i = 0; i < cubics.length; i++) {
      const c = cubics[i];
      if (c === undefined) continue;
      expect(equals(cubicPointAt(c, 0), points[i] ?? vec2(0, 0), 1e-9)).toBe(true);
      expect(equals(cubicPointAt(c, 1), points[i + 1] ?? vec2(0, 0), 1e-9)).toBe(true);
    }
  });

  it('dos puntos producen un único tramo recto', () => {
    const cubics = catmullRomToCubics([vec2(0, 0), vec2(100, 0)]);
    expect(cubics).toHaveLength(1);

    const c = cubics[0];
    if (c === undefined) return;
    expect(equals(cubicPointAt(c, 0.5), vec2(50, 0), 1e-9)).toBe(true);
  });

  it('menos de dos puntos no produce curva', () => {
    expect(catmullRomToCubics([])).toHaveLength(0);
    expect(catmullRomToCubics([vec2(1, 1)])).toHaveLength(0);
  });

  it('ignora puntos consecutivos repetidos', () => {
    const cubics = catmullRomToCubics([
      vec2(0, 0),
      vec2(50, 50),
      vec2(50, 50),
      vec2(100, 0),
    ]);

    expect(cubics).toHaveLength(2);
    for (const c of cubics) {
      expect(Number.isNaN(cubicPointAt(c, 0.5).x)).toBe(false);
    }
  });
});

describe('continuidad', () => {
  /*
   * C¹: las tangentes coinciden en los nudos. Sin ella, una sisa presentaría
   * un pico visible en cada punto de paso, y el margen de costura —que se
   * construye sobre la normal— daría un salto en ese punto.
   */
  it('las tangentes coinciden en los nudos (C¹)', () => {
    const cubics = catmullRomToCubics([
      vec2(0, 0),
      vec2(40, 70),
      vec2(120, 90),
      vec2(190, 40),
      vec2(230, -30),
    ]);

    for (let i = 0; i + 1 < cubics.length; i++) {
      const current = cubics[i];
      const next = cubics[i + 1];
      if (current === undefined || next === undefined) continue;

      const outgoing = cubicTangent(current, 1);
      const incoming = cubicTangent(next, 0);

      expect(outgoing.x).toBeCloseTo(incoming.x, 6);
      expect(outgoing.y).toBeCloseTo(incoming.y, 6);
    }
  });

  it('un spline cerrado también es C¹ en la juntura', () => {
    const cubics = catmullRomToCubics(
      [vec2(0, 0), vec2(100, 20), vec2(120, 110), vec2(20, 130)],
      { closed: true },
    );

    expect(cubics).toHaveLength(4);

    const last = cubics.at(-1);
    const first = cubics[0];
    if (last === undefined || first === undefined) return;

    // El último tramo cierra sobre el primer punto...
    expect(equals(cubicPointAt(last, 1), cubicPointAt(first, 0), 1e-9)).toBe(true);
    // ...y lo hace con la misma tangente.
    expect(cubicTangent(last, 1).x).toBeCloseTo(cubicTangent(first, 0).x, 6);
    expect(cubicTangent(last, 1).y).toBeCloseTo(cubicTangent(first, 0).y, 6);
  });
});

describe('parametrización', () => {
  /*
   * LA PRUEBA QUE JUSTIFICA EL VALOR POR DEFECTO.
   *
   * Con espaciados desiguales, la parametrización uniforme sobreoscila: la
   * curva se sale del recinto de los puntos. La centrípeta no. Es exactamente
   * el bulto que aparecería cerca del hombro en una sisa trazada con α = 0, y
   * que ninguna patronista aceptaría.
   */
  it('la uniforme forma un bucle y la centrípeta no', () => {
    const uniform = maxDetourRatio(UNEVEN, UNIFORM);
    const centripetal = maxDetourRatio(UNEVEN, CENTRIPETAL);

    // Con α = 0 el tramo corto recorre varias veces su propia cuerda: es un bucle.
    expect(uniform).toBeGreaterThan(3);
    // Con α = 0.5 el rodeo se queda en un porcentaje pequeño.
    expect(centripetal).toBeLessThan(1.15);
  });

  it('la de cuerda tampoco forma bucle, pero se aleja más de los puntos', () => {
    expect(maxDetourRatio(UNEVEN, CHORDAL)).toBeLessThan(1.5);

    // El precio de α = 1 es una curva que se aparta mucho de la poligonal en
    // los tramos largos. La centrípeta es el punto medio entre ambos defectos.
    expect(maxDeviationFromPolyline(UNEVEN, CHORDAL)).toBeGreaterThan(
      maxDeviationFromPolyline(UNEVEN, CENTRIPETAL),
    );
  });

  /*
   * Con los puntos igualmente espaciados, la ponderación por distancia no
   * cambia nada y las tres parametrizaciones coinciden. Es la comprobación de
   * que la fórmula no uniforme se reduce a la clásica en el caso regular.
   */
  it('con espaciado regular todas las parametrizaciones coinciden', () => {
    const regular = [vec2(0, 0), vec2(100, 0), vec2(200, 0), vec2(300, 0)];

    const a = catmullRomToCubics(regular, { alpha: UNIFORM });
    const b = catmullRomToCubics(regular, { alpha: CENTRIPETAL });

    for (let i = 0; i < a.length; i++) {
      const left = a[i];
      const right = b[i];
      if (left === undefined || right === undefined) continue;
      expect(equals(left.p1, right.p1, 1e-6)).toBe(true);
      expect(equals(left.p2, right.p2, 1e-6)).toBe(true);
    }
  });
});

describe('tangentes impuestas', () => {
  it('la tangente inicial se respeta', () => {
    const cubics = catmullRomToCubics([vec2(0, 0), vec2(100, 50), vec2(200, 0)], {
      startTangent: vec2(0, 300),
    });

    const first = cubics[0];
    if (first === undefined) return;

    const tangent = cubicTangent(first, 0);
    expect(tangent.x).toBeCloseTo(0, 6);
    expect(tangent.y).toBeCloseTo(1, 6);
  });

  it('la tangente final se respeta', () => {
    const cubics = catmullRomToCubics([vec2(0, 0), vec2(100, 50), vec2(200, 0)], {
      endTangent: vec2(0, -300),
    });

    const last = cubics.at(-1);
    if (last === undefined) return;

    const tangent = cubicTangent(last, 1);
    expect(tangent.x).toBeCloseTo(0, 6);
    expect(tangent.y).toBeCloseTo(-1, 6);
  });
});

describe('splineThrough', () => {
  it('produce un contorno válido y continuo', () => {
    const c = splineThrough([vec2(0, 0), vec2(60, 90), vec2(150, 110), vec2(220, 20)]);

    expect(validateContour(c)).toHaveLength(0);
    expect(contourLength(c)).toBeGreaterThan(220);
  });

  it('un contorno cerrado válido tiene tantos tramos como puntos', () => {
    const points = [vec2(0, 0), vec2(100, 0), vec2(100, 100), vec2(0, 100)];
    const c = splineThrough(points, { closed: true });

    expect(c.segments).toHaveLength(4);
    expect(c.closed).toBe(true);
    expect(validateContour(c)).toHaveLength(0);
  });

  /*
   * Un cuadrado suavizado debe medir más que su perímetro recto (las curvas se
   * abomban hacia fuera) pero no desmesuradamente: si midiera mucho más, la
   * curva estaría dando latigazos.
   */
  it('la longitud de un cuadrado suavizado es razonable', () => {
    const side = 100;
    const c = splineThrough(
      [vec2(0, 0), vec2(side, 0), vec2(side, side), vec2(0, side)],
      { closed: true },
    );

    const perimeter = 4 * side;
    const length = contourLength(c);

    expect(length).toBeGreaterThan(perimeter);
    expect(length).toBeLessThan(perimeter * 1.15);
  });
});

describe('caso realista: curva de sisa', () => {
  /*
   * Puntos de una sisa de blusa talla M. La curva debe pasar por todos ellos,
   * medir lo que mide una sisa real (~46 cm en el contorno completo, aquí sólo
   * media) y no salirse por arriba del punto de hombro.
   */
  it('interpola los puntos sin salirse por encima del hombro', () => {
    const shoulder = vec2(0, 0);
    const points = [shoulder, vec2(12, -48), vec2(30, -85), vec2(58, -110), vec2(96, -118)];

    const c = splineThrough(points);
    expect(validateContour(c)).toHaveLength(0);

    for (const segment of c.segments) {
      if (segment.kind !== 'cubic') continue;
      for (let i = 0; i <= 40; i++) {
        expect(cubicPointAt(segment, i / 40).y).toBeLessThanOrEqual(0.5);
      }
    }

    const straight = points.reduce(
      (sum, p, i) => (i === 0 ? 0 : sum + distance(points[i - 1] ?? p, p)),
      0,
    );
    expect(contourLength(c)).toBeGreaterThan(straight);
    expect(contourLength(c)).toBeLessThan(straight * 1.05);
  });
});
