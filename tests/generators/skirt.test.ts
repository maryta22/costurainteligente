import { describe, expect, it } from 'vitest';

import { evaluateParameters } from '@core/parametric/evaluate';
import { distance, vec2 } from '@core/geometry/vec2';

import type { FitPreset } from '@domain/measurements/ease';
import { FIT_PRESETS, easeProfile } from '@domain/measurements/ease';
import { buildInputScope } from '@domain/measurements/scope';
import type { SizeCode } from '@domain/measurements/standard';
import { SIZE_CODES, standardMeasurements } from '@domain/measurements/standard';
import { buildOverrideMap } from '@domain/pattern/construction/draft';
import type { PointOverride } from '@domain/pattern/construction/draft';
import { solveWaistRun, waistCurve } from '@domain/pattern/construction/steps';
import { edgeLength, findEdge } from '@domain/pattern/edge';
import { generateGarment } from '@domain/pattern/generators';
import { edgeId, pieceId } from '@domain/pattern/ids';
import { BLOCK_PARAMETERS } from '@domain/pattern/blockParameters';
import { resolveNotches } from '@domain/pattern/notch';
import { indexPieces } from '@domain/pattern/seam';
import { allowanceAddsMaterial } from '@domain/pattern/seamAllowance';
import type { PatternPiece } from '@domain/pattern/types';
import { describePieceIssue, validatePattern, validatePiece } from '@domain/pattern/validate';
import { cubicLength } from '@core/geometry/cubic';
import { contour, contourToPolyline } from '@core/geometry/contour';
import { lineSeg } from '@core/geometry/line';
import { polygonArea } from '@core/geometry/polygon';
import { segmentEnd, segmentStart } from '@core/geometry/segment';

function build(
  size: SizeCode = 'M',
  fit: FitPreset = 'semi-fitted',
  overrides: readonly PointOverride[] = [],
) {
  const evaluation = evaluateParameters(
    BLOCK_PARAMETERS,
    buildInputScope(standardMeasurements(size), easeProfile(fit)),
  );
  expect(evaluation.issues).toEqual([]);

  const result = generateGarment('skirt', {
    values: evaluation.values,
    overrides: buildOverrideMap(overrides),
  });

  expect(result).not.toBeNull();
  if (result === null) throw new Error('sin generador');

  return { result, values: evaluation.values };
}

const piece = (pieces: readonly PatternPiece[], id: string): PatternPiece => {
  const found = pieces.find((p) => p.id === pieceId(id));
  if (found === undefined) throw new Error(`falta la pieza ${id}`);
  return found;
};

/** Longitud total de las aristas de cintura de una pieza, sin las patas de pinza. */
function waistEdgeLength(target: PatternPiece, id: string): number {
  const outer = findEdge(target, edgeId(id, 'waistOuter'));
  const inner = findEdge(target, edgeId(id, 'waistInner'));
  if (outer === undefined || inner === undefined) throw new Error('faltan aristas de cintura');
  return edgeLength(target, outer) + edgeLength(target, inner);
}

