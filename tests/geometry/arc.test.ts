import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  arcBounds,
  arcContainsAngle,
  arcEnd,
  arcLength,
  arcPointAt,
  arcReverse,
  arcSeg,
  arcSplitAt,
  arcStart,
  arcTangent,
  arcThroughPoints,
  arcToCubics,
  arcToPolyline,
  arcTransform,
} from '@core/geometry/arc';
import { cubicLength, cubicPointAt } from '@core/geometry/cubic';
import { TAU, degToRad } from '@core/geometry/math';
import { reflection, rotation, scaling, translation } from '@core/geometry/mat3';
import { distance, equals, length, vec2 } from '@core/geometry/vec2';

const HALF_PI = Math.PI / 2;

describe('evaluación', () => {
  it('recorre la circunferencia según el barrido', () => {
    const arc = arcSeg(vec2(0, 0), 100, 0, HALF_PI);

    expect(equals(arcStart(arc), vec2(100, 0), 1e-9)).toBe(true);
    expect(equals(arcEnd(arc), vec2(0, 100), 1e-9)).toBe(true);
    expect(equals(arcPointAt(arc, 0.5), vec2(70.71067811865476, 70.71067811865476), 1e-9)).toBe(
      true,
    );
  });

  it('todos sus puntos están a distancia R del centro', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 500, noNaN: true }),
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        fc.double({ min: -TAU, max: TAU, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (radius, start, sweep, t) => {
          const arc = arcSeg(vec2(30, -20), radius, start, sweep);
          expect(distance(arcPointAt(arc, t), arc.center)).toBeCloseTo(radius, 9);
        },
      ),
    );
  });

  it('la tangente es unitaria y perpendicular al radio', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -TAU, max: TAU, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (sweep, t) => {
          fc.pre(Math.abs(sweep) > 0.01);
          const arc = arcSeg(vec2(0, 0), 50, 0.3, sweep);
          const tangent = arcTangent(arc, t);
          const radial = arcPointAt(arc, t);

          expect(length(tangent)).toBeCloseTo(1, 9);
          expect(tangent.x * radial.x + tangent.y * radial.y).toBeCloseTo(0, 6);
        },
      ),
    );
  });

  it('el barrido negativo recorre en sentido horario', () => {
    const arc = arcSeg(vec2(0, 0), 10, 0, -HALF_PI);
    expect(equals(arcEnd(arc), vec2(0, -10), 1e-9)).toBe(true);
  });
});

describe('longitud', () => {
  /*
   * Exacta, sin cuadratura: es la ventaja de conservar el arco como arco en
   * lugar de convertirlo a cúbicas al almacenarlo.
   */
  it('es R·|barrido|, exacta', () => {
    expect(arcLength(arcSeg(vec2(0, 0), 100, 0, HALF_PI))).toBeCloseTo(50 * Math.PI, 12);
    expect(arcLength(arcSeg(vec2(0, 0), 100, 0, TAU))).toBeCloseTo(200 * Math.PI, 12);
    expect(arcLength(arcSeg(vec2(0, 0), 100, 0, -HALF_PI))).toBeCloseTo(50 * Math.PI, 12);
  });

  it('la parametrización es proporcional a la longitud', () => {
    const arc = arcSeg(vec2(0, 0), 80, 0.4, 2.1);
    const total = arcLength(arc);

    let previous = arcPointAt(arc, 0);
    const steps: number[] = [];

    for (let i = 1; i <= 10; i++) {
      const next = arcPointAt(arc, i / 10);
      steps.push(distance(previous, next));
      previous = next;
    }

    // Todas las cuerdas de un arco dividido en partes iguales son idénticas.
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(1e-9);
    expect(steps.reduce((a, b) => a + b, 0)).toBeLessThan(total);
  });
});

