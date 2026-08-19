import { translation } from '@core/geometry/mat3';
import { vec2 } from '@core/geometry/vec2';

import { bodiceUpperBlock } from '../blocks/bodice';
import type { CenterRole } from '../blocks/panels';
import { bodicePanel } from '../blocks/panels';
import { BACK_ARMHOLE_NOTCH, FRONT_ARMHOLE_NOTCH, sleeveBlock } from '../blocks/sleeve';
import { waistBlock } from '../blocks/waist';
import type { DraftContext } from '../construction/draft';
import { Draft as DraftBuilder } from '../construction/draft';
import { edgeLength, findEdge } from '../edge';
import { edgeId, pieceId } from '../ids';
import { createSeam, endpoint } from '../seam';
import type { NotchType, PatternPiece, Seam } from '../types';

import type { GarmentGenerator, GeneratedGarment } from './types';

const PIECE_GAP = 140;

interface BodiceSpec {
  readonly key: 'front' | 'back';
  readonly name: string;
  readonly widthQuarter: number;
  readonly shoulderY: number;
  readonly neckWidth: number;
  readonly neckDrop: number;
  readonly dartIntake: number;
  readonly dartPosition: number;
  readonly centerRole: CenterRole;
  readonly notchType: NotchType;
  readonly notchFraction: number;
}

/**
 * BLUSA BÁSICA CON MANGA MONTADA.
 *
 * El generador compone tres bloques: la línea de cintura, la mitad superior del
 * cuerpo y la manga. Lo único propio de la blusa es que la cintura es un BAJO
 * —lleva margen ancho porque se dobla— y que no hay nada por debajo.
 *
 * El casamiento copa↔sisa no vive aquí sino en `sleeveBlock`: este generador se
 * limita a medir las sisas que acaba de componer y pasárselas.
 */
function generateBlouse(context: DraftContext): GeneratedGarment {
  const draft = new DraftBuilder(context);
  const notes: string[] = [];

  const neckWidth = draft.value('neckWidth');

  const specs: BodiceSpec[] = [
    {
      key: 'back',
      name: 'Espalda de blusa',
      widthQuarter: draft.value('backWidthQuarter'),
      shoulderY: draft.value('napeToWaist') + draft.value('backNeckRise'),
      neckWidth,
      neckDrop: draft.value('backNeckRise'),
      dartIntake: draft.value('bodiceBackDart'),
      dartPosition: draft.value('bodiceBackDartPosition'),
      centerRole: 'center-back',
      notchType: 'double',
      notchFraction: BACK_ARMHOLE_NOTCH,
    },
    {
      key: 'front',
      name: 'Delantero de blusa',
      widthQuarter: draft.value('frontWidthQuarter'),
      shoulderY: draft.value('frontWaistLength'),
      neckWidth: neckWidth + draft.value('frontNeckWidthExtra'),
      neckDrop: draft.value('frontNeckDrop'),
      dartIntake: draft.value('bodiceFrontDart'),
      dartPosition: draft.value('bodiceFrontDartPosition'),
      centerRole: 'center-front',
      notchType: 'single',
      notchFraction: FRONT_ARMHOLE_NOTCH,
    },
  ];

  const pieces: PatternPiece[] = specs.map((spec, index) =>
    buildBodicePiece(draft, spec, index * (draft.value('bustQuarter') + PIECE_GAP)),
  );

  const [back, front] = pieces;
  if (back === undefined || front === undefined) return { pieces, seams: [], draft, notes };

  /*
   * SE MIDE LO COMPUESTO. La longitud de la sisa no es un parámetro: sale de la
   * curva que acaba de trazarse, y es la entrada del cálculo de la manga.
   */
  const sleeve = sleeveBlock({
    id: 'blouseSleeve',
    name: 'Manga',
    width: draft.value('sleeveWidth'),
    wristWidth: draft.value('sleeveWristWidth'),
    armLength: draft.value('armLength'),
    frontArmhole: armholeLength(front, 'blouseFront'),
    backArmhole: armholeLength(back, 'blouseBack'),
    capEase: draft.value('sleeveCapEase'),
    frontEaseShare: draft.value('sleeveCapEaseFrontShare'),
    placement: translation(0, -(draft.value('armLength') + PIECE_GAP * 2)),
  });

  for (const [name, point] of Object.entries(sleeve.points)) {
    draft.point(`blouseSleeve.${name}`, point);
  }
  notes.push(...sleeve.warnings);

  pieces.push(sleeve.piece);

  const totalEase = draft.value('sleeveCapEase');
  const frontEase = totalEase * draft.value('sleeveCapEaseFrontShare');

  const seams: Seam[] = [
    createSeam(
      endpoint(pieceId('blouseFront'), edgeId('blouseFront', 'shoulder')),
      endpoint(pieceId('blouseBack'), edgeId('blouseBack', 'shoulder')),
    ),
    createSeam(
      endpoint(pieceId('blouseFront'), edgeId('blouseFront', 'side')),
      endpoint(pieceId('blouseBack'), edgeId('blouseBack', 'side')),
    ),
    /*
     * La copa va como segundo extremo porque el embebido se define como «cuánto
     * mide de más el segundo»: así el valor declarado es positivo y coincide con
     * lo que el patronista llama embebido.
     */
    createSeam(
      endpoint(pieceId('blouseFront'), edgeId('blouseFront', 'armhole')),
      endpoint(pieceId('blouseSleeve'), edgeId('blouseSleeve', 'capFront'), true),
      frontEase,
    ),
    createSeam(
      endpoint(pieceId('blouseBack'), edgeId('blouseBack', 'armhole')),
      endpoint(pieceId('blouseSleeve'), edgeId('blouseSleeve', 'capBack')),
      totalEase - frontEase,
    ),
  ];

  return { pieces, seams, draft, notes };
}

