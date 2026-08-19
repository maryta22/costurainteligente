import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { buildAvatar } from '@domain/avatar/body';
import { sectionAt } from '@domain/fitting';
import { DEPTH_RATIOS, axesForPerimeter, ellipsePerimeter } from '@domain/avatar/crossSection';
import { computeNormals, densify, loft, mergeMeshes } from '@domain/avatar/loft';
import type { MeshData, Ring } from '@domain/avatar/types';
import { vec3 } from '@domain/avatar/types';
import { SIZE_CODES, standardMeasurements } from '@domain/measurements/standard';

describe('perímetro de la elipse', () => {
  /*
   * No tiene forma cerrada: es una integral elíptica de segunda especie, el
   * ejemplo canónico de función sin primitiva elemental. Se integra con la
   * cuadratura adaptativa que el núcleo ya tenía de la Fase 2.
   */
  it('una circunferencia mide 2πr', () => {
    expect(ellipsePerimeter(100, 100)).toBeCloseTo(2 * Math.PI * 100, 4);
    expect(ellipsePerimeter(37.5, 37.5)).toBeCloseTo(2 * Math.PI * 37.5, 5);
  });

  it('coincide con la aproximación de Ramanujan', () => {
    const ramanujan = (a: number, b: number): number =>
      Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));

    for (const [a, b] of [
      [100, 72],
      [150, 105],
      [80, 76],
      [200, 100],
    ] as const) {
      expect(ellipsePerimeter(a, b)).toBeCloseTo(ramanujan(a, b), 1);
    }
  });

  it('crece de forma monótona con los semiejes', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 10, max: 300, noNaN: true }),
        fc.double({ min: 1, max: 50, noNaN: true }),
        (a, delta) => {
          expect(ellipsePerimeter(a + delta, a * 0.75)).toBeGreaterThan(
            ellipsePerimeter(a, a * 0.75),
          );
        },
      ),
    );
  });

  it('un semieje nulo no produce NaN', () => {
    expect(ellipsePerimeter(0, 100)).toBe(0);
    expect(ellipsePerimeter(100, 0)).toBe(0);
  });
});

describe('secciones resueltas por perímetro', () => {
  /*
   * LA PROPIEDAD QUE HACE ÚTIL EL MANIQUÍ.
   *
   * Cada sección se resuelve para tener EXACTAMENTE el perímetro medido. Un
   * modelo con «morph targets» interpola entre formas esculpidas y el resultado
   * se PARECE a las medidas; aquí las cumple. Es la única forma de que probar
   * una prenda sobre el maniquí signifique algo.
   */
  it('la elipse resuelta tiene el perímetro pedido', () => {
    for (const perimeter of [260, 380, 700, 880, 940, 1040]) {
      for (const ratio of [0.5, 0.7, 0.78, 0.95, 1]) {
        const axes = axesForPerimeter(perimeter, ratio);
        const measured = ellipsePerimeter(axes.halfWidth, axes.halfDepth);

        expect(Math.abs(measured - perimeter)).toBeLessThan(0.05);
      }
    }
  });

  it('respeta la proporción entre profundidad y anchura', () => {
    for (const ratio of [0.5, 0.72, 0.9]) {
      const axes = axesForPerimeter(880, ratio);
      expect(axes.halfDepth / axes.halfWidth).toBeCloseTo(ratio, 9);
    }
  });

  /*
   * Un torso no es cilíndrico: es sensiblemente más ancho que profundo. Modelar
   * las secciones como circunferencias daría el contorno correcto con la forma
   * equivocada, y una prenda caería mal sin que la medida delatase el problema.
   */
  it('las proporciones del cuerpo aplanan el pecho más que la cadera', () => {
    expect(DEPTH_RATIOS.bust).toBeLessThan(DEPTH_RATIOS.hip);
    expect(DEPTH_RATIOS.shoulder).toBeLessThan(DEPTH_RATIOS.bust);
  });

  it('un perímetro nulo devuelve una sección nula', () => {
    expect(axesForPerimeter(0, 0.75)).toEqual({ halfWidth: 0, halfDepth: 0 });
  });
});

