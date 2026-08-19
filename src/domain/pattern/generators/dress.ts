import { translation } from '@core/geometry/mat3';
import { vec2 } from '@core/geometry/vec2';

import { bodiceUpperBlock } from '../blocks/bodice';
import type { CenterRole } from '../blocks/panels';
import { bodicePanel, skirtPanel } from '../blocks/panels';
import { BACK_ARMHOLE_NOTCH, FRONT_ARMHOLE_NOTCH, sleeveBlock } from '../blocks/sleeve';
import { skirtLowerBlock } from '../blocks/skirtBody';
import type { WaistBlock } from '../blocks/waist';
import { waistBlock } from '../blocks/waist';
import type { DraftContext } from '../construction/draft';
import { Draft as DraftBuilder } from '../construction/draft';
import { edgeLength, findEdge } from '../edge';
import { edgeId, pieceId } from '../ids';
import { createSeam, endpoint } from '../seam';
import type { NotchType, PatternPiece, Seam } from '../types';

import type { GarmentGenerator, GeneratedGarment } from './types';

const PIECE_GAP = 160;

interface SideSpec {
  readonly key: 'front' | 'back';
  readonly label: string;
  readonly widthQuarter: number;
  readonly shoulderY: number;
  readonly neckWidth: number;
  readonly neckDrop: number;
  readonly dartIntake: number;
  readonly bodiceDartPosition: number;
  readonly skirtDartPosition: number;
  readonly skirtDartLength: number;
  readonly centerRole: CenterRole;
  readonly notchType: NotchType;
  readonly armholeNotchFraction: number;
}

/**
 * VESTIDO BÁSICO — cuerpo y falda unidos por una costura de talle.
 *
 * ── Qué demuestra este generador ───────────────────────────────────────────
 *
 * No traza nada nuevo. Compone exactamente los mismos bloques que la falda y la
 * blusa: `waistBlock`, `bodiceUpperBlock`, `skirtLowerBlock`, `bodicePanel`,
 * `skirtPanel` y `sleeveBlock`. Si hubiera que duplicar geometría para hacer un
 * vestido, la descomposición en bloques estaría mal hecha.
 *
 * ── La condición que hace posible la costura de talle ──────────────────────
 *
 * El cuerpo y la falda se cosen por la cintura, así que sus dos líneas de
 * cintura tienen que ser LA MISMA: misma anchura, misma pinza y en la misma
 * posición. Por eso el vestido usa una única pinza por lado —no la del cuerpo
 * y la de la falda por separado— y pasa la misma `WaistBlock` a los dos
 * paneles.
 *
 * Es también lo que alinea verticalmente las pinzas de arriba y de abajo, que
 * es como se ve en un vestido bien trazado: forman una línea continua a través
 * del talle.
 */
function generateDress(context: DraftContext): GeneratedGarment {
  const draft = new DraftBuilder(context);
  const notes: string[] = [];

  const neckWidth = draft.value('neckWidth');
  const sideIntake = draft.value('bodiceSideIntake');

  const specs: SideSpec[] = [
    {
      key: 'back',
      label: 'Espalda',
      widthQuarter: draft.value('backWidthQuarter'),
      shoulderY: draft.value('napeToWaist') + draft.value('backNeckRise'),
      neckWidth,
      neckDrop: draft.value('backNeckRise'),
      dartIntake: draft.value('dressBackDart'),
      bodiceDartPosition: draft.value('bodiceBackDartPosition'),
      skirtDartPosition: draft.value('bodiceBackDartPosition'),
      skirtDartLength: draft.value('skirtBackDartLength'),
      centerRole: 'center-back',
      notchType: 'double',
      armholeNotchFraction: BACK_ARMHOLE_NOTCH,
    },
    {
      key: 'front',
      label: 'Delantero',
      widthQuarter: draft.value('frontWidthQuarter'),
      shoulderY: draft.value('frontWaistLength'),
      neckWidth: neckWidth + draft.value('frontNeckWidthExtra'),
      neckDrop: draft.value('frontNeckDrop'),
      dartIntake: draft.value('dressFrontDart'),
      bodiceDartPosition: draft.value('bodiceFrontDartPosition'),
      skirtDartPosition: draft.value('bodiceFrontDartPosition'),
      skirtDartLength: draft.value('skirtFrontDartLength'),
      centerRole: 'center-front',
      notchType: 'single',
      armholeNotchFraction: FRONT_ARMHOLE_NOTCH,
    },
  ];

  const pieces: PatternPiece[] = [];
  const bodices: PatternPiece[] = [];

  specs.forEach((spec, index) => {
    const offsetX = index * (draft.value('bustQuarter') + PIECE_GAP);
    const run = spec.widthQuarter - sideIntake;

    const bodice = buildBodice(draft, spec, run, offsetX);
    bodices.push(bodice);
    pieces.push(bodice);
    pieces.push(buildSkirt(draft, spec, run, offsetX));
  });

  const [back, front] = bodices;
  if (back === undefined || front === undefined) {
    return { pieces, seams: [], draft, notes };
  }

  const sleeve = sleeveBlock({
    id: 'dressSleeve',
    name: 'Manga',
    width: draft.value('sleeveWidth'),
    wristWidth: draft.value('sleeveWristWidth'),
    armLength: draft.value('armLength'),
    frontArmhole: armholeLength(front, 'dressFrontBodice'),
    backArmhole: armholeLength(back, 'dressBackBodice'),
    capEase: draft.value('sleeveCapEase'),
    frontEaseShare: draft.value('sleeveCapEaseFrontShare'),
    placement: translation(0, -(draft.value('armLength') + PIECE_GAP * 2)),
  });

  for (const [name, point] of Object.entries(sleeve.points)) {
    draft.point(`dressSleeve.${name}`, point);
  }
  notes.push(...sleeve.warnings);
  pieces.push(sleeve.piece);

  return { pieces, seams: buildSeams(draft), draft, notes };
}