describe('caja envolvente', () => {
  /*
   * Los extremos de coordenada de una circunferencia están en los ángulos
   * cardinales. La caja de un cuarto de circunferencia en el primer cuadrante
   * la marcan sus propios extremos; la de media circunferencia incluye además
   * el punto más alto.
   */
  it('incluye los ángulos cardinales contenidos en el barrido', () => {
    const quarter = arcBounds(arcSeg(vec2(0, 0), 100, 0, HALF_PI));
    expect(quarter.min.x).toBeCloseTo(0, 9);
    expect(quarter.max.x).toBeCloseTo(100, 9);
    expect(quarter.max.y).toBeCloseTo(100, 9);

    const half = arcBounds(arcSeg(vec2(0, 0), 100, 0, Math.PI));
    expect(half.min.x).toBeCloseTo(-100, 9);
    expect(half.max.y).toBeCloseTo(100, 9);
    expect(half.min.y).toBeCloseTo(0, 9);
  });

  it('contiene todo el arco', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
        fc.double({ min: -TAU, max: TAU, noNaN: true }),
        (start, sweep) => {
          const arc = arcSeg(vec2(5, -3), 40, start, sweep);
          const bounds = arcBounds(arc);

          for (let i = 0; i <= 60; i++) {
            const p = arcPointAt(arc, i / 60);
            expect(p.x).toBeGreaterThanOrEqual(bounds.min.x - 1e-6);
            expect(p.x).toBeLessThanOrEqual(bounds.max.x + 1e-6);
            expect(p.y).toBeGreaterThanOrEqual(bounds.min.y - 1e-6);
            expect(p.y).toBeLessThanOrEqual(bounds.max.y + 1e-6);
          }
        },
      ),
    );
  });
});

describe('arcContainsAngle', () => {
  it('distingue dentro y fuera del barrido', () => {
    const arc = arcSeg(vec2(0, 0), 10, 0, HALF_PI);

    expect(arcContainsAngle(arc, degToRad(45))).toBe(true);
    expect(arcContainsAngle(arc, degToRad(0))).toBe(true);
    expect(arcContainsAngle(arc, degToRad(90))).toBe(true);
    expect(arcContainsAngle(arc, degToRad(120))).toBe(false);
    expect(arcContainsAngle(arc, degToRad(-30))).toBe(false);
  });

  it('funciona con barrido horario', () => {
    const arc = arcSeg(vec2(0, 0), 10, 0, -HALF_PI);
    expect(arcContainsAngle(arc, degToRad(-45))).toBe(true);
    expect(arcContainsAngle(arc, degToRad(45))).toBe(false);
  });
});