describe('generación de malla', () => {
  const rings: Ring[] = [
    { center: vec3(0, 0, 0), halfWidth: 100, halfDepth: 70 },
    { center: vec3(0, 200, 0), halfWidth: 120, halfDepth: 85 },
    { center: vec3(0, 400, 0), halfWidth: 90, halfDepth: 65 },
  ];

  it('produce buffers coherentes', () => {
    const mesh = loft(rings, { radialSegments: 16, subdivisions: 2 });

    expect(mesh.positions.length % 3).toBe(0);
    expect(mesh.normals.length).toBe(mesh.positions.length);
    expect(mesh.indices.length % 3).toBe(0);
    expect(mesh.indices.length).toBeGreaterThan(0);
  });

  it('ningún índice apunta fuera del buffer', () => {
    const mesh = loft(rings, { radialSegments: 16, subdivisions: 2, capStart: true, capEnd: true });
    const vertices = mesh.positions.length / 3;

    for (const index of mesh.indices) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(vertices);
    }
  });

  it('ninguna coordenada ni normal deja de ser finita', () => {
    const mesh = loft(rings, { radialSegments: 24, subdivisions: 4, capEnd: true });

    for (const value of mesh.positions) expect(Number.isFinite(value)).toBe(true);
    for (const value of mesh.normals) expect(Number.isFinite(value)).toBe(true);
  });

  it('las normales son unitarias', () => {
    const mesh = loft(rings, { radialSegments: 16, subdivisions: 2 });

    for (let i = 0; i < mesh.normals.length; i += 3) {
      const length = Math.hypot(
        mesh.normals[i] ?? 0,
        mesh.normals[i + 1] ?? 0,
        mesh.normals[i + 2] ?? 0,
      );
      expect(length).toBeCloseTo(1, 6);
    }
  });

  /*
   * Interpolar entre los anillos clave es lo que evita que el cuerpo salga
   * facetado, con una arista visible entre la sección del pecho y la de la
   * cintura. Los anillos medidos siguen estando en el resultado.
   */
  it('densificar conserva los anillos originales', () => {
    const dense = densify(rings, 4);

    expect(dense.length).toBeGreaterThan(rings.length);

    for (const original of rings) {
      const found = dense.find(
        (candidate) =>
          Math.abs(candidate.center.y - original.center.y) < 1e-9 &&
          Math.abs(candidate.halfWidth - original.halfWidth) < 1e-9,
      );
      expect(found, `falta el anillo en y=${original.center.y}`).toBeDefined();
    }
  });

  it('fundir mallas desplaza los índices correctamente', () => {
    const a = loft(rings, { radialSegments: 8, subdivisions: 1 });
    const b = loft(rings, { radialSegments: 8, subdivisions: 1 });
    const merged = mergeMeshes([a, b]);

    expect(merged.positions.length).toBe(a.positions.length + b.positions.length);
    expect(merged.indices.length).toBe(a.indices.length + b.indices.length);

    const vertices = merged.positions.length / 3;
    for (const index of merged.indices) expect(index).toBeLessThan(vertices);
  });

  it('un perfil degenerado no rompe nada', () => {
    expect(loft([], {}).indices.length).toBe(0);
    expect(loft([rings[0] as Ring], {}).indices.length).toBe(0);
  });

  it('las normales de una malla vacía no fallan', () => {
    expect(computeNormals(new Float32Array(), new Uint32Array()).length).toBe(0);
  });
});

