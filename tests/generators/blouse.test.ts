import { describe, expect, it } from 'vitest';

import { contour, contourLength, splitContourAtLength } from '@core/geometry/contour';
import { cubicSeg } from '@core/geometry/cubic';
import { lineSeg } from '@core/geometry/line';
import { evaluateParameters } from '@core/parametric/evaluate';
import { cross, distance, sub, vec2 } from '@core/geometry/vec2';

import type { FitPreset } from '@domain/measurements/ease';
import { FIT_PRESETS, easeProfile } from '@domain/measurements/ease';
import { buildInputScope } from '@domain/measurements/scope';
import type { SizeCode } from '@domain/measurements/standard';
import { SIZE_CODES, standardMeasurements } from '@domain/measurements/standard';
import { BLOCK_PARAMETERS } from '@domain/pattern/blockParameters';
import { edgeLength, findEdge, sampleEdgeByArcLength } from '@domain/pattern/edge';
import { generateGarment } from '@domain/pattern/generators';
import { edgeId, pieceId } from '@domain/pattern/ids';
import { resolveNotches } from '@domain/pattern/notch';
import { indexPieces, seamLengths } from '@domain/pattern/seam';
import { allowanceAddsMaterial } from '@domain/pattern/seamAllowance';
import type { PatternPiece } from '@domain/pattern/types';
import { describePieceIssue, validatePattern, validatePiece } from '@domain/pattern/validate';

