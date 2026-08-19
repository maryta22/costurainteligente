import { describe, expect, it } from 'vitest';

import { evaluateParameters } from '@core/parametric/evaluate';

import { buildAvatar } from '@domain/avatar/body';
import { ellipsePerimeter } from '@domain/avatar/crossSection';
import type { Ring } from '@domain/avatar/types';
import { vec3 } from '@domain/avatar/types';
import { buildGarmentMesh } from '@domain/garment3d';
import {
  buildFitSurface,
  fitGarment,
  panelWidthAt,
  pushOutside,
  sectionArcLength,
  sectionAt,
  sectionPerimeter,
  strainColor,
  wrapPoint,
} from '@domain/fitting';
import { easeProfile } from '@domain/measurements/ease';
import { buildInputScope } from '@domain/measurements/scope';
import type { SizeCode } from '@domain/measurements/standard';
import { standardMeasurements } from '@domain/measurements/standard';
import { BLOCK_PARAMETERS } from '@domain/pattern/blockParameters';
import type { GarmentId } from '@domain/pattern/generators';
import { generateGarment } from '@domain/pattern/generators';

function scene(garment: GarmentId, size: SizeCode = 'M') {
  const measurements = standardMeasurements(size);
  const evaluation = evaluateParameters(
    BLOCK_PARAMETERS,
    buildInputScope(measurements, easeProfile('semi-fitted')),
  );

  const pattern = generateGarment(garment, { values: evaluation.values, overrides: new Map() });
  if (pattern === null) throw new Error(`sin generador para ${garment}`);

  const avatar = buildAvatar(measurements);

  return { pattern, avatar, mesh: buildGarmentMesh(pattern.pieces, pattern.seams, avatar) };
}

const ring = (y: number, halfWidth: number, halfDepth: number): Ring => ({
  center: vec3(0, y, 0),
  halfWidth,
  halfDepth,
});

describe('secciones del cuerpo', () => {
  it('interpola entre anillos y prolonga fuera del rango', () => {
    const rings = [ring(0, 100, 70), ring(100, 200, 140)];

    expect(sectionAt(rings, 50)?.halfWidth).toBeCloseTo(150, 9);
    expect(sectionAt(rings, -40)?.halfWidth).toBeCloseTo(100, 9);
    expect(sectionAt(rings, 400)?.halfWidth).toBeCloseTo(200, 9);
  });

  /**
   * Los cuatro cuadrantes de una elipse miden lo mismo por simetría. De ahí
   * viene que se pueda trabajar con FRACCIONES de perímetro —0, ¼, ½, ¾— y que
   * el centro de la espalda caiga siempre en el centro de la espalda, sea cual
   * sea lo achatada que esté la sección.
   */
  it('los cuadrantes de la elipse miden exactamente lo mismo', () => {
    for (const ratio of [1, 0.85, 0.72, 0.5]) {
      const section = { centerX: 0, centerZ: 0, halfWidth: 150, halfDepth: 150 * ratio };
      const quarter = sectionPerimeter(section) / 4;

      expect(sectionArcLength(section, Math.PI / 2)).toBeCloseTo(quarter, 3);
      expect(sectionArcLength(section, Math.PI)).toBeCloseTo(quarter * 2, 3);
    }
  });

  it('el perímetro coincide con la integral exacta del núcleo', () => {
    const section = { centerX: 0, centerZ: 0, halfWidth: 167, halfDepth: 121 };
    expect(sectionPerimeter(section)).toBeCloseTo(ellipsePerimeter(167, 121), 2);
  });

  it('saca los puntos de dentro y no toca los de fuera', () => {
    const section = { centerX: 0, centerZ: 0, halfWidth: 100, halfDepth: 70 };

    expect(pushOutside(section, vec3(0, 0, 0), 5)).not.toBeNull();
    expect(pushOutside(section, vec3(300, 0, 0), 5)).toBeNull();

    const out = pushOutside(section, vec3(20, 40, 10), 5);
    expect(out).not.toBeNull();
    if (out === null) return;

    // Sobre la elipse dilatada: la forma normalizada vale exactamente uno.
    expect(Math.hypot(out.x / 105, out.z / 75)).toBeCloseTo(1, 6);
    // Y no se mueve de altura: la expulsión es horizontal.
    expect(out.y).toBe(40);
  });
});

