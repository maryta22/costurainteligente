import { describe, expect, it } from 'vitest';

import { evaluateParameters } from '@core/parametric/evaluate';

import type { FitPreset } from '@domain/measurements/ease';
import { FIT_PRESETS, easeProfile } from '@domain/measurements/ease';
import { buildInputScope } from '@domain/measurements/scope';
import type { SizeCode } from '@domain/measurements/standard';
import { SIZE_CODES, standardMeasurements } from '@domain/measurements/standard';
import { BLOCK_PARAMETERS } from '@domain/pattern/blockParameters';
import { edgeLength, findEdge } from '@domain/pattern/edge';
import type { GarmentId } from '@domain/pattern/generators';
import { generateGarment } from '@domain/pattern/generators';
import { edgeId, pieceId } from '@domain/pattern/ids';
import { indexPieces, seamLengths } from '@domain/pattern/seam';
import { allowanceAddsMaterial } from '@domain/pattern/seamAllowance';
import type { PatternPiece } from '@domain/pattern/types';
import { describePieceIssue, validatePattern, validatePiece } from '@domain/pattern/validate';

function build(garment: GarmentId, size: SizeCode = 'M', fit: FitPreset = 'semi-fitted') {
  const evaluation = evaluateParameters(
    BLOCK_PARAMETERS,
    buildInputScope(standardMeasurements(size), easeProfile(fit)),
  );
  expect(evaluation.issues).toEqual([]);

  const result = generateGarment(garment, { values: evaluation.values, overrides: new Map() });
  expect(result).not.toBeNull();
  if (result === null) throw new Error('sin generador');

  return { result, values: evaluation.values };
}

const piece = (pieces: readonly PatternPiece[], id: string): PatternPiece => {
  const found = pieces.find((p) => p.id === pieceId(id));
  if (found === undefined) throw new Error(`falta la pieza ${id}`);
  return found;
};

const lengthOf = (pieces: readonly PatternPiece[], id: string, name: string): number => {
  const target = piece(pieces, id);
  const edge = findEdge(target, edgeId(id, name));
  return edge === undefined ? 0 : edgeLength(target, edge);
};