function buildBodicePiece(
  draft: DraftBuilder,
  spec: BodiceSpec,
  offsetX: number,
): PatternPiece {
  const id = `blouse${spec.key === 'front' ? 'Front' : 'Back'}`;
  const at = (name: string): string => `${id}.${name}`;

  const centerWaist = draft.point(at('centerWaist'), vec2(0, 0));

  /*
   * Un cuerpo parte del pecho, no de la cintura: el costado está donde lo pone
   * la axila, y la cintura llega hasta ahí. La anchura es un dato.
   *
   * La línea es HORIZONTAL —sin subida— y eso la hace exacta: su longitud
   * coincide con su proyección, de modo que el contorno de cintura sale al
   * milímetro sin resolver nada. Y como delantero y espalda comparten la misma
   * entrada de costado, sus costados salen idénticos y casan al coser.
   */
  const waist = waistBlock({
    center: centerWaist,
    extent: { kind: 'run', run: spec.widthQuarter - draft.value('bodiceSideIntake') },
    rise: 0,
    dartIntake: spec.dartIntake,
    dartPosition: spec.dartPosition,
    dartLength: draft.value('bodiceDartLength'),
    // En un cuerpo el interior queda por ENCIMA de la cintura.
    dartSide: 'left',
  });

  const waistSide = draft.point(at('waistSide'), waist.side);
  draft.point(at('dartApex'), waist.apex);
  draft.point(at('dartLegCenterSide'), waist.legCenterSide);
  draft.point(at('dartLegSideSide'), waist.legSideSide);

  const upper = bodiceUpperBlock({
    waistSide,
    widthQuarter: spec.widthQuarter,
    underarmLevel: draft.value('underarmLevel'),
    neckWidth: spec.neckWidth,
    shoulderY: spec.shoulderY,
    neckDrop: spec.neckDrop,
    shoulderLength: draft.value('shoulderLength'),
    shoulderSlope: draft.value('shoulderSlope'),
  });

  draft.point(at('underarm'), upper.underarm);
  draft.point(at('shoulderTip'), upper.shoulderTip);
  draft.point(at('shoulderNeck'), upper.shoulderNeck);
  draft.point(at('centerNeck'), upper.centerNeck);

  return bodicePanel({
    id,
    name: spec.name,
    centerRole: spec.centerRole,
    centerOnFold: true,
    waist,
    upper,
    centerWaist,
    armholeNotch: { fraction: spec.notchFraction, type: spec.notchType },
    placement: translation(offsetX, 0),
    cutLabel: `${spec.name.toUpperCase()} · 1 al doblez`,
    // En una blusa la cintura es un bajo: se dobla, así que lleva margen ancho.
    waistAllowance: 30,
  });
}

const armholeLength = (piece: PatternPiece, id: string): number => {
  const edge = findEdge(piece, edgeId(id, 'armhole'));
  return edge === undefined ? 0 : edgeLength(piece, edge);
};

export const blouseGenerator: GarmentGenerator = {
  id: 'blouse',
  name: 'Blusa básica con manga',
  requires: [
    'underarmLevel',
    'bodiceSideIntake',
    'bodiceFrontDart',
    'bodiceBackDart',
    'bodiceDartLength',
    'frontWidthQuarter',
    'backWidthQuarter',
    'napeToWaist',
    'frontWaistLength',
    'neckWidth',
    'frontNeckDrop',
    'backNeckRise',
    'shoulderLength',
    'shoulderSlope',
    'sleeveWidth',
    'sleeveWristWidth',
    'sleeveCapEase',
    'armLength',
  ],
  generate: generateBlouse,
};