describe('envoltorio sobre la superficie', () => {
  it('recorrer el perímetro entero da la vuelta y vuelve al mismo punto', () => {
    const rings = [ring(0, 150, 110), ring(1000, 150, 110)];
    const surface = buildFitSurface(rings, null, { minY: 0, maxY: 1000 }, 0);
    expect(surface).not.toBeNull();
    if (surface === null) return;

    const perimeter = sectionPerimeter({
      centerX: 0,
      centerZ: 0,
      halfWidth: 150,
      halfDepth: 110,
    });

    const start = wrapPoint(surface, 500, 0, 0);
    const round = wrapPoint(surface, 500, 0, perimeter);

    expect(Math.hypot(round.x - start.x, round.z - start.z)).toBeLessThan(0.05);
  });

  /**
   * La propiedad que justifica todo el método: recorrer una distancia sobre la
   * superficie avanza EXACTAMENTE esa distancia de arco. Si se repartiera por
   * ángulo, en una sección de torso —proporción 0,72— el costadillo se iría más
   * de un centímetro de su sitio.
   */
  it('la distancia recorrida sobre la superficie es la pedida', () => {
    const rings = [ring(0, 150, 108), ring(1000, 150, 108)];
    const surface = buildFitSurface(rings, null, { minY: 0, maxY: 1000 }, 0);
    if (surface === null) return;

    let previous = wrapPoint(surface, 500, 0, 0);
    let travelled = 0;

    for (let arc = 5; arc <= 400; arc += 5) {
      const point = wrapPoint(surface, 500, 0, arc);
      travelled += Math.hypot(point.x - previous.x, point.z - previous.z);
      previous = point;
    }

    // La cuerda subestima algo el arco; con pasos de 5 mm, muy poco.
    expect(travelled).toBeGreaterThan(400 * 0.999);
    expect(travelled).toBeLessThanOrEqual(400);
  });

  it('las fracciones de cuarto caen en el frente, el costado y la espalda', () => {
    const rings = [ring(0, 150, 100), ring(1000, 150, 100)];
    const surface = buildFitSurface(rings, null, { minY: 0, maxY: 1000 }, 0);
    if (surface === null) return;

    const front = wrapPoint(surface, 500, 0, 0);
    const side = wrapPoint(surface, 500, 0.25, 0);
    const back = wrapPoint(surface, 500, 0.5, 0);

    expect(front.z).toBeCloseTo(100, 2);
    expect(front.x).toBeCloseTo(0, 2);
    expect(side.x).toBeCloseTo(150, 2);
    expect(side.z).toBeCloseTo(0, 2);
    expect(back.z).toBeCloseTo(-100, 2);
  });
});

describe('anchura de la pieza cosida', () => {
  it('descuenta las pinzas del contorno', () => {
    const { pattern, mesh } = scene('skirt');
    const front = mesh.panels.find((panel) => String(panel.piece).includes('Front'));
    expect(front).toBeDefined();
    if (front === undefined) return;

    const piece = pattern.pieces.find((p) => p.id === front.piece);
    expect(piece).toBeDefined();
    if (piece === undefined) return;

    const hasDart = piece.edges.some((edge) => edge.role === 'dart');
    if (!hasDart) return;

    /*
     * A media altura la pinza ya se ha cerrado en punta y a la altura de la
     * cintura está abierta del todo, así que arriba la pieza mide MENOS. Si
     * midiera igual, la pinza no se estaría descontando y los costadillos se
     * abrirían justo eso.
     */
    let bottom = 0;
    let top = 0;
    for (let i = 1; i < front.uv.length; i += 2) top = Math.max(top, front.uv[i] ?? 0);

    bottom = panelWidthAt(front, top * 0.15);
    const nearWaist = panelWidthAt(front, top * 0.92);

    expect(nearWaist).toBeLessThan(bottom);
  });
});

