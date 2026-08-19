import { CHORD_TOL_MM } from '@core/geometry/epsilon';
import { lineSeg } from '@core/geometry/line';
import { applyToPoint } from '@core/geometry/mat3';
import type { Rect } from '@core/geometry/rect';
import { rectExpand, rectUnion } from '@core/geometry/rect';
import type { Segment } from '@core/geometry/segment';
import { segmentBounds, transformSegment } from '@core/geometry/segment';
import type { Vec2 } from '@core/geometry/vec2';
import { add, fromPolar, scale, sub, vec2 } from '@core/geometry/vec2';

import { edgeSegments } from '@domain/pattern/edge';
import { resolveNotches } from '@domain/pattern/notch';
import { cutLine } from '@domain/pattern/seamAllowance';
import type { PatternPiece } from '@domain/pattern/types';

import type { DrawItem, DrawPath, Drawing, ExportOptions } from './types';
import { CALIBRATION_SIZE_MM } from './types';

/** Longitud de la marca de piquete dibujada, en mm. */
const NOTCH_MARK_MM = 5;
/** Semiapertura de la punta de flecha del hilo, en mm. */
const ARROW_MM = 4;
const LABEL_SIZE_MM = 4;

const path = (
  style: DrawPath['style'],
  segments: readonly Segment[],
  closed = false,
): DrawPath => ({ kind: 'path', style, segments, closed });

/**
 * Convierte un patrón en un documento imprimible.
 *
 * Se hace UNA vez y la consumen SVG, PDF y —más adelante— DXF. La geometría
 * queda en coordenadas de documento: milímetros y Y hacia arriba, el convenio
 * del modelo. Cada exportador se ocupa de su propio sistema de coordenadas.
 *
 * Todo lo que se dibuja es DERIVADO: la línea de corte se recalcula aquí a
 * partir de los márgenes, y los piquetes se proyectan en el momento. Exportar
 * nunca lee geometría almacenada que pudiera estar desactualizada.
 */
export function buildDrawing(
  pieces: readonly PatternPiece[],
  options: ExportOptions = {},
): Drawing {
  const tolerance = options.toleranceMm ?? CHORD_TOL_MM;
  const items: DrawItem[] = [];

  for (const piece of pieces) {
    items.push(...drawPiece(piece, options, tolerance));
  }

  let bounds = boundsOf(items) ?? { min: vec2(0, 0), max: vec2(100, 100) };

  if (options.includeCalibration !== false) {
    const calibration = calibrationItems(bounds);
    items.push(...calibration);
    bounds = rectUnion(bounds, boundsOf(calibration) ?? bounds);
  }

  return {
    title: options.title ?? 'Patrón',
    items,
    bounds: rectExpand(bounds, 5),
  };
}

function drawPiece(
  piece: PatternPiece,
  options: ExportOptions,
  tolerance: number,
): DrawItem[] {
  const items: DrawItem[] = [];
  const place = (point: Vec2): Vec2 => applyToPoint(piece.placement, point);

  if (options.includeCutLine !== false) {
    const cut = cutLine(piece, { tolerance });
    const points = cut.polygon.map(place);

    if (points.length >= 3) {
      const segments: Segment[] = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        if (a === undefined || b === undefined) continue;
        segments.push(lineSeg(a, b));
      }
      items.push(path('cut', segments, true));
    }
  }

  if (options.includeSeamLine !== false) {
    /*
     * Cada arista se dibuja por separado y con su papel: un doblez no se corta
     * y se marca con otra línea, una pinza tampoco es una costura. Dibujar el
     * contorno entero de una sola vez perdería esa distinción, que es
     * exactamente la que necesita quien va a cortar.
     */
    for (const edge of piece.edges) {
      const segments = edgeSegments(piece, edge).flatMap((segment) =>
        transformSegment(segment, piece.placement),
      );

      items.push(path(styleForEdge(edge.onFold, edge.role), segments));
    }
  }

  if (options.includeNotches !== false) {
    for (const notch of resolveNotches(piece)) {
      const outer = place(notch.cutPoint);
      const inner = place(add(notch.cutPoint, scale(notch.outward, -NOTCH_MARK_MM)));
      items.push(path('notch', [lineSeg(outer, inner)]));
    }
  }

  if (options.includeGrainLine !== false && piece.grainLine !== null) {
    items.push(...grainItems(piece));
  }

  if (options.includeLabels !== false) {
    for (const label of piece.labels) {
      items.push({
        kind: 'text',
        text: label.text,
        at: place(label.position),
        sizeMm: LABEL_SIZE_MM,
        anchor: 'middle',
        angle: label.angle,
      });
    }
  }

  return items;
}