describe('aproximación por cúbicas', () => {
  /*
   * La constante κ = (4/3)·tan(Δ/4) hace coincidir la cúbica con el arco en
   * extremos, tangentes y punto medio. Se comprueba el error radial máximo, que
   * es la magnitud que importa: para 90° debe quedar en el orden de 2.7e-4·R.
   */
  it('el error radial de un cuarto de circunferencia es ~2.7e-4·R', () => {
    const radius = 100;
    const [approximation] = arcToCubics(arcSeg(vec2(0, 0), radius, 0, HALF_PI));
    expect(approximation).toBeDefined();
    if (approximation === undefined) return;

    let worst = 0;
    for (let i = 0; i <= 200; i++) {
      const onCurve = cubicPointAt(approximation, i / 200);
      worst = Math.max(worst, Math.abs(Math.hypot(onCurve.x, onCurve.y) - radius));
    }

    expect(worst).toBeLessThan(3e-4 * radius);
  });

  /*
   * ESTA ES LA RAZÓN DE CONSERVAR LOS ARCOS COMO ARCOS.
   *
   * La aproximación por cúbicas es excelente en POSICIÓN —0.027 mm sobre un
   * radio de 100— pero su error en LONGITUD es ~1.4e-4 relativo: una
   * circunferencia de 628 mm mide 0.09 mm de más. Es poco para dibujar y
   * demasiado para casar una copa de manga con su sisa, donde el criterio son
   * 2 mm sobre una costura que puede acumular varios tramos curvos.
   *
   * El arco nativo no tiene ese error: su longitud es R·|barrido|, exacta.
   */
  it('la aproximación por cúbicas alarga la circunferencia un 1.4e-4 relativo', () => {
    const radius = 100;
    const exact = TAU * radius;

    const approximated = arcToCubics(arcSeg(vec2(0, 0), radius, 0, TAU)).reduce(
      (sum, c) => sum + cubicLength(c),
      0,
    );

    const relative = (approximated - exact) / exact;
    expect(relative).toBeGreaterThan(0); // la cúbica va por fuera del arco
    expect(relative).toBeLessThan(2e-4);

    // La longitud nativa del arco sí es exacta.
    expect(arcLength(arcSeg(vec2(0, 0), radius, 0, TAU))).toBeCloseTo(exact, 10);
  });

  it('el error de longitud cae abruptamente al reducir el barrido por tramo', () => {
    const radius = 100;
    const exact = TAU * radius;
    const arc = arcSeg(vec2(0, 0), radius, 0, TAU);

    const errorFor = (maxSweep: number): number =>
      Math.abs(arcToCubics(arc, maxSweep).reduce((sum, c) => sum + cubicLength(c), 0) - exact);

    const at90 = errorFor(Math.PI / 2);
    const at45 = errorFor(Math.PI / 4);

    // El error escala aproximadamente con la sexta potencia del barrido, así
    // que partir por la mitad lo reduce en torno a 64 veces.
    expect(at45).toBeLessThan(at90 / 20);
    expect(at45).toBeLessThan(0.01);
  });

  it('subdivide en tramos de 90° como máximo', () => {
    expect(arcToCubics(arcSeg(vec2(0, 0), 10, 0, TAU))).toHaveLength(4);
    expect(arcToCubics(arcSeg(vec2(0, 0), 10, 0, HALF_PI))).toHaveLength(1);
  });
});

describe('aplanamiento', () => {
  it('respeta la tolerancia por la fórmula de la flecha', () => {
    const radius = 200;
    const arc = arcSeg(vec2(0, 0), radius, 0, Math.PI);

    for (const tolerance of [1, 0.1, 0.01]) {
      const polyline = arcToPolyline(arc, tolerance);

      for (let i = 0; i + 1 < polyline.length; i++) {
        const a = polyline[i];
        const b = polyline[i + 1];
        if (a === undefined || b === undefined) continue;

        // Flecha = R − distancia del centro al punto medio de la cuerda.
        const midpoint = vec2((a.x + b.x) / 2, (a.y + b.y) / 2);
        const sagitta = radius - Math.hypot(midpoint.x, midpoint.y);
        expect(sagitta).toBeLessThanOrEqual(tolerance + 1e-9);
      }
    }
  });
});