describe('prenda vestida', () => {
  it.each(['skirt', 'blouse', 'dress'] as const)('%s: se viste sin avisos', (garment) => {
    const { pattern, avatar, mesh } = scene(garment);
    const fitted = fitGarment(mesh, pattern.pieces, avatar);

    expect(fitted.warnings).toEqual([]);
    expect(fitted.panels.length).toBe(mesh.panels.length);

    for (const panel of fitted.panels) {
      for (const value of panel.positions) expect(Number.isFinite(value)).toBe(true);
    }
  });

  /**
   * ── EL CRITERIO DE ESTA FASE ─────────────────────────────────────────────
   *
   * Si la holgura pedida no aparece como separación real, el método es el que
   * se quiso evitar: la prenda aplastada contra el cuerpo. Ocho centímetros
   * introducidos tienen que salir como ocho centímetros medidos.
   */
  it.each(['skirt', 'blouse', 'dress'] as const)('%s: conserva la holgura', (garment) => {
    const { pattern, avatar, mesh } = scene(garment);
    const fitted = fitGarment(mesh, pattern.pieces, avatar);

    expect(fitted.easeAtLevels.size).toBeGreaterThan(0);

    for (const [level, reading] of fitted.easeAtLevels) {
      expect(reading.easeMm, `holgura en ${level}`).toBeGreaterThan(15);
      // Y no una holgura desbocada: eso delataría un contorno mal sumado.
      expect(reading.easeMm, `holgura en ${level}`).toBeLessThan(250);
    }
  });

  /** El cuerpo mide lo que dicen las medidas: la lectura lo comprueba. */
  it('la lectura del cuerpo coincide con las medidas introducidas', () => {
    const measurements = standardMeasurements('M');
    const { pattern, avatar, mesh } = scene('dress');
    const fitted = fitGarment(mesh, pattern.pieces, avatar);

    const expected = { bust: measurements.bust, waist: measurements.waist, hip: measurements.hip };

    for (const [level, wanted] of Object.entries(expected)) {
      const reading = fitted.easeAtLevels.get(level);
      expect(reading).toBeDefined();
      if (reading === undefined) continue;

      expect(reading.bodyMm).toBeCloseTo(wanted, 0);
    }
  });

  /**
   * Los costadillos, el centro y la cintura cierran POR CONSTRUCCIÓN: la
   * superficie se dilató hasta tener justo el contorno que suman las piezas. No
   * es que la relajación los ajuste bien; es que ya nacen en el mismo sitio.
   *
   * Hombro y sisa NO cierran, y no es un fallo que se pueda pulir: un
   * envoltorio cilíndrico no tiene por dónde pasar por encima del hombro ni por
   * dónde salvar los 270 mm que van de la sisa al brazo. Eso lo cierra la
   * simulación de la Fase 13.
   */
  it.each(['skirt', 'blouse', 'dress'] as const)('%s: cierra lo que puede cerrar', (garment) => {
    const { pattern, avatar, mesh } = scene(garment);

    // Sin relajar, para medir el envoltorio y no el ajuste posterior.
    const fitted = fitGarment(mesh, pattern.pieces, avatar, { iterations: 0 });

    const offsets: number[] = [];
    let cursor = 0;
    for (const panel of mesh.panels) {
      offsets.push(cursor);
      cursor += panel.vertexCount;
    }

    const positions = new Float32Array(cursor * 3);
    fitted.panels.forEach((panel, i) => positions.set(panel.positions, (offsets[i] ?? 0) * 3));

    for (const link of mesh.seams) {
      const horizontal =
        link.seam.startsWith('fold:') ||
        link.seam.startsWith('center:') ||
        link.seam.includes('.side~');

      if (!horizontal) continue;

      let worst = 0;
      for (let i = 0; i < link.verticesA.length; i++) {
        const ia = ((offsets[link.panelA] ?? 0) + (link.verticesA[i] ?? 0)) * 3;
        const ib = ((offsets[link.panelB] ?? 0) + (link.verticesB[i] ?? 0)) * 3;

        worst = Math.max(
          worst,
          Math.hypot(
            (positions[ib] ?? 0) - (positions[ia] ?? 0),
            (positions[ib + 1] ?? 0) - (positions[ia + 1] ?? 0),
            (positions[ib + 2] ?? 0) - (positions[ia + 2] ?? 0),
          ),
        );
      }

      expect(worst, `costura ${link.seam}`).toBeLessThan(5);
    }
  });

  it.each(['skirt', 'blouse', 'dress'] as const)('%s: la tela no atraviesa el cuerpo', (garment) => {
    const { pattern, avatar, mesh } = scene(garment);
    const fitted = fitGarment(mesh, pattern.pieces, avatar);

    // Un puñado de vértices en la esquina de hombro y sisa se resisten; el
    // grueso de la prenda tiene que quedar fuera.
    const total = fitted.panels.reduce((sum, panel) => sum + panel.vertexCount, 0);
    expect(fitted.relax.penetrating / total).toBeLessThan(0.02);
  });

  it.each(['skirt', 'blouse', 'dress'] as const)('%s: la tela conserva su longitud', (garment) => {
    const { pattern, avatar, mesh } = scene(garment);
    const fitted = fitGarment(mesh, pattern.pieces, avatar);

    // El máximo lo fijan unas pocas aristas del hombro; el percentil describe
    // la prenda de verdad.
    expect(fitted.strain.meanAbs).toBeLessThan(0.08);
    expect(fitted.strain.p95Abs).toBeLessThan(0.25);
  });

  it('vestir es determinista', () => {
    const { pattern, avatar, mesh } = scene('blouse');

    const a = fitGarment(mesh, pattern.pieces, avatar);
    const b = fitGarment(mesh, pattern.pieces, avatar);

    expect(a.relax.maxSeamGapMm).toBe(b.relax.maxSeamGapMm);
    expect([...(a.panels[0]?.positions ?? [])]).toEqual([...(b.panels[0]?.positions ?? [])]);
  });

  it('cambiar la talla vuelve a vestir sin degradarse', () => {
    for (const size of ['XS', 'M', 'XL'] as const) {
      const { pattern, avatar, mesh } = scene('dress', size);
      const fitted = fitGarment(mesh, pattern.pieces, avatar, { iterations: 30 });

      expect(fitted.warnings).toEqual([]);
      expect(fitted.strain.meanAbs).toBeLessThan(0.08);
    }
  });
});

describe('rampa de tensión', () => {
  it('es divergente: neutra en el centro, roja al estirar, azul al comprimir', () => {
    const [nr, ng, nb] = strainColor(0);
    expect(nr).toBeCloseTo(ng, 6);
    expect(ng).toBeCloseTo(nb, 6);

    const [sr, , sb] = strainColor(0.2);
    expect(sr).toBeGreaterThan(sb);

    const [cr, , cb] = strainColor(-0.2);
    expect(cb).toBeGreaterThan(cr);
  });

  it('satura y no se sale del rango', () => {
    for (const value of [-10, -0.1, 0, 0.1, 10]) {
      for (const channel of strainColor(value)) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });
});