function buildBodice(
  draft: DraftBuilder,
  spec: SideSpec,
  run: number,
  offsetX: number,
): PatternPiece {
  const id = `dress${spec.key === 'front' ? 'Front' : 'Back'}Bodice`;
  const at = (name: string): string => `${id}.${name}`;

  const centerWaist = draft.point(at('centerWaist'), vec2(0, 0));

  const waist = makeWaist({
    center: centerWaist,
    run,
    intake: spec.dartIntake,
    position: spec.bodiceDartPosition,
    length: draft.value('bodiceDartLength'),
    side: 'left',
  });

  const waistSide = registerWaist(draft, at, waist);

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
  draft.point(at('centerNeck'), upper.centerNeck);

  return bodicePanel({
    id,
    name: `${spec.label} · cuerpo`,
    centerRole: spec.centerRole,
    centerOnFold: true,
    waist,
    upper,
    centerWaist,
    armholeNotch: { fraction: spec.armholeNotchFraction, type: spec.notchType },
    placement: translation(offsetX, 0),
    cutLabel: `${spec.label.toUpperCase()} CUERPO · 1 al doblez`,
    // Aquí la cintura no es un bajo: se cose a la falda.
    waistAllowance: 12,
  });
}

function buildSkirt(
  draft: DraftBuilder,
  spec: SideSpec,
  run: number,
  offsetX: number,
): PatternPiece {
  const id = `dress${spec.key === 'front' ? 'Front' : 'Back'}Skirt`;
  const at = (name: string): string => `${id}.${name}`;

  const length = draft.value('skirtLength');
  const hipLevel = length - draft.value('waistToHip');

  const centerHem = draft.point(at('centerHem'), vec2(0, 0));
  const centerWaist = draft.point(at('centerWaist'), vec2(0, length));

  /*
   * MISMA anchura y MISMA pinza que el cuerpo: es lo que hace que las dos
   * líneas de cintura casen al coserlas, y lo que alinea verticalmente las
   * pinzas de arriba y de abajo.
   */
  const waist = makeWaist({
    center: centerWaist,
    run,
    intake: spec.dartIntake,
    position: spec.skirtDartPosition,
    length: spec.skirtDartLength,
    side: 'right',
  });

  const waistSide = registerWaist(draft, at, waist);

  const lower = skirtLowerBlock({
    centerHem,
    hipQuarter: draft.value('hipQuarter'),
    hipLevel,
    waistSide,
  });

  draft.point(at('sideHem'), lower.sideHem);
  draft.point(at('hipSide'), lower.hipSide);

  return skirtPanel({
    id,
    name: `${spec.label} · falda`,
    centerRole: spec.centerRole,
    centerOnFold: spec.key === 'front',
    waist,
    lower,
    centerHem,
    centerWaist,
    hipLevel,
    notchType: spec.notchType,
    placement: translation(offsetX, -(length + PIECE_GAP)),
    cutLabel: `${spec.label.toUpperCase()} FALDA · ${spec.key === 'front' ? '1 al doblez' : '2'}`,
  });
}

interface WaistInput {
  readonly center: ReturnType<DraftBuilder['point']>;
  readonly run: number;
  readonly intake: number;
  readonly position: number;
  readonly length: number;
  readonly side: 'left' | 'right';
}