describe('transformación', () => {
  it('una semejanza conserva la naturaleza de arco', () => {
    const arc = arcSeg(vec2(10, 5), 40, 0.3, 1.2);
    const transformed = arcTransform(arc, scaling(2));

    expect(transformed).not.toBeNull();
    expect(transformed?.radius).toBeCloseTo(80, 9);
  });

  it('la traslación mueve el centro y conserva radio y barrido', () => {
    const arc = arcSeg(vec2(0, 0), 40, 0.3, 1.2);
    const moved = arcTransform(arc, translation(100, -50));

    expect(moved?.center.x).toBeCloseTo(100, 9);
    expect(moved?.radius).toBeCloseTo(40, 9);
    expect(moved?.sweepAngle).toBeCloseTo(1.2, 9);
  });

  it('la rotación desplaza el ángulo inicial', () => {
    const arc = arcSeg(vec2(0, 0), 40, 0, 1);
    const rotated = arcTransform(arc, rotation(HALF_PI));
    expect(rotated?.startAngle).toBeCloseTo(HALF_PI, 9);
  });

  /*
   * Una reflexión invierte el sentido de giro. Importa en el dominio: al
   * reflejar una pieza cambia el sentido de recorrido de su contorno y, con
   * él, el lado hacia el que se aplica el margen de costura.
   */
  it('la reflexión invierte el signo del barrido', () => {
    const arc = arcSeg(vec2(0, 0), 40, 0, 1.2);
    const mirrored = arcTransform(arc, reflection(vec2(0, 0), vec2(0, 1)));

    expect(mirrored).not.toBeNull();
    expect(mirrored?.sweepAngle).toBeCloseTo(-1.2, 9);
  });

  it('devuelve null si la transformación no es semejanza', () => {
    const arc = arcSeg(vec2(0, 0), 40, 0, 1.2);
    expect(arcTransform(arc, scaling(2, 3))).toBeNull();
  });

  it('los puntos transformados coinciden con transformar los puntos', () => {
    const arc = arcSeg(vec2(12, -7), 33, 0.4, 2.2);
    const m = rotation(0.9);
    const transformed = arcTransform(arc, m);
    expect(transformed).not.toBeNull();
    if (transformed === null) return;

    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const source = arcPointAt(arc, t);
      const expected = vec2(
        m.a * source.x + m.c * source.y + m.e,
        m.b * source.x + m.d * source.y + m.f,
      );
      expect(equals(arcPointAt(transformed, t), expected, 1e-8)).toBe(true);
    }
  });
});

describe('arcThroughPoints', () => {
  it('construye el arco que pasa por los tres puntos', () => {
    const a = vec2(100, 0);
    const b = vec2(70.71067811865476, 70.71067811865476);
    const c = vec2(0, 100);

    const arc = arcThroughPoints(a, b, c);
    expect(arc).not.toBeNull();
    if (arc === null) return;

    expect(arc.radius).toBeCloseTo(100, 6);
    expect(equals(arc.center, vec2(0, 0), 1e-6)).toBe(true);
    expect(equals(arcStart(arc), a, 1e-6)).toBe(true);
    expect(equals(arcEnd(arc), c, 1e-6)).toBe(true);
    expect(arcContainsAngle(arc, Math.PI / 4)).toBe(true);
  });

  it('respeta el sentido marcado por el punto intermedio', () => {
    const clockwise = arcThroughPoints(vec2(0, 100), vec2(70.71, 70.71), vec2(100, 0));
    expect(clockwise?.sweepAngle).toBeLessThan(0);

    const counter = arcThroughPoints(vec2(100, 0), vec2(70.71, 70.71), vec2(0, 100));
    expect(counter?.sweepAngle).toBeGreaterThan(0);
  });

  it('devuelve null con puntos colineales', () => {
    expect(arcThroughPoints(vec2(0, 0), vec2(10, 10), vec2(20, 20))).toBeNull();
  });
});

describe('inversión', () => {
  it('recorre el mismo arco en sentido contrario', () => {
    const arc = arcSeg(vec2(3, 4), 25, 0.7, 1.9);
    const reversed = arcReverse(arc);

    expect(equals(arcStart(reversed), arcEnd(arc), 1e-9)).toBe(true);
    expect(equals(arcEnd(reversed), arcStart(arc), 1e-9)).toBe(true);
    expect(arcLength(reversed)).toBeCloseTo(arcLength(arc), 9);
  });
});

describe('subdivisión', () => {
  it('las partes suman el total y comparten el punto de corte', () => {
    const arc = arcSeg(vec2(0, 0), 60, 0.2, 2.4);
    const [left, right] = arcSplitAt(arc, 0.35);

    expect(arcLength(left) + arcLength(right)).toBeCloseTo(arcLength(arc), 9);
    expect(equals(arcEnd(left), arcStart(right), 1e-9)).toBe(true);
    expect(equals(arcEnd(left), arcPointAt(arc, 0.35), 1e-9)).toBe(true);
  });
});