const styleForEdge = (onFold: boolean, role: string): DrawPath['style'] => {
  if (onFold) return 'fold';
  if (role === 'dart') return 'dart';
  return 'seam';
};

/** Línea de hilo con puntas de flecha en ambos extremos. */
function grainItems(piece: PatternPiece): DrawItem[] {
  const grain = piece.grainLine;
  if (grain === null) return [];

  const place = (point: Vec2): Vec2 => applyToPoint(piece.placement, point);
  const half = fromPolar(grain.length / 2, grain.angle);

  const from = place(sub(grain.origin, half));
  const to = place(add(grain.origin, half));

  const head = (tip: Vec2, towards: Vec2): Segment[] => {
    const direction = sub(towards, tip);
    const length = Math.hypot(direction.x, direction.y) || 1;
    const unit = vec2(direction.x / length, direction.y / length);
    const back = add(tip, scale(unit, ARROW_MM));
    const side = vec2(-unit.y, unit.x);

    return [
      lineSeg(tip, add(back, scale(side, ARROW_MM * 0.5))),
      lineSeg(tip, add(back, scale(side, -ARROW_MM * 0.5))),
    ];
  };

  return [
    path('grain', [lineSeg(from, to), ...head(from, to), ...head(to, from)]),
  ];
}

/**
 * Cuadrado de comprobación de escala — mitigación del riesgo R6.
 *
 * ── Por qué es imprescindible ──────────────────────────────────────────────
 *
 * Los controladores de impresión ajustan al área imprimible POR DEFECTO. Una
 * reducción del 4 % es invisible en la pantalla de vista previa y arruina el
 * patrón: la prenda sale una talla pequeña sin que nada avise.
 *
 * Un cuadrado de lado conocido convierte ese fallo silencioso en una
 * comprobación de tres segundos con una regla. Va acompañado de la instrucción
 * concreta, porque «imprimir al 100 %» se llama distinto en cada controlador.
 */
function calibrationItems(bounds: Rect): DrawItem[] {
  const origin = vec2(bounds.min.x, bounds.min.y - CALIBRATION_SIZE_MM - 30);
  const size = CALIBRATION_SIZE_MM;

  const corners = [
    origin,
    add(origin, vec2(size, 0)),
    add(origin, vec2(size, size)),
    add(origin, vec2(0, size)),
  ];

  const segments: Segment[] = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    if (a === undefined || b === undefined) continue;
    segments.push(lineSeg(a, b));
  }

  return [
    path('frame', segments, true),
    {
      kind: 'text',
      text: `${size} mm — comprueba este cuadrado con una regla`,
      at: add(origin, vec2(size / 2, -8)),
      sizeMm: 4,
      anchor: 'middle',
      angle: 0,
    },
    {
      kind: 'text',
      text: 'Imprime al 100 %, sin «ajustar a página»',
      at: add(origin, vec2(size / 2, -16)),
      sizeMm: 3.5,
      anchor: 'middle',
      angle: 0,
    },
  ];
}

/**
 * Envolvente de una lista de primitivas.
 *
 * Usa la caja EXACTA de cada segmento, que el núcleo calcula resolviendo las
 * raíces de la derivada. Muestrear la curva daría una caja algo pequeña, y en
 * una exportación eso significa contenido recortado en el borde de la página.
 */
export function boundsOf(items: readonly DrawItem[]): Rect | null {
  let result: Rect | null = null;

  const include = (rect: Rect): void => {
    result = result === null ? rect : rectUnion(result, rect);
  };

  for (const item of items) {
    if (item.kind === 'text') {
      include({ min: item.at, max: item.at });
      continue;
    }

    for (const segment of item.segments) include(segmentBounds(segment));
  }

  return result;
}