/**
 * Cintura del vestido: anchura DADA y línea horizontal.
 *
 * Sin subida al costado, y por eso exacta: la longitud coincide con la
 * proyección, de modo que el contorno de cintura sale al milímetro sin resolver
 * nada. Es también la condición para que la cintura del cuerpo y la de la falda
 * sean idénticas — si una subiera y la otra no, la costura de talle giraría.
 */
const makeWaist = (input: WaistInput): WaistBlock =>
  waistBlock({
    center: input.center,
    extent: { kind: 'run', run: input.run },
    rise: 0,
    dartIntake: input.intake,
    dartPosition: input.position,
    dartLength: input.length,
    dartSide: input.side,
  });

/**
 * Registra los puntos de la cintura y devuelve el del costado YA CORREGIDO.
 *
 * Devolver el punto registrado y no el paramétrico es lo que hace que un ajuste
 * manual sobre el costado arrastre consigo todo lo que se construye a partir de
 * él —la sisa, el costado de la falda— en lugar de quedar suelto.
 */
function registerWaist(
  draft: DraftBuilder,
  at: (name: string) => string,
  waist: WaistBlock,
): ReturnType<DraftBuilder['point']> {
  draft.point(at('dartApex'), waist.apex);
  draft.point(at('dartLegCenterSide'), waist.legCenterSide);
  draft.point(at('dartLegSideSide'), waist.legSideSide);
  return draft.point(at('waistSide'), waist.side);
}

/**
 * Grafo de costuras del vestido.
 *
 * La costura de TALLE aparece por duplicado —cintura interior con interior,
 * exterior con exterior— porque la pinza parte la cintura en dos aristas. Que
 * ambas casen es consecuencia de que cuerpo y falda compartan pinza: sin eso,
 * los tramos tendrían longitudes distintas y no habría forma de unirlos.
 */
function buildSeams(draft: DraftBuilder): Seam[] {
  const totalEase = draft.value('sleeveCapEase');
  const frontEase = totalEase * draft.value('sleeveCapEaseFrontShare');

  const seams: Seam[] = [
    createSeam(
      endpoint(pieceId('dressFrontBodice'), edgeId('dressFrontBodice', 'shoulder')),
      endpoint(pieceId('dressBackBodice'), edgeId('dressBackBodice', 'shoulder')),
    ),
    createSeam(
      endpoint(pieceId('dressFrontBodice'), edgeId('dressFrontBodice', 'side')),
      endpoint(pieceId('dressBackBodice'), edgeId('dressBackBodice', 'side')),
    ),
    createSeam(
      endpoint(pieceId('dressFrontSkirt'), edgeId('dressFrontSkirt', 'side')),
      endpoint(pieceId('dressBackSkirt'), edgeId('dressBackSkirt', 'side')),
    ),
    createSeam(
      endpoint(pieceId('dressFrontBodice'), edgeId('dressFrontBodice', 'armhole')),
      endpoint(pieceId('dressSleeve'), edgeId('dressSleeve', 'capFront'), true),
      frontEase,
    ),
    createSeam(
      endpoint(pieceId('dressBackBodice'), edgeId('dressBackBodice', 'armhole')),
      endpoint(pieceId('dressSleeve'), edgeId('dressSleeve', 'capBack')),
      totalEase - frontEase,
    ),
  ];

  for (const side of ['Front', 'Back'] as const) {
    for (const part of ['waistInner', 'waistOuter'] as const) {
      seams.push(
        createSeam(
          endpoint(pieceId(`dress${side}Bodice`), edgeId(`dress${side}Bodice`, part)),
          endpoint(pieceId(`dress${side}Skirt`), edgeId(`dress${side}Skirt`, part)),
        ),
      );
    }
  }

  return seams;
}

const armholeLength = (piece: PatternPiece, id: string): number => {
  const edge = findEdge(piece, edgeId(id, 'armhole'));
  return edge === undefined ? 0 : edgeLength(piece, edge);
};

export const dressGenerator: GarmentGenerator = {
  id: 'dress',
  name: 'Vestido básico con manga',
  requires: [
    'underarmLevel',
    'bodiceSideIntake',
    'bodiceDartLength',
    'bodiceFrontDartPosition',
    'bodiceBackDartPosition',
    'dressFrontDart',
    'dressBackDart',
    'skirtLength',
    'waistToHip',
    'hipQuarter',
    'skirtFrontDartLength',
    'skirtBackDartLength',
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
  generate: generateDress,
};