describe('CRITERIO DE SALIDA — el avatar responde a las medidas', () => {
  it('se construye para todas las tallas', () => {
    for (const size of SIZE_CODES) {
      const avatar = buildAvatar(standardMeasurements(size));

      expect(avatar.mesh.indices.length).toBeGreaterThan(1000);
      expect(avatar.heightMm).toBe(standardMeasurements(size).height);
    }
  });

  /*
   * LA COMPROBACIÓN QUE DA SENTIDO A TODO: la sección de la cintura del maniquí
   * mide la cintura introducida. Se verifica midiendo la anchura real de la
   * malla a esa altura contra la elipse que debería tener.
   *
   * Se mide sobre el TORSO y no sobre el cuerpo entero: los brazos cuelgan
   * cruzando la altura de la cintura, y contarlos daría una anchura de 360 mm
   * de más — el cuerpo tiene brazos, pero la cinta métrica no los rodea.
   */
  it('la anchura del cuerpo en cada sección corresponde a su medida', () => {
    const m = standardMeasurements('M');
    const avatar = buildAvatar(m);

    const widthAt = (y: number): number => {
      const { positions } = avatar.parts.torso;
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;

      for (let i = 0; i < positions.length; i += 3) {
        if (Math.abs((positions[i + 1] ?? 0) - y) > 4) continue;
        const x = positions[i] ?? 0;
        min = Math.min(min, x);
        max = Math.max(max, x);
      }

      return max - min;
    };

    for (const [level, perimeter, ratio] of [
      ['waist', m.waist, DEPTH_RATIOS.waist],
      ['hip', m.hip, DEPTH_RATIOS.hip],
      ['bust', m.bust, DEPTH_RATIOS.bust],
    ] as const) {
      const y = avatar.levels[level];
      if (y === undefined) continue;

      const expected = axesForPerimeter(perimeter, ratio).halfWidth * 2;
      expect(Math.abs(widthAt(y) - expected), `${level}`).toBeLessThan(3);
    }
  });

  it('cambiar una medida cambia el cuerpo sólo donde corresponde', () => {
    const base = standardMeasurements('M');
    const wider = { ...base, waist: base.waist + 200 };

    const before = buildAvatar(base);
    const after = buildAvatar(wider);

    // La malla tiene la misma topología: sólo se mueven los vértices.
    expect(after.mesh.positions.length).toBe(before.mesh.positions.length);
    expect(after.mesh.indices).toEqual(before.mesh.indices);

    // Sobre el torso: los brazos cruzan la altura de la cintura y falsearían
    // la medida sin cambiar con ella.
    const spread = (avatar: typeof before, y: number): number => {
      const { positions } = avatar.parts.torso;
      let max = 0;
      for (let i = 0; i < positions.length; i += 3) {
        if (Math.abs((positions[i + 1] ?? 0) - y) > 4) continue;
        max = Math.max(max, Math.abs(positions[i] ?? 0));
      }
      return max;
    };

    const waistY = before.levels.waist ?? 0;
    const hipY = before.levels.hip ?? 0;

    expect(spread(after, waistY)).toBeGreaterThan(spread(before, waistY) + 10);
    // La cadera apenas se mueve: sólo la arrastra la interpolación entre anillos.
    expect(Math.abs(spread(after, hipY) - spread(before, hipY))).toBeLessThan(12);
  });

  it('subir de talla ensancha el cuerpo', () => {
    const small = buildAvatar(standardMeasurements('XS'));
    const large = buildAvatar(standardMeasurements('XL'));

    const maxWidth = (avatar: typeof small): number => {
      let max = 0;
      for (let i = 0; i < avatar.mesh.positions.length; i += 3) {
        max = Math.max(max, Math.abs(avatar.mesh.positions[i] ?? 0));
      }
      return max;
    };

    expect(maxWidth(large)).toBeGreaterThan(maxWidth(small));
    expect(large.heightMm).toBeGreaterThan(small.heightMm);
  });

  it('el cuerpo se apoya en el suelo y llega a su estatura', () => {
    const m = standardMeasurements('M');
    const avatar = buildAvatar(m);

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    for (let i = 1; i < avatar.mesh.positions.length; i += 3) {
      const y = avatar.mesh.positions[i] ?? 0;
      min = Math.min(min, y);
      max = Math.max(max, y);
    }

    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeCloseTo(m.height, 0);
  });

  /*
   * Los puntos de referencia son la interfaz entre cuerpo y prenda: en la Fase
   * 12 el «rig» de colocación situará cada pieza respecto a ellos.
   */
  it('los puntos de referencia están donde deben', () => {
    const m = standardMeasurements('M');
    const avatar = buildAvatar(m);

    expect(avatar.landmarks.waist?.y).toBeCloseTo(m.waistToFloor, 6);
    expect(avatar.landmarks.hip?.y).toBeCloseTo(m.waistToFloor - m.waistToHip, 6);
    expect(avatar.landmarks.bust?.y ?? 0).toBeGreaterThan(avatar.landmarks.waist?.y ?? 0);
    expect(avatar.landmarks.neck?.y ?? 0).toBeGreaterThan(avatar.landmarks.bust?.y ?? 0);

    // Los hombros son simétricos.
    expect(avatar.landmarks.shoulderLeft?.x ?? 0).toBeCloseTo(
      -(avatar.landmarks.shoulderRight?.x ?? 0),
      9,
    );
  });

  it('ninguna talla produce una malla defectuosa', () => {
    for (const size of SIZE_CODES) {
      const mesh: MeshData = buildAvatar(standardMeasurements(size)).mesh;
      const vertices = mesh.positions.length / 3;

      for (const value of mesh.positions) expect(Number.isFinite(value)).toBe(true);
      for (const index of mesh.indices) expect(index).toBeLessThan(vertices);
    }
  });
});

/**
 * ── Regresión ──────────────────────────────────────────────────────────────
 *
 * El bajo pecho estaba situado POR ENCIMA del pecho —un signo cambiado en
 * `bodyLevels`— y eso rompía el orden de altura de los anillos del torso. Los 23
 * tests de la Fase 10 pasaban igual: la malla se lofteaba, era cerrada y
 * respondía a las medidas. Sólo se vio al preguntarle al cuerpo su contorno a la
 * altura del pecho y recibir 743 mm donde la medida decía 880.
 */
describe('las secciones del cuerpo están en orden y miden lo que dicen', () => {
  it.each(SIZE_CODES)('%s: los anillos suben en altura', (size) => {
    const avatar = buildAvatar(standardMeasurements(size));

    for (const rings of [avatar.sections.torso, ...avatar.sections.arms, ...avatar.sections.legs]) {
      for (let i = 0; i + 1 < rings.length; i++) {
        const lower = rings[i];
        const upper = rings[i + 1];
        if (lower === undefined || upper === undefined) continue;

        expect(upper.center.y).toBeGreaterThan(lower.center.y);
      }
    }
  });

  it.each(SIZE_CODES)('%s: el contorno en pecho, cintura y cadera es el medido', (size) => {
    const m = standardMeasurements(size);
    const avatar = buildAvatar(m);

    const expected = { bust: m.bust, waist: m.waist, hip: m.hip };

    for (const [level, wanted] of Object.entries(expected)) {
      const y = avatar.levels[level];
      expect(y).toBeDefined();
      if (y === undefined) continue;

      const section = sectionAt(avatar.sections.torso, y);
      expect(section).not.toBeNull();
      if (section === null) continue;

      // Una décima de milímetro: es una medida, no una estimación.
      expect(ellipsePerimeter(section.halfWidth, section.halfDepth)).toBeCloseTo(wanted, 1);
    }
  });
});
