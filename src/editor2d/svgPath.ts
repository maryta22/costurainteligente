import { arcToCubics } from '@core/geometry/arc';
import type { Contour } from '@core/geometry/contour';
import type { CubicSeg } from '@core/geometry/cubic';
import type { Polygon } from '@core/geometry/polygon';
import type { Segment } from '@core/geometry/segment';
import { segmentStart } from '@core/geometry/segment';
import type { Vec2 } from '@core/geometry/vec2';

/**
 * Serialización de geometría al atributo `d` de SVG.
 *
 * Vive en la capa de presentación y no en el núcleo a propósito: convertir a
 * una cadena es una decisión de formato, y el mismo contorno se emitirá también
 * a PDF y a DXF con reglas distintas (Fases 9 y 14). El núcleo entrega
 * geometría; cada exportador decide cómo escribirla.
 *
 * Las curvas se emiten como `C` —Bézier cúbica nativa de SVG— en lugar de
 * aplanarse a polilínea: el navegador rasteriza a la resolución del zoom
 * actual, así que una sisa sigue viéndose suave al ampliar sin que el modelo
 * tenga que remuestrearla.
 */
export function contourToPathData(contour: Contour): string {
  const first = contour.segments[0];
  if (first === undefined) return '';

  const start = segmentStart(first);
  let data = `M${round(start.x)} ${round(start.y)}`;

  for (const segment of contour.segments) data += segmentToPathData(segment);
  if (contour.closed) data += 'Z';

  return data;
}

function segmentToPathData(segment: Segment): string {
  switch (segment.kind) {
    case 'line':
      return `L${round(segment.b.x)} ${round(segment.b.y)}`;
    case 'cubic':
      return cubicToPathData(segment);
    case 'arc':
      // SVG tiene arco elíptico nativo, pero su parametrización por banderas es
      // una fuente clásica de errores de sentido. Se convierte a cúbicas, cuyo
      // error de posición es de micras.
      return arcToCubics(segment).map(cubicToPathData).join('');
  }
}

const cubicToPathData = (c: CubicSeg): string =>
  `C${round(c.p1.x)} ${round(c.p1.y)} ${round(c.p2.x)} ${round(c.p2.y)} ${round(c.p3.x)} ${round(c.p3.y)}`;

/** Polígono cerrado como `d`. */
export function polygonToPathData(polygon: Polygon): string {
  const first = polygon[0];
  if (first === undefined) return '';

  let data = `M${round(first.x)} ${round(first.y)}`;
  for (let i = 1; i < polygon.length; i++) {
    const point = polygon[i];
    if (point === undefined) continue;
    data += `L${round(point.x)} ${round(point.y)}`;
  }

  return `${data}Z`;
}

export const segmentBetween = (a: Vec2, b: Vec2): string =>
  `M${round(a.x)} ${round(a.y)}L${round(b.x)} ${round(b.y)}`;

/**
 * Recorta a cuatro decimales de milímetro.
 *
 * Es 100 nanómetros: irrelevante para cualquier magnitud de confección, y
 * recorta a la mitad el tamaño de las cadenas de trazado frente a volcar los
 * diecisiete dígitos de un `double`.
 */
const round = (value: number): number => Math.round(value * 1e4) / 1e4;
