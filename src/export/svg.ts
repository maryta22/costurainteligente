import { arcToCubics } from '@core/geometry/arc';
import type { CubicSeg } from '@core/geometry/cubic';
import type { Rect } from '@core/geometry/rect';
import { rectHeight, rectWidth } from '@core/geometry/rect';
import type { Segment } from '@core/geometry/segment';
import { segmentStart } from '@core/geometry/segment';

import type { DrawItem, DrawPath, DrawStyle, DrawText, Drawing } from './types';

/**
 * Aspecto de cada tipo de trazo al imprimir, en milímetros.
 *
 * Los convenios son de taller: la línea de costura es continua y fina, la de
 * corte discontinua, el doblez lleva raya y punto, y la línea de hilo va en
 * gris para distinguirla del contorno sin competir con él.
 */
const STYLES: Readonly<Record<DrawStyle, { width: number; dash?: string; color: string }>> = {
  seam: { width: 0.4, color: '#000000' },
  cut: { width: 0.3, dash: '4 2', color: '#000000' },
  fold: { width: 0.4, dash: '10 2 1.5 2', color: '#000000' },
  dart: { width: 0.3, color: '#000000' },
  notch: { width: 0.5, color: '#000000' },
  grain: { width: 0.35, color: '#444444' },
  guide: { width: 0.2, dash: '2 2', color: '#888888' },
  frame: { width: 0.25, color: '#999999' },
};

export interface SvgOptions {
  /** Región del documento que se exporta. Por defecto, todo. */
  readonly window?: Rect;
  readonly title?: string;
}

/**
 * Serializa un dibujo a SVG A ESCALA REAL.
 *
 * ── Lo que garantiza la escala ─────────────────────────────────────────────
 *
 * El truco está en dos atributos que tienen que ser coherentes: `width` y
 * `height` en MILÍMETROS, y un `viewBox` cuyos números sean los mismos. Con
 * eso, una unidad de usuario es un milímetro por definición, y cualquier
 * programa que respete el estándar imprime a tamaño real sin más.
 *
 * ── La inversión de Y ──────────────────────────────────────────────────────
 *
 * SVG tiene el eje Y hacia abajo y el modelo lo tiene hacia arriba (decisión
 * D4). La conversión ocurre en el atributo `transform` del grupo raíz y en
 * ningún otro sitio, igual que en el lienzo del editor. El texto se
 * contra-invierte individualmente porque, dentro de un grupo con la Y
 * invertida, las letras saldrían del revés.
 */
export function drawingToSvg(drawing: Drawing, options: SvgOptions = {}): string {
  const window = options.window ?? drawing.bounds;
  const width = rectWidth(window);
  const height = rectHeight(window);

  const body = drawing.items
    .map((item) => renderItem(item, window))
    .filter((markup) => markup !== '')
    .join('\n    ');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1"`,
    `     width="${round(width)}mm" height="${round(height)}mm"`,
    `     viewBox="0 0 ${round(width)} ${round(height)}">`,
    `  <title>${escapeXml(options.title ?? drawing.title)}</title>`,
    // Un fondo blanco explícito: sin él, algunos visores imprimen transparente
    // sobre un fondo oscuro y el patrón sale ilegible.
    `  <rect width="${round(width)}" height="${round(height)}" fill="#ffffff"/>`,
    `  <g transform="translate(${round(-window.min.x)} ${round(window.max.y)}) scale(1 -1)"`,
    `     fill="none" stroke-linecap="round" stroke-linejoin="round">`,
    `    ${body}`,
    '  </g>',
    '</svg>',
    '',
  ].join('\n');
}

function renderItem(item: DrawItem, window: Rect): string {
  return item.kind === 'text' ? renderText(item, window) : renderPath(item);
}

function renderPath(item: DrawPath): string {
  const data = pathData(item.segments, item.closed);
  if (data === '') return '';

  const style = STYLES[item.style];
  const dash = style.dash === undefined ? '' : ` stroke-dasharray="${style.dash}"`;

  return `<path d="${data}" stroke="${style.color}" stroke-width="${style.width}"${dash}/>`;
}

/**
 * El texto se contra-invierte para que no salga espejado.
 *
 * Dentro del grupo con `scale(1 -1)`, un `<text>` se dibujaría del revés.
 * Aplicarle una segunda inversión alrededor de su propia posición lo devuelve
 * a su sitio sin moverlo. Es la misma técnica que usa la capa de cotas del
 * editor.
 */
function renderText(item: DrawText, _window: Rect): string {
  const { x, y } = item.at;
  const rotation = item.angle === 0 ? '' : ` rotate(${-item.angle})`;

  return [
    `<g transform="translate(${round(x)} ${round(y)}) scale(1 -1)${rotation}">`,
    `<text x="0" y="0" font-family="Helvetica, Arial, sans-serif"`,
    ` font-size="${item.sizeMm}" text-anchor="${item.anchor}" fill="#000000">`,
    escapeXml(item.text),
    '</text></g>',
  ].join('');
}

/** Datos de trazado. Las curvas se emiten como cúbicas nativas de SVG. */
export function pathData(segments: readonly Segment[], closed: boolean): string {
  if (segments.length === 0) return '';

  let data = '';
  let cursor: string | null = null;

  for (const segment of segments) {
    const start = segmentStart(segment);
    const moveTo = `${round(start.x)} ${round(start.y)}`;

    // Sólo se emite `M` cuando hay un salto: los tramos encadenados comparten
    // extremo y un `M` de más rompería el trazo en dos.
    if (cursor !== moveTo) data += `M${moveTo}`;

    switch (segment.kind) {
      case 'line':
        data += `L${round(segment.b.x)} ${round(segment.b.y)}`;
        cursor = `${round(segment.b.x)} ${round(segment.b.y)}`;
        break;
      case 'cubic':
        data += cubicData(segment);
        cursor = `${round(segment.p3.x)} ${round(segment.p3.y)}`;
        break;
      case 'arc': {
        for (const cubic of arcToCubics(segment)) {
          data += cubicData(cubic);
          cursor = `${round(cubic.p3.x)} ${round(cubic.p3.y)}`;
        }
        break;
      }
    }
  }

  return closed ? `${data}Z` : data;
}

const cubicData = (c: CubicSeg): string =>
  `C${round(c.p1.x)} ${round(c.p1.y)} ${round(c.p2.x)} ${round(c.p2.y)} ${round(c.p3.x)} ${round(c.p3.y)}`;

/** Tres decimales de milímetro: una micra, muy por debajo de lo imprimible. */
const round = (value: number): number => Math.round(value * 1000) / 1000;

const escapeXml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