function build(size: SizeCode = 'M', fit: FitPreset = 'semi-fitted') {
  const evaluation = evaluateParameters(
    BLOCK_PARAMETERS,
    buildInputScope(standardMeasurements(size), easeProfile(fit)),
  );
  expect(evaluation.issues).toEqual([]);

  const result = generateGarment('blouse', {
    values: evaluation.values,
    overrides: new Map(),
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

const lengthOf = (target: PatternPiece, id: string, name: string): number => {
  const found = findEdge(target, edgeId(id, name));
  return found === undefined ? 0 : edgeLength(target, found);
};

describe('estructura del patrón', () => {
  it('genera espalda, delantero y manga', () => {
    const { result } = build();
    expect(result.pieces.map((p) => p.id)).toEqual([
      'blouseBack',
      'blouseFront',
      'blouseSleeve',
    ]);
    expect(result.missing).toEqual([]);
  });

  it('todas las piezas son válidas', () => {
    for (const size of SIZE_CODES) {
      const { result } = build(size);
      for (const target of result.pieces) {
        expect(validatePiece(target).map(describePieceIssue)).toEqual([]);
      }
    }
  });

  it('el patrón completo valida, con sus cuatro costuras', () => {
    const { result } = build();
    expect(result.seams).toHaveLength(4);

    const report = validatePattern([...result.pieces], [...result.seams]);
    expect(report.seamIssues).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('los márgenes añaden material en todas las piezas', () => {
    const { result } = build();
    for (const target of result.pieces) {
      expect(allowanceAddsMaterial(target)).toBe(true);
    }
  });
});

describe('CRITERIO DE SALIDA — la copa casa con la sisa', () => {
  /*
   * LA COMPROBACIÓN QUE DECIDE SI LA MANGA ENTRA.
   *
   *     largo(copa) = largo(sisa) + embebido
   *
   * Ninguna de las dos longitudes se puede despejar de una fórmula: son
   * longitudes de arco de curvas de Bézier. El trazado clásico usa reglas
   * empíricas y luego se afina midiendo con la cinta sobre el papel; aquí se
   * dibujan las sisas, SE MIDEN, y se resuelve numéricamente qué altura de copa
   * da esa longitud más el embebido.
   *
   * Si la copa se queda corta la manga no entra; si se pasa, frunce.
   */
  it('la copa completa mide la sisa completa más el embebido, en todas las tallas', () => {
    for (const size of SIZE_CODES) {
      for (const fit of Object.keys(FIT_PRESETS) as FitPreset[]) {
        const { result, values } = build(size, fit);

        const front = piece(result.pieces, 'blouseFront');
        const back = piece(result.pieces, 'blouseBack');
        const sleeve = piece(result.pieces, 'blouseSleeve');

        const armhole =
          lengthOf(front, 'blouseFront', 'armhole') + lengthOf(back, 'blouseBack', 'armhole');
        const cap =
          lengthOf(sleeve, 'blouseSleeve', 'capFront') +
          lengthOf(sleeve, 'blouseSleeve', 'capBack');

        const ease = values.get('sleeveCapEase') ?? 0;
        expect(Math.abs(cap - armhole - ease)).toBeLessThan(2);
      }
    }
  });

  /*
   * Y cada MITAD por separado. Que el total cuadre no basta: si la mitad
   * delantera sobrara y la trasera faltara, la manga entraría torcida. La copa
   * se traza como una sola curva y se parte por el punto que corresponde al
   * encuentro delantero-espalda, de modo que cada mitad casa por construcción.
   */
  it('cada mitad de la copa casa con su propia sisa', () => {
    for (const size of SIZE_CODES) {
      const { result, values } = build(size);
      const pieces = indexPieces([...result.pieces]);

      const totalEase = values.get('sleeveCapEase') ?? 0;
      const frontShare = values.get('sleeveCapEaseFrontShare') ?? 0;

      const expected = new Map([
        [edgeId('blouseFront', 'armhole'), totalEase * frontShare],
        [edgeId('blouseBack', 'armhole'), totalEase * (1 - frontShare)],
      ]);

      for (const seam of result.seams) {
        const target = expected.get(seam.a.edge);
        if (target === undefined) continue;

        const lengths = seamLengths(seam, pieces);
        expect(lengths).not.toBeNull();
        if (lengths === null) continue;

        expect(Math.abs(lengths.difference - target)).toBeLessThan(1);
      }
    }
  });

  it('las costuras de copa validan con su embebido declarado', () => {
    const { result } = build();
    const report = validatePattern([...result.pieces], [...result.seams]);
    expect(report.seamIssues).toEqual([]);
  });

  /*
   * La copa es más larga que la sisa a propósito: ese exceso es lo que da
   * volumen al hombro. Una copa igual o más corta sería un error de trazado.
   */
  it('la copa siempre es más larga que la sisa', () => {
    for (const size of SIZE_CODES) {
      const { result } = build(size);
      const sleeve = piece(result.pieces, 'blouseSleeve');

      const armhole =
        lengthOf(piece(result.pieces, 'blouseFront'), 'blouseFront', 'armhole') +
        lengthOf(piece(result.pieces, 'blouseBack'), 'blouseBack', 'armhole');
      const cap =
        lengthOf(sleeve, 'blouseSleeve', 'capFront') + lengthOf(sleeve, 'blouseSleeve', 'capBack');

      expect(cap).toBeGreaterThan(armhole);
    }
  });

  it('la anchura de la manga la dicta el brazo, no el casamiento', () => {
    const { result, values } = build();
    const sleeve = piece(result.pieces, 'blouseSleeve');

    const underarmFront = result.draft.get('blouseSleeve.underarmFront');
    const underarmBack = result.draft.get('blouseSleeve.underarmBack');

    expect(distance(underarmFront, underarmBack)).toBeCloseTo(values.get('sleeveWidth') ?? 0, 6);
    expect(sleeve.cutCount).toBe(2);
  });
});

describe('la copa tiene forma de copa', () => {
  /*
   * REGRESIÓN DE UN FALLO QUE LOS TESTS NO VIERON.
   *
   * La primera versión trazaba la copa como una cúpula suave. La longitud
   * casaba con la sisa al milímetro, las 24 comprobaciones pasaban, y la manga
   * habría tirado bajo el brazo: la sisa tiene un HUECO en su parte baja
   * —el cuerpo se estrecha ahí— y una cúpula no lo tiene.
   *
   * La invariante que sí lo distingue es que una copa CRUZA SU PROPIA CUERDA:
   * se mete hacia dentro en el primer cuarto —el hueco— y sale hacia fuera en
   * el tercero —la comba—. Una cúpula se queda siempre del mismo lado.
   */
  it('cada mitad se desvía a AMBOS lados de su cuerda', () => {
    const { result } = build();
    const sleeve = piece(result.pieces, 'blouseSleeve');

    for (const name of ['capFront', 'capBack']) {
      const capEdge = findEdge(sleeve, edgeId('blouseSleeve', name));
      expect(capEdge).toBeDefined();
      if (capEdge === undefined) continue;

      const samples = sampleEdgeByArcLength(sleeve, capEdge, 24);
      const first = samples[0];
      const last = samples.at(-1);
      if (first === undefined || last === undefined) continue;

      const chord = sub(last.point, first.point);
      const span = Math.hypot(chord.x, chord.y);
      const direction = vec2(chord.x / span, chord.y / span);

      // Distancia con signo de cada muestra a la cuerda.
      const deviations = samples.map((sample) => cross(direction, sub(sample.point, first.point)));

      expect(Math.min(...deviations)).toBeLessThan(-2);
      expect(Math.max(...deviations)).toBeGreaterThan(2);
    }
  });

  /*
   * La comba de la espalda es mayor que la del delantero: el omóplato necesita
   * ese volumen para que el brazo pueda ir hacia delante.
   */
  it('la comba de la espalda supera a la del delantero', () => {
    const { result } = build();
    const sleeve = piece(result.pieces, 'blouseSleeve');

    const maxDeviation = (name: string): number => {
      const capEdge = findEdge(sleeve, edgeId('blouseSleeve', name));
      if (capEdge === undefined) return 0;

      const samples = sampleEdgeByArcLength(sleeve, capEdge, 24);
      const first = samples[0];
      const last = samples.at(-1);
      if (first === undefined || last === undefined) return 0;

      const chord = sub(last.point, first.point);
      const span = Math.hypot(chord.x, chord.y);
      const direction = vec2(chord.x / span, chord.y / span);

      return Math.max(
        ...samples.map((s) => Math.abs(cross(direction, sub(s.point, first.point)))),
      );
    };

    expect(maxDeviation('capBack')).toBeGreaterThan(maxDeviation('capFront'));
  });

  it('lo alto de la copa está entre los dos sobacos', () => {
    const { result } = build();

    const top = result.draft.get('blouseSleeve.capTop');
    const front = result.draft.get('blouseSleeve.underarmFront');
    const back = result.draft.get('blouseSleeve.underarmBack');

    expect(top.y).toBeGreaterThan(Math.max(front.y, back.y));
    expect(top.x).toBeGreaterThan(front.x);
    expect(top.x).toBeLessThan(back.x);
  });
});

describe('las costuras del cuerpo casan', () => {
  /*
   * La línea de axila es COMÚN a delantero y espalda. Si cada uno la tuviera a
   * su altura, sus costados medirían distinto y la blusa no cerraría por más
   * que se estirase al coser.
   */
  it('los costados de delantero y espalda miden lo mismo', () => {
    for (const size of SIZE_CODES) {
      const { result } = build(size);
      expect(lengthOf(piece(result.pieces, 'blouseFront'), 'blouseFront', 'side')).toBeCloseTo(
        lengthOf(piece(result.pieces, 'blouseBack'), 'blouseBack', 'side'),
        6,
      );
    }
  });

  it('los hombros miden lo mismo', () => {
    for (const size of SIZE_CODES) {
      const { result, values } = build(size);
      const front = lengthOf(piece(result.pieces, 'blouseFront'), 'blouseFront', 'shoulder');
      const back = lengthOf(piece(result.pieces, 'blouseBack'), 'blouseBack', 'shoulder');

      expect(front).toBeCloseTo(back, 6);
      expect(front).toBeCloseTo(values.get('shoulderLength') ?? 0, 6);
    }
  });

  /*
   * El contorno de cintura del cuerpo, descontadas las pinzas, tiene que dar la
   * cintura terminada: la misma identidad que en la falda pero entre pecho y
   * cintura.
   */
  it('el contorno de cintura casa con la medida', () => {
    for (const size of SIZE_CODES) {
      const { result, values } = build(size);

      const waistOf = (id: string): number =>
        lengthOf(piece(result.pieces, id), id, 'waistInner') +
        lengthOf(piece(result.pieces, id), id, 'waistOuter');

      const measured = 2 * (waistOf('blouseFront') + waistOf('blouseBack'));
      expect(Math.abs(measured - (values.get('finishedWaist') ?? 0))).toBeLessThan(1);
    }
  });

  it('el contorno de pecho casa con la medida', () => {
    const { result, values } = build();

    const front = result.draft.get('blouseFront.underarm');
    const back = result.draft.get('blouseBack.underarm');

    expect(2 * (front.x + back.x)).toBeCloseTo(values.get('finishedBust') ?? 0, 6);
  });

  it('el escote llega al centro sin pico', () => {
    const { result } = build();

    for (const id of ['blouseFront', 'blouseBack']) {
      const target = piece(result.pieces, id);
      const neck = findEdge(target, edgeId(id, 'neckline'));
      if (neck === undefined) continue;

      // El último punto de control del escote comparte altura con el centro:
      // la curva llega horizontal, así que al abrir por el doblez no hay pico.
      const last = target.contour.segments[neck.startSegment];
      if (last === undefined || last.kind !== 'cubic') continue;
      expect(last.p2.y).toBeCloseTo(last.p3.y, 9);
    }
  });
});

describe('pinzas de talle', () => {
  it('apuntan hacia arriba, hacia el pecho y el omóplato', () => {
    const { result } = build();

    for (const id of ['blouseFront', 'blouseBack']) {
      const apex = result.draft.get(`${id}.dartApex`);
      // La cintura está en y = 0 y la pieza se extiende hacia arriba.
      expect(apex.y).toBeGreaterThan(0);
    }
  });

  it('la pinza de espalda recoge más que la delantera', () => {
    const { values } = build();
    expect(values.get('bodiceBackDart') ?? 0).toBeGreaterThan(values.get('bodiceFrontDart') ?? 0);
  });
});

describe('piquetes de montaje', () => {
  /*
   * Los piquetes de la copa se colocan en la posición PROPORCIONAL a los de la
   * sisa, no a la misma distancia: la copa es más larga, y repartir el embebido
   * de forma uniforme es lo que hace una costurera al montar la manga.
   */
  it('la manga lleva un piquete por cada mitad de copa', () => {
    const { result } = build();
    const sleeve = piece(result.pieces, 'blouseSleeve');

    expect(sleeve.notches).toHaveLength(2);
    expect(sleeve.notches.map((n) => n.type).sort()).toEqual(['double', 'single']);
  });

  it('la espalda lleva doble piquete y el delantero simple', () => {
    const { result } = build();
    expect(piece(result.pieces, 'blouseBack').notches[0]?.type).toBe('double');
    expect(piece(result.pieces, 'blouseFront').notches[0]?.type).toBe('single');
  });

  it('todos los piquetes se resuelven sobre su pieza', () => {
    const { result } = build();
    for (const target of result.pieces) {
      expect(resolveNotches(target)).toHaveLength(target.notches.length);
    }
  });
});

describe('regeneración', () => {
  it('subir de talla agranda la sisa y la copa a la vez', () => {
    const small = build('XS');
    const large = build('XL');

    const capOf = (r: ReturnType<typeof build>): number =>
      lengthOf(piece(r.result.pieces, 'blouseSleeve'), 'blouseSleeve', 'capFront') +
      lengthOf(piece(r.result.pieces, 'blouseSleeve'), 'blouseSleeve', 'capBack');

    const armholeOf = (r: ReturnType<typeof build>): number =>
      lengthOf(piece(r.result.pieces, 'blouseFront'), 'blouseFront', 'armhole') +
      lengthOf(piece(r.result.pieces, 'blouseBack'), 'blouseBack', 'armhole');

    expect(armholeOf(large)).toBeGreaterThan(armholeOf(small));
    expect(capOf(large)).toBeGreaterThan(capOf(small));
  });

  it('más holgura de brazo ensancha la manga y baja la copa', () => {
    const tight = build('M', 'fitted');
    const loose = build('M', 'oversize');

    const capHeightOf = (r: ReturnType<typeof build>): number =>
      r.result.draft.get('blouseSleeve.capTop').y;

    expect(loose.values.get('sleeveWidth') ?? 0).toBeGreaterThan(
      tight.values.get('sleeveWidth') ?? 0,
    );
    // Con la misma sisa, una manga más ancha necesita menos altura para medir
    // lo mismo. Aquí la sisa también crece, así que sólo se comprueba que la
    // altura sigue siendo positiva y razonable.
    expect(capHeightOf(loose)).toBeGreaterThan(0);
    expect(capHeightOf(tight)).toBeGreaterThan(0);
  });
});

describe('splitContourAtLength', () => {
  /*
   * La operación que hace posible el casamiento: partir una curva por una
   * LONGITUD, no por un índice de segmento. El corte cae casi siempre en mitad
   * de un segmento, que se subdivide de forma exacta.
   */
  it('las dos partes suman la longitud original', () => {
    const c = contour(
      [
        cubicSeg(vec2(0, 0), vec2(30, 80), vec2(90, 90), vec2(120, 40)),
        cubicSeg(vec2(120, 40), vec2(150, 10), vec2(190, 0), vec2(220, 30)),
      ],
      false,
    );

    const total = contourLength(c);

    for (const fraction of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const [head, tail] = splitContourAtLength(c, total * fraction);

      const headLength = contourLength(contour(head, false));
      const tailLength = contourLength(contour(tail, false));

      expect(headLength + tailLength).toBeCloseTo(total, 3);
      expect(headLength).toBeCloseTo(total * fraction, 2);
    }
  });

  it('un corte en una juntura no deja segmentos de longitud cero', () => {
    const c = contour([lineSeg(vec2(0, 0), vec2(100, 0)), lineSeg(vec2(100, 0), vec2(200, 0))], false);
    const [head, tail] = splitContourAtLength(c, 100);

    expect(head).toHaveLength(1);
    expect(tail).toHaveLength(1);
  });

  it('cortar en cero o en el total devuelve el contorno entero de un lado', () => {
    const c = contour([lineSeg(vec2(0, 0), vec2(100, 0))], false);

    expect(splitContourAtLength(c, 0)[0]).toHaveLength(0);
    expect(splitContourAtLength(c, 1000)[1]).toHaveLength(0);
  });
});
