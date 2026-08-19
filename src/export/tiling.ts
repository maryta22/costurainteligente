import { lineSeg } from '@core/geometry/line';
import type { Rect } from '@core/geometry/rect';
import { rectHeight, rectWidth } from '@core/geometry/rect';
import type { Segment } from '@core/geometry/segment';
import { segmentBounds } from '@core/geometry/segment';
import { vec2 } from '@core/geometry/vec2';

import type { DrawItem, ExportOptions, PageFormat } from './types';
import { DEFAULT_MARGIN_MM, DEFAULT_OVERLAP_MM } from './types';

export interface PageWindow {
  /** Fila, de arriba abajo, empezando en 1. */
  readonly row: number;
  /** Columna, de izquierda a derecha, empezando en 1. */
  readonly column: number;
  /** Región del documento que cae en esta página, en mm. */
  readonly window: Rect;
  readonly label: string;
}

export interface TilingResult {
  readonly pages: readonly PageWindow[];
  readonly rows: number;
  readonly columns: number;
  /** Área útil de cada página, en mm. */
  readonly printableWidth: number;
  readonly printableHeight: number;
}

/** Longitud de las cruces de registro, en mm. */
const REGISTRATION_MM = 8;

/**
 * Reparte el documento en páginas del formato dado.
 *
 * ── Por qué hay solape ─────────────────────────────────────────────────────
 *
 * Si las páginas encajaran justo, montarlas exigiría cortar exactamente por el
 * borde y unir a tope, sin margen de error: un milímetro de desvío en cada
 * junta se acumula y a las diez páginas el patrón mide un centímetro de más.
 *
 * Con solape se pegan superponiendo, y las marcas de registro dan la referencia
 * exacta. El error deja de acumularse porque cada junta se alinea contra una
 * marca absoluta y no contra la anterior.
 *
 * El paso entre páginas es, por eso, el área útil MENOS el solape.
 */
export function tilePages(
  bounds: Rect,
  format: PageFormat,
  options: ExportOptions = {},
): TilingResult {
  const margin = options.marginMm ?? DEFAULT_MARGIN_MM;
  const overlap = options.overlapMm ?? DEFAULT_OVERLAP_MM;

  const printableWidth = Math.max(format.widthMm - margin * 2, 1);

  /*
   * Un rollo de plóter no tiene alto: se declara con `heightMm = 0` y el
   * documento sale en una sola tira continua.
   */
  const printableHeight =
    format.heightMm > 0 ? Math.max(format.heightMm - margin * 2, 1) : rectHeight(bounds);

  const stepX = Math.max(printableWidth - overlap, 1);
  const stepY = Math.max(printableHeight - overlap, 1);

  const columns = countPages(rectWidth(bounds), printableWidth, stepX);
  const rows = countPages(rectHeight(bounds), printableHeight, stepY);

  const pages: PageWindow[] = [];

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      // Las filas se numeran de arriba abajo, que es como se apila el papel;
      // el eje Y del documento crece hacia arriba, de ahí la resta.
      const top = bounds.max.y - row * stepY;

      pages.push({
        row: row + 1,
        column: column + 1,
        window: {
          min: vec2(bounds.min.x + column * stepX, top - printableHeight),
          max: vec2(bounds.min.x + column * stepX + printableWidth, top),
        },
        label: `Fila ${row + 1} · Columna ${column + 1}`,
      });
    }
  }

  return { pages, rows, columns, printableWidth, printableHeight };
}

const countPages = (extent: number, printable: number, step: number): number =>
  extent <= printable ? 1 : Math.ceil((extent - printable) / step) + 1;

/**
 * Marcas de montaje de una página.
 *
 * Cuatro cruces en las esquinas del área útil más el marco. Al superponer dos
 * páginas contiguas, las cruces de una caen sobre las de la otra: se alinean y
 * se pega. Sin una referencia absoluta habría que alinear por el dibujo, que en
 * una zona sin líneas es imposible.
 */
export function registrationItems(page: PageWindow, total: TilingResult): DrawItem[] {
  const { window } = page;

  const frame: Segment[] = [
    lineSeg(vec2(window.min.x, window.min.y), vec2(window.max.x, window.min.y)),
    lineSeg(vec2(window.max.x, window.min.y), vec2(window.max.x, window.max.y)),
    lineSeg(vec2(window.max.x, window.max.y), vec2(window.min.x, window.max.y)),
    lineSeg(vec2(window.min.x, window.max.y), vec2(window.min.x, window.min.y)),
  ];

  const crosses: Segment[] = [];
  const half = REGISTRATION_MM / 2;

  for (const corner of [
    vec2(window.min.x, window.min.y),
    vec2(window.max.x, window.min.y),
    vec2(window.max.x, window.max.y),
    vec2(window.min.x, window.max.y),
  ]) {
    crosses.push(
      lineSeg(vec2(corner.x - half, corner.y), vec2(corner.x + half, corner.y)),
      lineSeg(vec2(corner.x, corner.y - half), vec2(corner.x, corner.y + half)),
    );
  }

  return [
    { kind: 'path', style: 'frame', segments: frame, closed: true },
    { kind: 'path', style: 'frame', segments: crosses, closed: false },
    {
      kind: 'text',
      text: `${page.label}  ·  de ${total.rows} × ${total.columns}`,
      at: vec2(window.min.x + 4, window.min.y + 4),
      sizeMm: 3.5,
      anchor: 'start',
      angle: 0,
    },
  ];
}

/** ¿Cae alguna parte de la primitiva dentro de la ventana de la página? */
export function itemIntersectsWindow(item: DrawItem, window: Rect, slackMm = 2): boolean {
  if (item.kind === 'text') {
    return (
      item.at.x >= window.min.x - slackMm &&
      item.at.x <= window.max.x + slackMm &&
      item.at.y >= window.min.y - slackMm &&
      item.at.y <= window.max.y + slackMm
    );
  }

  for (const segment of item.segments) {
    const box = segmentBoundsCached(segment);
    const separated =
      box.max.x < window.min.x - slackMm ||
      box.min.x > window.max.x + slackMm ||
      box.max.y < window.min.y - slackMm ||
      box.min.y > window.max.y + slackMm;

    if (!separated) return true;
  }

  return false;
}

/**
 * Cajas envolventes memorizadas.
 *
 * El filtrado por página consulta la caja de cada segmento una vez por página,
 * y la de una cúbica exige resolver dos cuadráticas. Con decenas de páginas el
 * mismo cálculo se repetiría cientos de veces sobre segmentos que no cambian.
 * El `WeakMap` no retiene nada: cuando el dibujo se descarta, la caché también.
 */
const boundsCache = new WeakMap<object, Rect>();

function segmentBoundsCached(segment: Segment): Rect {
  const cached = boundsCache.get(segment);
  if (cached !== undefined) return cached;

  const computed = segmentBounds(segment);
  boundsCache.set(segment, computed);
  return computed;
}