describe('estructura del patrón', () => {
  it('genera cuerpo, falda y manga para ambos lados', () => {
    const { result } = build('dress');

    expect(result.pieces.map((p) => p.id)).toEqual([
      'dressBackBodice',
      'dressBackSkirt',
      'dressFrontBodice',
      'dressFrontSkirt',
      'dressSleeve',
    ]);
    expect(result.missing).toEqual([]);
  });

  it('todas las piezas son válidas en todas las tallas', () => {
    for (const size of SIZE_CODES) {
      const { result } = build('dress', size);
      for (const target of result.pieces) {
        expect(validatePiece(target).map(describePieceIssue)).toEqual([]);
      }
    }
  });

  it('el patrón completo valida, con sus nueve costuras', () => {
    const { result } = build('dress');
    expect(result.seams).toHaveLength(9);

    const report = validatePattern([...result.pieces], [...result.seams]);
    expect(report.seamIssues).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('los márgenes añaden material en todas las piezas', () => {
    const { result } = build('dress');
    for (const target of result.pieces) {
      expect(allowanceAddsMaterial(target)).toBe(true);
    }
  });
});

describe('CRITERIO DE SALIDA — el vestido reutiliza los bloques', () => {
  /*
   * La comprobación es ARQUITECTÓNICA, y se hace midiendo en vez de contando
   * líneas: si el vestido reutiliza de verdad el bloque de cuerpo, su sisa,
   * su hombro y su escote tienen que salir IDÉNTICOS a los de la blusa para
   * las mismas medidas. Una reimplementación «equivalente» divergiría en algún
   * decimal, y aquí se exige igualdad a la millonésima de milímetro.
   */
  it('el cuerpo del vestido es el mismo bloque que el de la blusa', () => {
    for (const size of SIZE_CODES) {
      const blouse = build('blouse', size).result.pieces;
      const dress = build('dress', size).result.pieces;

      for (const [side, blouseId, dressId] of [
        ['delantero', 'blouseFront', 'dressFrontBodice'],
        ['espalda', 'blouseBack', 'dressBackBodice'],
      ] as const) {
        for (const edge of ['armhole', 'shoulder', 'neckline', 'side'] as const) {
          expect(
            lengthOf(dress, dressId, edge),
            `${side} · ${edge} en la talla ${size}`,
          ).toBeCloseTo(lengthOf(blouse, blouseId, edge), 6);
        }
      }
    }
  });

  /*
   * Y lo mismo por abajo: el bajo y el costado de la falda del vestido salen
   * del mismo bloque que la falda suelta.
   */
  it('la falda del vestido es el mismo bloque que la falda suelta', () => {
    for (const size of SIZE_CODES) {
      const skirt = build('skirt', size).result.pieces;
      const dress = build('dress', size).result.pieces;

      for (const [skirtId, dressId] of [
        ['skirtFront', 'dressFrontSkirt'],
        ['skirtBack', 'dressBackSkirt'],
      ] as const) {
        expect(lengthOf(dress, dressId, 'hem')).toBeCloseTo(lengthOf(skirt, skirtId, 'hem'), 6);
      }
    }
  });

  /*
   * La manga sale del mismo bloque y con el mismo casamiento: si la sisa del
   * vestido coincide con la de la blusa, su copa también debe coincidir.
   */
  it('la manga del vestido casa igual que la de la blusa', () => {
    const blouse = build('blouse').result.pieces;
    const dress = build('dress').result.pieces;

    for (const edge of ['capFront', 'capBack'] as const) {
      expect(lengthOf(dress, 'dressSleeve', edge)).toBeCloseTo(
        lengthOf(blouse, 'blouseSleeve', edge),
        6,
      );
    }
  });

  it('los tres generadores producen prendas distintas', () => {
    const ids = (garment: GarmentId): string[] =>
      build(garment).result.pieces.map((p) => String(p.id));

    expect(ids('skirt')).not.toEqual(ids('blouse'));
    expect(ids('dress')).not.toEqual(ids('blouse'));
    expect(ids('dress').length).toBeGreaterThan(ids('skirt').length);
  });
});

describe('la costura de talle casa', () => {
  /*
   * ES LO QUE HACE POSIBLE EL VESTIDO.
   *
   * El cuerpo y la falda se cosen por la cintura, así que sus dos líneas tienen
   * que ser LA MISMA: misma anchura, misma pinza y en la misma posición. Por eso
   * el vestido usa una única pinza por lado en vez de la del cuerpo y la de la
   * falda por separado.
   */
  it('cada tramo de cintura del cuerpo mide lo que el de la falda', () => {
    for (const size of SIZE_CODES) {
      for (const fit of Object.keys(FIT_PRESETS) as FitPreset[]) {
        const { result } = build('dress', size, fit);

        for (const side of ['Front', 'Back'] as const) {
          for (const part of ['waistInner', 'waistOuter'] as const) {
            expect(
              lengthOf(result.pieces, `dress${side}Bodice`, part),
              `${side} ${part} en ${size}/${fit}`,
            ).toBeCloseTo(lengthOf(result.pieces, `dress${side}Skirt`, part), 6);
          }
        }
      }
    }
  });

  it('las cuatro costuras de talle validan sin embebido', () => {
    const { result } = build('dress');
    const pieces = indexPieces([...result.pieces]);

    const waistSeams = result.seams.filter((seam) => seam.a.edge.includes('waist'));
    expect(waistSeams).toHaveLength(4);

    for (const seam of waistSeams) {
      const lengths = seamLengths(seam, pieces);
      expect(lengths?.difference).toBeCloseTo(0, 6);
    }
  });

  /*
   * Las pinzas de arriba y de abajo caen en la misma posición de la cintura, de
   * modo que forman una línea continua a través del talle. Es como se ve en un
   * vestido bien trazado, y es consecuencia de compartir la pinza.
   */
  it('las pinzas del cuerpo y de la falda están alineadas', () => {
    const { result } = build('dress');

    for (const side of ['Front', 'Back'] as const) {
      const bodice = result.draft.get(`dress${side}Bodice.dartLegCenterSide`);
      const skirt = result.draft.get(`dress${side}Skirt.dartLegCenterSide`);

      expect(bodice.x).toBeCloseTo(skirt.x, 6);
    }
  });

  it('el contorno de cintura casa con la medida', () => {
    for (const size of SIZE_CODES) {
      const { result, values } = build('dress', size);

      const waistOf = (id: string): number =>
        lengthOf(result.pieces, id, 'waistInner') + lengthOf(result.pieces, id, 'waistOuter');

      const measured = 2 * (waistOf('dressFrontBodice') + waistOf('dressBackBodice'));
      expect(Math.abs(measured - (values.get('finishedWaist') ?? 0))).toBeLessThan(1);
    }
  });
});

describe('proporciones de la prenda', () => {
  it('el contorno de pecho casa con la medida', () => {
    const { result, values } = build('dress');

    const front = result.draft.get('dressFrontBodice.underarm');
    const back = result.draft.get('dressBackBodice.underarm');

    expect(2 * (front.x + back.x)).toBeCloseTo(values.get('finishedBust') ?? 0, 6);
  });

  it('el contorno de cadera casa con la medida', () => {
    const { result, values } = build('dress');
    const hipQuarter = values.get('hipQuarter') ?? 0;

    expect(lengthOf(result.pieces, 'dressFrontSkirt', 'hem')).toBeCloseTo(hipQuarter, 6);
    expect(4 * hipQuarter).toBeCloseTo(values.get('finishedHip') ?? 0, 6);
  });

  it('el centro delantero va al doblez y el de espalda lleva costura en la falda', () => {
    const { result } = build('dress');

    const front = findEdge(
      piece(result.pieces, 'dressFrontSkirt'),
      edgeId('dressFrontSkirt', 'center-front'),
    );
    const back = findEdge(
      piece(result.pieces, 'dressBackSkirt'),
      edgeId('dressBackSkirt', 'center-back'),
    );

    expect(front?.onFold).toBe(true);
    expect(back?.onFold).toBe(false);
  });

  /*
   * La cintura del cuerpo del vestido lleva un margen estrecho porque se cose a
   * la falda; en la blusa es un bajo que se dobla y lleva mucho más.
   */
  it('la cintura del vestido lleva margen de costura, no de bajo', () => {
    const dress = build('dress').result.pieces;
    const blouse = build('blouse').result.pieces;

    const allowanceOf = (pieces: readonly PatternPiece[], id: string): number =>
      findEdge(piece(pieces, id), edgeId(id, 'waistInner'))?.seamAllowance ?? 0;

    expect(allowanceOf(dress, 'dressFrontBodice')).toBeLessThan(
      allowanceOf(blouse, 'blouseFront'),
    );
  });
});

describe('regeneración', () => {
  it('subir de talla agranda cuerpo, falda y manga a la vez', () => {
    const small = build('dress', 'XS').result.pieces;
    const large = build('dress', 'XL').result.pieces;

    expect(lengthOf(large, 'dressFrontBodice', 'armhole')).toBeGreaterThan(
      lengthOf(small, 'dressFrontBodice', 'armhole'),
    );
    expect(lengthOf(large, 'dressFrontSkirt', 'hem')).toBeGreaterThan(
      lengthOf(small, 'dressFrontSkirt', 'hem'),
    );
    expect(lengthOf(large, 'dressSleeve', 'capFront')).toBeGreaterThan(
      lengthOf(small, 'dressSleeve', 'capFront'),
    );
  });

  it('la costura de talle sigue casando al cambiar de talla', () => {
    for (const size of SIZE_CODES) {
      const { result } = build('dress', size);
      expect(
        lengthOf(result.pieces, 'dressFrontBodice', 'waistOuter'),
      ).toBeCloseTo(lengthOf(result.pieces, 'dressFrontSkirt', 'waistOuter'), 6);
    }
  });
});
