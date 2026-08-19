import { lineSeg } from '@core/geometry/line';
import { translation } from '@core/geometry/mat3';
import { vec2 } from '@core/geometry/vec2';

import { assemblePanel, label } from '../blocks/assemble';
import type { CenterRole } from '../blocks/panels';
import { skirtPanel } from '../blocks/panels';
import { skirtLowerBlock } from '../blocks/skirtBody';
import { waistBlock } from '../blocks/waist';
import type { Draft, DraftContext } from '../construction/draft';
import { Draft as DraftBuilder } from '../construction/draft';
import { edgeId, pieceId } from '../ids';
import { createSeam, endpoint } from '../seam';
import type { PatternPiece, Seam } from '../types';

import type { GarmentGenerator, GeneratedGarment } from './types';

/**
 * Separación entre piezas al colocarlas, en mm.
 *
 * Holgada a propósito: la línea de corte sobresale hasta 40 mm por el bajo, así
 * que una separación corta hace que los márgenes de dos piezas se pisen.
 */
const PIECE_GAP = 140;

interface SkirtPanelSpec {
  readonly key: 'front' | 'back';
  readonly name: string;
  readonly dartIntake: number;
  readonly dartLength: number;
  readonly dartPosition: number;
  readonly centerRole: CenterRole;
  readonly centerOnFold: boolean;
  readonly notchType: 'single' | 'double';
}

/**
 * FALDA RECTA BÁSICA — delantero, espalda y pretina.
 *
 * El generador ya no traza nada: compone. La línea de cintura la resuelve
 * `waistBlock`, el cuerpo de la falda `skirtLowerBlock`, y el montaje con sus
 * aristas `skirtPanel`. Aquí sólo queda la decisión de qué prenda es —dos
 * paneles, una pretina, el centro de espalda con cremallera— y los parámetros
 * con que se alimentan los bloques.
 */
function generateSkirt(context: DraftContext): GeneratedGarment {
  const draft = new DraftBuilder(context);
  const notes: string[] = [];

  const length = draft.value('skirtLength');
  const waistToHip = draft.value('waistToHip');
  const hipQuarter = draft.value('hipQuarter');

  const panels: SkirtPanelSpec[] = [
    {
      key: 'front',
      name: 'Delantero de falda',
      dartIntake: draft.value('skirtFrontDart'),
      dartLength: draft.value('skirtFrontDartLength'),
      dartPosition: draft.value('skirtFrontDartPosition'),
      centerRole: 'center-front',
      centerOnFold: true,
      notchType: 'single',
    },
    {
      key: 'back',
      name: 'Espalda de falda',
      dartIntake: draft.value('skirtBackDart'),
      dartLength: draft.value('skirtBackDartLength'),
      dartPosition: draft.value('skirtBackDartPosition'),
      centerRole: 'center-back',
      // El centro de espalda lleva costura: ahí va la cremallera.
      centerOnFold: false,
      notchType: 'double',
    },
  ];

  const pieces: PatternPiece[] = panels.map((panel, index) => {
    const id = `skirt${panel.key === 'front' ? 'Front' : 'Back'}`;
    const at = (name: string): string => `${id}.${name}`;

    const centerHem = draft.point(at('centerHem'), vec2(0, 0));
    const centerWaist = draft.point(at('centerWaist'), vec2(0, length));

    const waist = waistBlock({
      center: centerWaist,
      // La falda parte de la cintura: se conoce cuánto debe medir y se resuelve
      // hasta dónde llega.
      extent: { kind: 'span', span: draft.value('skirtWaistSpan') },
      rise: draft.value('skirtSideRise'),
      dartIntake: panel.dartIntake,
      dartPosition: panel.dartPosition,
      dartLength: panel.dartLength,
      // En una falda el interior de la pieza queda por debajo de la cintura.
      dartSide: 'right',
    });

    const waistSide = draft.point(at('waistSide'), waist.side);
    draft.point(at('dartApex'), waist.apex);
    draft.point(at('dartLegCenterSide'), waist.legCenterSide);
    draft.point(at('dartLegSideSide'), waist.legSideSide);

    const lower = skirtLowerBlock({
      centerHem,
      hipQuarter,
      hipLevel: length - waistToHip,
      waistSide,
    });

    draft.point(at('sideHem'), lower.sideHem);
    draft.point(at('hipSide'), lower.hipSide);

    return skirtPanel({
      id,
      name: panel.name,
      centerRole: panel.centerRole,
      centerOnFold: panel.centerOnFold,
      waist,
      lower,
      centerHem,
      centerWaist,
      hipLevel: length - waistToHip,
      notchType: panel.notchType,
      placement: translation(index * (hipQuarter + PIECE_GAP), 0),
      cutLabel: `${panel.name.toUpperCase()} · ${panel.centerOnFold ? '1 al doblez' : '2'}`,
    });
  });

  pieces.push(buildWaistband(draft, length + PIECE_GAP * 2));

  const seams: Seam[] = [
    createSeam(
      endpoint(pieceId('skirtFront'), edgeId('skirtFront', 'side')),
      endpoint(pieceId('skirtBack'), edgeId('skirtBack', 'side')),
    ),
  ];

  notes.push('La unión de la pretina con la cintura no está en el grafo de costuras.');

  return { pieces, seams, draft, notes };
}

/**
 * Pretina: una tira recta doblada por la mitad a lo largo.
 *
 * Su longitud es la cintura terminada más una solapa para el cierre. Se corta
 * al doblez por el borde superior, así que ese borde no lleva margen.
 */
function buildWaistband(draft: Draft, offsetY: number): PatternPiece {
  const id = 'skirtWaistband';
  const width = draft.value('finishedWaist') + draft.value('waistbandExtension');
  const height = draft.value('waistbandWidth');

  const a = draft.point(`${id}.start`, vec2(0, 0));
  const b = draft.point(`${id}.end`, vec2(width, 0));
  const c = draft.point(`${id}.endTop`, vec2(width, height));
  const d = draft.point(`${id}.startTop`, vec2(0, height));

  return assemblePanel({
    id,
    name: 'Pretina',
    edges: [
      { name: 'waist', role: 'waist', segments: [lineSeg(a, b)], label: 'unión a la falda' },
      { name: 'endRight', role: 'other', segments: [lineSeg(b, c)] },
      { name: 'fold', role: 'other', segments: [lineSeg(c, d)], onFold: true, label: 'doblez' },
      { name: 'endLeft', role: 'other', segments: [lineSeg(d, a)] },
    ],
    grainLine: { origin: vec2(width * 0.5, height * 0.5), angle: 0, length: width * 0.6 },
    labels: [label('PRETINA · 1 al doblez', vec2(width * 0.35, height * 0.5))],
    placement: translation(0, offsetY),
    cutCount: 1,
  });
}

export const skirtGenerator: GarmentGenerator = {
  id: 'skirt',
  name: 'Falda recta básica',
  requires: [
    'skirtLength',
    'waistToHip',
    'hipQuarter',
    'skirtWaistSpan',
    'skirtSideRise',
    'skirtFrontDart',
    'skirtBackDart',
    'skirtFrontDartLength',
    'skirtBackDartLength',
    'skirtFrontDartPosition',
    'skirtBackDartPosition',
    'finishedWaist',
    'waistbandWidth',
    'waistbandExtension',
  ],
  generate: generateSkirt,
};
