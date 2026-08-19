import { contour } from '@core/geometry/contour';
import { cubicSeg } from '@core/geometry/cubic';
import { lineSeg } from '@core/geometry/line';
import type { Segment } from '@core/geometry/segment';
import { degToRad } from '@core/geometry/math';
import { vec2 } from '@core/geometry/vec2';

import { edgeLength } from './edge';
import { balanceNotches, createNotch } from './notch';
import { createPiece } from './piece';
import { edgeId, pieceId } from './ids';
import type { Notch, PatternEdge, PatternPiece } from './types';
import { DEFAULT_SEAM_ALLOWANCE_MM } from './types';

/**
 * DELANTERO DE CUERPO, media pieza al doblez. Talla M aproximada.
 *
 * Fixture construida A MANO para verificar la Fase 3. En la Fase 5 la
 * sustituirán los generadores paramétricos; hasta entonces es la pieza sobre la
 * que se comprueba que el margen variable, los piquetes y el validador se
 * comportan sobre geometría realista y no sólo sobre cuadrados de test.
 *
 * Sistema local: origen en el centro delantero a la altura de cintura, X hacia
 * el costado, Y hacia arriba. El contorno se recorre en sentido ANTIHORARIO,
 * como exige el modelo.
 *
 *        SNP (65,420) ──── hombro ──── (140,400) punta de hombro
 *          ╱                                    │
 *     escote                                  sisa
 *        ╱                                      │
 *   (0,350) CF cuello                    (110,250) axila
 *      │                                        │
 *      │ centro delantero                   costado
 *      │ AL DOBLEZ                              │
 *   (0,0) ─────────── bajo ─────────────── (95,0)
 *
 * Los seis márgenes son deliberadamente distintos —de 0 mm en el doblez a
 * 40 mm en el bajo— porque el objetivo es justamente ese: comprobar que la
 * línea de corte cambia de anchura donde debe y resuelve bien las esquinas
 * entre anchuras dispares.
 */

const CF_WAIST = vec2(0, 0);
const SIDE_WAIST = vec2(95, 0);
const UNDERARM = vec2(110, 250);
const SHOULDER_TIP = vec2(140, 400);
const SNP = vec2(65, 420);
const CF_NECK = vec2(0, 350);

const PIECE = pieceId('front');

const SEGMENTS: readonly Segment[] = [
  // 0 · bajo, recto
  lineSeg(CF_WAIST, SIDE_WAIST),
  // 1 · costado, con el entalle de cintura
  cubicSeg(SIDE_WAIST, vec2(97, 80), vec2(108, 170), UNDERARM),
  // 2 · sisa
  cubicSeg(UNDERARM, vec2(105, 310), vec2(122, 375), SHOULDER_TIP),
  // 3 · hombro, recto
  lineSeg(SHOULDER_TIP, SNP),
  // 4 · escote, cóncavo hacia el interior de la pieza
  cubicSeg(SNP, vec2(52, 405), vec2(18, 368), CF_NECK),
  // 5 · centro delantero, al doblez
  lineSeg(CF_NECK, CF_WAIST),
];

const EDGES: readonly PatternEdge[] = [
  {
    id: edgeId('front', 'hem'),
    role: 'hem',
    startSegment: 0,
    segmentCount: 1,
    seamAllowance: DEFAULT_SEAM_ALLOWANCE_MM.hem,
    onFold: false,
    label: 'bajo',
  },
  {
    id: edgeId('front', 'side'),
    role: 'side',
    startSegment: 1,
    segmentCount: 1,
    seamAllowance: DEFAULT_SEAM_ALLOWANCE_MM.side,
    onFold: false,
    label: 'costado',
  },
  {
    id: edgeId('front', 'armhole'),
    role: 'armhole',
    startSegment: 2,
    segmentCount: 1,
    seamAllowance: DEFAULT_SEAM_ALLOWANCE_MM.armhole,
    onFold: false,
    label: 'sisa',
  },
  {
    id: edgeId('front', 'shoulder'),
    role: 'shoulder',
    startSegment: 3,
    segmentCount: 1,
    seamAllowance: DEFAULT_SEAM_ALLOWANCE_MM.shoulder,
    onFold: false,
    label: 'hombro',
  },
  {
    id: edgeId('front', 'neckline'),
    role: 'neckline',
    startSegment: 4,
    segmentCount: 1,
    seamAllowance: DEFAULT_SEAM_ALLOWANCE_MM.neckline,
    onFold: false,
    label: 'escote',
  },
  {
    // Al doblez: no se corta, así que no lleva margen aunque el campo diga otra cosa.
    id: edgeId('front', 'center-front'),
    role: 'center-front',
    startSegment: 5,
    segmentCount: 1,
    seamAllowance: 0,
    onFold: true,
    label: 'centro delantero · al doblez',
  },
];

/** Delantero de cuerpo listo para usar, con piquetes y línea de hilo. */
export function bodiceFrontSample(): PatternPiece {
  const base = createPiece({
    id: PIECE,
    name: 'Delantero de cuerpo',
    contour: contour(SEGMENTS, true),
    edges: EDGES,
    grainLine: { origin: vec2(55, 60), angle: degToRad(90), length: 260 },
    labels: [{ text: 'DELANTERO · 1 al doblez', position: vec2(58, 150), angle: 0 }],
    cutCount: 1,
  });

  const side = base.edges[1];
  const armhole = base.edges[2];
  const shoulder = base.edges[3];
  if (side === undefined || armhole === undefined || shoulder === undefined) return base;

  /*
   * Los piquetes se sitúan por FRACCIÓN de la arista, no por milímetros: al
   * cambiar de talla en la Fase 8 la sisa se alarga, y «a un tercio» sigue
   * significando lo mismo mientras que «a 120 mm» dejaría de hacerlo.
   */
  const notches: Notch[] = [
    // Punto de equilibrio del costado: reparte el entalle al montar.
    ...balanceNotches(base, side, 1, 0),
    // Piquete de montaje de la manga, a un tercio de la sisa desde la axila.
    createNotch({ edge: armhole.id, arcLength: edgeLength(base, armhole) / 3 }, 0),
    // Marca de mitad de hombro.
    createNotch({ edge: shoulder.id, arcLength: edgeLength(base, shoulder) / 2 }, 0),
  ];

  return { ...base, notches };
}