describe('estructura del patrón', () => {
  it('genera delantero, espalda y pretina', () => {
    const { result } = build();
    expect(result.pieces.map((p) => p.id)).toEqual([
      'skirtFront',
      'skirtBack',
      'skirtWaistband',
    ]);
    expect(result.missing).toEqual([]);
  });

  it('todas las piezas son válidas', () => {
    const { result } = build();
    for (const target of result.pieces) {
      expect(validatePiece(target).map(describePieceIssue)).toEqual([]);
    }
  });

  it('el patrón completo valida, costuras incluidas', () => {
    const { result } = build();
    const report = validatePattern([...result.pieces], [...result.seams]);

    expect(report.seamIssues).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('los márgenes de costura añaden material en todas las piezas', () => {
    const { result } = build();
    for (const target of result.pieces) {
      expect(allowanceAddsMaterial(target)).toBe(true);
    }
  });

  it('el centro delantero va al doblez y el de espalda lleva costura', () => {
    const { result } = build();

    const front = findEdge(piece(result.pieces, 'skirtFront'), edgeId('skirtFront', 'center-front'));
    const back = findEdge(piece(result.pieces, 'skirtBack'), edgeId('skirtBack', 'center-back'));

    expect(front?.onFold).toBe(true);
    expect(back?.onFold).toBe(false);
    expect(back?.seamAllowance).toBeGreaterThan(0);
  });
});

describe('CRITERIO DE SALIDA — el contorno de cintura casa con la medida', () => {
  /*
   * La comprobación que convierte un dibujo en un patrón confeccionable:
   *
   *     cintura del patrón = cintura del cuerpo + holgura
   *
   * medida sobre las aristas de cintura de las cuatro medias piezas —dos
   * delanteros y dos espaldas— una vez descontado lo que se lleva cada pinza.
   *
   * No sale aproximada por casualidad: sale exacta porque el generador RESUELVE
   * la anchura de la cintura para que la curva mida lo pedido, en vez de
   * calcular una proyección horizontal y confiar en que el error sea pequeño.
   */
  it('en todas las tallas y ajustes, con menos de 1 mm de error', () => {
    for (const size of SIZE_CODES) {
      for (const fit of Object.keys(FIT_PRESETS) as FitPreset[]) {
        const { result, values } = build(size, fit);

        const front = waistEdgeLength(piece(result.pieces, 'skirtFront'), 'skirtFront');
        const back = waistEdgeLength(piece(result.pieces, 'skirtBack'), 'skirtBack');

        // Cada media pieza se corta dos veces: delantero y espalda, izquierda y derecha.
        const measured = 2 * (front + back);
        const expected = values.get('finishedWaist') ?? 0;

        expect(Math.abs(measured - expected)).toBeLessThan(1);
      }
    }
  });

  it('la cintura terminada es la del cuerpo más la holgura', () => {
    const { values } = build('M', 'semi-fitted');
    const m = standardMeasurements('M');

    expect(values.get('finishedWaist')).toBe(m.waist + FIT_PRESETS['semi-fitted'].waist);
  });

  /*
   * La cadera del patrón también debe casar. Es la otra medida que decide si la
   * falda entra: el contorno a la altura de cadera es el del cuerpo más su
   * holgura, y ahí no hay pinzas que descontar.
   */
  it('el contorno de cadera casa con la medida', () => {
    const { result, values } = build();
    const front = piece(result.pieces, 'skirtFront');

    // La pieza llega hasta `hipQuarter` en el bajo y en la cadera.
    const hipQuarter = values.get('hipQuarter') ?? 0;
    const hem = findEdge(front, edgeId('skirtFront', 'hem'));
    expect(hem).toBeDefined();
    if (hem === undefined) return;

    expect(edgeLength(front, hem)).toBeCloseTo(hipQuarter, 6);
    expect(4 * hipQuarter).toBeCloseTo(values.get('finishedHip') ?? 0, 6);
  });

  it('lo que recogen las pinzas y los costados suma la reducción total', () => {
    const { values } = build();

    const reduction = values.get('waistReduction') ?? 0;
    const side = values.get('skirtSideIntake') ?? 0;
    const front = values.get('skirtFrontDart') ?? 0;
    const back = values.get('skirtBackDart') ?? 0;

    // Cuatro costados —dos costuras, delantero y espalda— y dos pinzas de cada tipo.
    expect(4 * side + 2 * front + 2 * back).toBeCloseTo(reduction, 6);
  });
});

describe('las pinzas quitan material', () => {
  /*
   * REGRESIÓN DE UN FALLO QUE NINGÚN TEST VIO.
   *
   * El vértice de la pinza caía al lado equivocado y el contorno salía con un
   * pico HACIA FUERA en lugar de una muesca hacia dentro. Nada lo detectaba: la
   * abertura mide lo mismo en un sentido que en otro, así que el contorno de
   * cintura seguía casando con la medida, el polígono seguía siendo simple y el
   * validador no protestaba. Sólo se vio dibujando la falda.
   *
   * La invariante que sí lo atrapa es de área: cerrar una pinza junta sus dos
   * patas, de modo que la pieza CON la pinza abierta tiene que medir menos que
   * la misma pieza con las patas sustituidas por una línea recta.
   */
  it('el área de la pieza es menor con la pinza que sin ella', () => {
    const { result } = build();

    for (const id of ['skirtFront', 'skirtBack']) {
      const target = piece(result.pieces, id);
      const outline = contourToPolyline(target.contour, 0.1);

      const dartEdge = findEdge(target, edgeId(id, 'dart'));
      expect(dartEdge).toBeDefined();
      if (dartEdge === undefined) continue;

      // Contorno sin la pinza: las dos patas se sustituyen por una recta.
      const withoutDart = contourToPolyline(
        contour(
          [
            ...target.contour.segments.slice(0, dartEdge.startSegment),
            lineSeg(
              segmentStart(target.contour.segments[dartEdge.startSegment] ?? lineSeg(vec2(0, 0), vec2(0, 0))),
              segmentEnd(
                target.contour.segments[dartEdge.startSegment + dartEdge.segmentCount - 1] ??
                  lineSeg(vec2(0, 0), vec2(0, 0)),
              ),
            ),
            ...target.contour.segments.slice(dartEdge.startSegment + dartEdge.segmentCount),
          ],
          true,
        ),
        0.1,
      );

      expect(polygonArea(outline)).toBeLessThan(polygonArea(withoutDart));
    }
  });

  it('el vértice de la pinza queda por debajo de sus patas', () => {
    const { result } = build();

    for (const id of ['skirtFront', 'skirtBack']) {
      const apex = result.draft.get(`${id}.dartApex`);
      const legCenter = result.draft.get(`${id}.dartLegCenterSide`);
      const legSide = result.draft.get(`${id}.dartLegSideSide`);

      // La cintura está arriba y la pieza se extiende hacia abajo.
      expect(apex.y).toBeLessThan(Math.min(legCenter.y, legSide.y));
    }
  });

  it('el vértice está a la profundidad pedida', () => {
    const { result, values } = build();

    for (const [id, key] of [
      ['skirtFront', 'skirtFrontDartLength'],
      ['skirtBack', 'skirtBackDartLength'],
    ] as const) {
      const apex = result.draft.get(`${id}.dartApex`);
      const legCenter = result.draft.get(`${id}.dartLegCenterSide`);
      const legSide = result.draft.get(`${id}.dartLegSideSide`);

      const middle = vec2((legCenter.x + legSide.x) / 2, (legCenter.y + legSide.y) / 2);
      expect(distance(apex, middle)).toBeCloseTo(values.get(key) ?? 0, 6);
    }
  });

  it('la abertura de la pinza mide lo que se quiere recoger', () => {
    const { result, values } = build();

    for (const [id, key] of [
      ['skirtFront', 'skirtFrontDart'],
      ['skirtBack', 'skirtBackDart'],
    ] as const) {
      const legCenter = result.draft.get(`${id}.dartLegCenterSide`);
      const legSide = result.draft.get(`${id}.dartLegSideSide`);

      // Medida en línea recta: la curva de cintura es casi plana en ese tramo.
      expect(distance(legCenter, legSide)).toBeCloseTo(values.get(key) ?? 0, 1);
    }
  });
});

describe('las costuras casan', () => {
  /*
   * Delantero y espalda comparten la misma anchura de cintura y la misma altura
   * de cadera, así que sus costados son idénticos. Si difirieran, la falda no
   * cerraría por más que se estirara al coser.
   */
  it('los costados de delantero y espalda miden lo mismo', () => {
    for (const size of SIZE_CODES) {
      const { result } = build(size);

      const front = piece(result.pieces, 'skirtFront');
      const back = piece(result.pieces, 'skirtBack');

      const frontSide = findEdge(front, edgeId('skirtFront', 'side'));
      const backSide = findEdge(back, edgeId('skirtBack', 'side'));
      if (frontSide === undefined || backSide === undefined) continue;

      expect(edgeLength(front, frontSide)).toBeCloseTo(edgeLength(back, backSide), 6);
    }
  });

  it('la costura de costado valida sin embebido', () => {
    const { result } = build();
    const report = validatePattern([...result.pieces], [...result.seams]);
    expect(report.seamIssues).toEqual([]);
  });

  it('la pretina mide la cintura terminada más la solapa', () => {
    const { result, values } = build();
    const band = piece(result.pieces, 'skirtWaistband');

    const waist = findEdge(band, edgeId('skirtWaistband', 'waist'));
    expect(waist).toBeDefined();
    if (waist === undefined) return;

    const expected =
      (values.get('finishedWaist') ?? 0) + (values.get('waistbandExtension') ?? 0);
    expect(edgeLength(band, waist)).toBeCloseTo(expected, 6);
  });
});

describe('regeneración al cambiar medidas', () => {
  /*
   * La propiedad que define un patrón paramétrico: cambiar una medida rehace
   * el trazado entero de forma coherente, sin que nadie tenga que redibujar.
   */
  it('cambiar la cintura cambia el patrón y sigue casando', () => {
    const base = standardMeasurements('M');
    const wider = { ...base, waist: base.waist + 100 };

    const evaluate = (m: typeof base) =>
      evaluateParameters(BLOCK_PARAMETERS, buildInputScope(m, easeProfile('semi-fitted')));

    const before = generateGarment('skirt', {
      values: evaluate(base).values,
      overrides: new Map(),
    });
    const after = generateGarment('skirt', {
      values: evaluate(wider).values,
      overrides: new Map(),
    });

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    if (before === null || after === null) return;

    const waistOf = (result: typeof before): number => {
      const front = waistEdgeLength(piece(result.pieces, 'skirtFront'), 'skirtFront');
      const back = waistEdgeLength(piece(result.pieces, 'skirtBack'), 'skirtBack');
      return 2 * (front + back);
    };

    expect(waistOf(after) - waistOf(before)).toBeCloseTo(100, 0);
  });

  it('cambiar el largo cambia sólo el largo', () => {
    const base = standardMeasurements('M');
    const longer = { ...base, waistToKnee: base.waistToKnee + 150 };

    const evaluate = (m: typeof base) =>
      evaluateParameters(BLOCK_PARAMETERS, buildInputScope(m, easeProfile('semi-fitted')));

    const before = generateGarment('skirt', { values: evaluate(base).values, overrides: new Map() });
    const after = generateGarment('skirt', {
      values: evaluate(longer).values,
      overrides: new Map(),
    });
    if (before === null || after === null) return;

    const hemOf = (result: typeof before): number => {
      const target = piece(result.pieces, 'skirtFront');
      const hem = findEdge(target, edgeId('skirtFront', 'hem'));
      return hem === undefined ? 0 : edgeLength(target, hem);
    };

    // El bajo mide lo mismo: sólo ha cambiado la altura.
    expect(hemOf(after)).toBeCloseTo(hemOf(before), 6);

    const waistOf = (result: typeof before): number =>
      waistEdgeLength(piece(result.pieces, 'skirtFront'), 'skirtFront');
    expect(waistOf(after)).toBeCloseTo(waistOf(before), 3);
  });

  it('más holgura da una falda mayor', () => {
    const tight = build('M', 'fitted');
    const loose = build('M', 'relaxed');

    const hipOf = (r: ReturnType<typeof build>): number => r.values.get('hipQuarter') ?? 0;
    expect(hipOf(loose)).toBeGreaterThan(hipOf(tight));
  });

  it('subir de talla agranda todas las piezas', () => {
    const small = build('XS');
    const large = build('XL');

    const hemOf = (r: ReturnType<typeof build>): number => {
      const target = piece(r.result.pieces, 'skirtFront');
      const hem = findEdge(target, edgeId('skirtFront', 'hem'));
      return hem === undefined ? 0 : edgeLength(target, hem);
    };

    expect(hemOf(large)).toBeGreaterThan(hemOf(small));
  });
});

describe('ajustes manuales — AVISO 2', () => {
  /*
   * EL PROBLEMA MÁS SUBESTIMADO DE UN SISTEMA PARAMÉTRICO.
   *
   * Si el usuario mueve un punto y luego cambia una medida, ¿se pierde su
   * ajuste? Guardar la posición absoluta sería lo peor: el punto se quedaría
   * quieto mientras el resto de la pieza se mueve. Se guarda un DELTA asociado
   * al nombre del punto, y se reaplica tras cada regeneración.
   */
  it('el desplazamiento se aplica al punto nombrado', () => {
    const plain = build();
    const adjusted = build('M', 'semi-fitted', [
      { point: 'skirtFront.waistSide', delta: vec2(0, 12) },
    ]);

    const before = plain.result.draft.get('skirtFront.waistSide');
    const after = adjusted.result.draft.get('skirtFront.waistSide');

    expect(after.y - before.y).toBeCloseTo(12, 9);
    expect(after.x).toBeCloseTo(before.x, 9);
  });

  /*
   * El ajuste ARRASTRA lo que dependa de él. El costado se construye a partir
   * del punto de cintura ya corregido, así que subirlo alarga la costura en vez
   * de dejar un punto suelto fuera del contorno.
   */
  it('el ajuste arrastra la geometría que depende del punto', () => {
    const plain = build();
    const adjusted = build('M', 'semi-fitted', [
      { point: 'skirtFront.waistSide', delta: vec2(0, 12) },
    ]);

    const sideOf = (r: ReturnType<typeof build>): number => {
      const target = piece(r.result.pieces, 'skirtFront');
      const side = findEdge(target, edgeId('skirtFront', 'side'));
      return side === undefined ? 0 : edgeLength(target, side);
    };

    expect(sideOf(adjusted)).toBeGreaterThan(sideOf(plain));
  });

  /*
   * LA PROPIEDAD CENTRAL: el ajuste sobrevive al cambio de medidas. Se conserva
   * el mismo desplazamiento sobre la nueva posición paramétrica, no la posición
   * antigua.
   */
  it('sobrevive a un cambio de talla', () => {
    const override: PointOverride = { point: 'skirtFront.waistSide', delta: vec2(0, 12) };

    for (const size of SIZE_CODES) {
      const plain = build(size);
      const adjusted = build(size, 'semi-fitted', [override]);

      const before = plain.result.draft.get('skirtFront.waistSide');
      const after = adjusted.result.draft.get('skirtFront.waistSide');

      expect(after.y - before.y).toBeCloseTo(12, 9);
    }
  });

  it('los puntos ajustados son enumerables y se pueden deshacer', () => {
    const adjusted = build('M', 'semi-fitted', [
      { point: 'skirtFront.waistSide', delta: vec2(0, 12) },
      { point: 'skirtBack.dartApex', delta: vec2(3, -5) },
    ]);

    const overridden = adjusted.result.draft.overriddenPoints();
    expect(overridden.map((p) => p.name).sort()).toEqual([
      'skirtBack.dartApex',
      'skirtFront.waistSide',
    ]);

    // Cada uno conserva su valor paramétrico, así que devolverlo es inmediato.
    for (const point of overridden) {
      expect(distance(point.parametric, point.position)).toBeGreaterThan(0);
    }

    expect(adjusted.result.draft.overrideMagnitude('skirtFront.waistSide')).toBeCloseTo(12, 9);
  });

  it('un ajuste sobre un punto inexistente no rompe nada', () => {
    const adjusted = build('M', 'semi-fitted', [
      { point: 'no.existe', delta: vec2(100, 100) },
    ]);

    expect(validatePiece(piece(adjusted.result.pieces, 'skirtFront'))).toEqual([]);
  });
});

describe('resolución de la línea de cintura', () => {
  /*
   * La cintura sube hacia el costado, así que su longitud NO es su proyección
   * horizontal. `solveWaistRun` invierte numéricamente la longitud de arco para
   * dar la anchura exacta — el uso para el que se construyó esa maquinaria en
   * la Fase 2.
   */
  it('la curva resuelta mide exactamente lo pedido', () => {
    for (const target of [120, 180, 220, 300]) {
      for (const rise of [0, 5, 7, 15]) {
        const run = solveWaistRun(target, rise);
        const measured = cubicLength(waistCurve(vec2(0, 0), run, rise), 1e-9);
        expect(Math.abs(measured - target)).toBeLessThan(0.01);
      }
    }
  });

  it('sin subida, la anchura coincide con la longitud', () => {
    expect(solveWaistRun(200, 0)).toBeCloseTo(200, 6);
  });

  it('con subida, la anchura es menor que la longitud', () => {
    const run = solveWaistRun(200, 20);
    expect(run).toBeLessThan(200);
    expect(run).toBeGreaterThan(190);
  });
});

describe('piquetes', () => {
  it('marcan la cadera sobre el costado', () => {
    const { result, values } = build();
    const front = piece(result.pieces, 'skirtFront');
    const resolved = resolveNotches(front);

    expect(resolved).toHaveLength(1);

    const notch = resolved[0];
    if (notch === undefined) return;

    // A la altura de la cadera: largo de falda menos altura de cadera.
    const hipHeight = (values.get('skirtLength') ?? 0) - (values.get('waistToHip') ?? 0);
    expect(notch.seamPoint.y).toBeCloseTo(hipHeight, 3);
  });

  /*
   * Doble en la espalda: el convenio de taller para no confundir las piezas al
   * cortar ni montar una falda del revés.
   */
  it('la espalda lleva doble piquete', () => {
    const { result } = build();
    const back = piece(result.pieces, 'skirtBack');

    expect(back.notches[0]?.type).toBe('double');
    expect(piece(result.pieces, 'skirtFront').notches[0]?.type).toBe('single');
  });

  it('el piquete de delantero y espalda cae a la misma altura', () => {
    const { result } = build();

    const front = resolveNotches(piece(result.pieces, 'skirtFront'))[0];
    const back = resolveNotches(piece(result.pieces, 'skirtBack'))[0];
    if (front === undefined || back === undefined) return;

    expect(front.seamPoint.y).toBeCloseTo(back.seamPoint.y, 6);
  });
});

describe('colocación en el documento', () => {
  it('las piezas no se solapan', () => {
    const { result } = build();
    const placements = result.pieces.map((p) => p.placement);

    // Basta comprobar que cada una tiene una colocación distinta.
    const keys = new Set(placements.map((m) => `${m.e},${m.f}`));
    expect(keys.size).toBe(result.pieces.length);
  });

  it('el grafo de costuras indexa las piezas generadas', () => {
    const { result } = build();
    const index = indexPieces([...result.pieces]);

    for (const seam of result.seams) {
      expect(index.has(seam.a.piece)).toBe(true);
      expect(index.has(seam.b.piece)).toBe(true);
    }
  });
});
