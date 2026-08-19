import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

import { arcToCubics } from '@core/geometry/arc';
import type { CubicSeg } from '@core/geometry/cubic';
import type { Segment } from '@core/geometry/segment';
import { segmentStart } from '@core/geometry/segment';

import type { DrawItem, DrawPath, DrawStyle, Drawing, ExportOptions, PageFormat } from './types';
import { DEFAULT_MARGIN_MM, PT_PER_MM } from './types';
import { itemIntersectsWindow, registrationItems, tilePages } from './tiling';
import type { PageWindow, TilingResult } from './tiling';

interface StrokeStyle {
  readonly width: number;
  readonly dash?: readonly number[];
  readonly grey: number;
}

/** Mismos convenios que en SVG, expresados para PDF. */
const STYLES: Readonly<Record<DrawStyle, StrokeStyle>> = {
  seam: { width: 0.4, grey: 0 },
  cut: { width: 0.3, dash: [4, 2], grey: 0 },
  fold: { width: 0.4, dash: [10, 2, 1.5, 2], grey: 0 },
  dart: { width: 0.3, grey: 0 },
  notch: { width: 0.5, grey: 0 },
  grain: { width: 0.35, grey: 0.27 },
  guide: { width: 0.2, dash: [2, 2], grey: 0.53 },
  frame: { width: 0.25, grey: 0.6 },
};

const mmToPt = (mm: number): number => mm * PT_PER_MM;

/**
 * Exporta el dibujo a PDF, teselado en el formato indicado.
 *
 * ── Sobre la escala ────────────────────────────────────────────────────────
 *
 * PDF mide en PUNTOS PostScript: 72 por pulgada, es decir 2.834645… por
 * milímetro. La conversión es exacta y se aplica en un solo sitio (`mmToPt`),
 * tanto al tamaño de página como a cada coordenada. Un A4 sale de 595.276 ×
 * 841.890 puntos, que es su definición.
 *
 * ── Sobre el eje Y ─────────────────────────────────────────────────────────
 *
 * A diferencia de SVG, el sistema de coordenadas de PDF tiene el ORIGEN ABAJO
 * A LA IZQUIERDA y la Y hacia arriba — el mismo convenio que el modelo. No hay
 * inversión que aplicar, y eso elimina toda una clase de errores de espejo que
 * sí hay que vigilar en la salida SVG.
 */
export async function drawingToPdf(
  drawing: Drawing,
  format: PageFormat,
  options: ExportOptions = {},
): Promise<Uint8Array> {
  const margin = options.marginMm ?? DEFAULT_MARGIN_MM;
  const tiling = tilePages(drawing.bounds, format, options);

  const document = await PDFDocument.create();
  document.setTitle(drawing.title);
  document.setCreator('Costura Inteligente');

  const font = await document.embedFont(StandardFonts.Helvetica);

  const pageHeightMm =
    format.heightMm > 0 ? format.heightMm : tiling.printableHeight + margin * 2;

  for (const page of tiling.pages) {
    const pdfPage = document.addPage([mmToPt(format.widthMm), mmToPt(pageHeightMm)]);

    const items: DrawItem[] = [
      ...drawing.items.filter((item) => itemIntersectsWindow(item, page.window)),
      ...registrationItems(page, tiling),
    ];

    for (const item of items) {
      if (item.kind === 'path') drawPath(pdfPage, item, page, margin);
      else drawLabel(pdfPage, item, page, margin, font);
    }
  }

  return document.save();
}

type PdfPage = ReturnType<PDFDocument['addPage']>;
type PdfFont = Awaited<ReturnType<PDFDocument['embedFont']>>;

/**
 * Traslada un punto del documento a la página.
 *
 * La ventana de la página se sitúa dentro del papel dejando el margen, y la Y
 * no se invierte porque PDF ya la tiene hacia arriba.
 */
const project = (
  point: { x: number; y: number },
  page: PageWindow,
  margin: number,
): { x: number; y: number } => ({
  x: mmToPt(point.x - page.window.min.x + margin),
  y: mmToPt(point.y - page.window.min.y + margin),
});

function drawPath(
  pdfPage: PdfPage,
  item: DrawPath,
  page: PageWindow,
  margin: number,
): void {
  const style = STYLES[item.style];
  const color = rgb(style.grey, style.grey, style.grey);

  /*
   * Se dibuja segmento a segmento con `drawLine` en lugar de construir un
   * trazado. `drawSvgPath` interpretaría las coordenadas con la Y hacia abajo y
   * obligaría a una segunda inversión, que es justo el tipo de conversión doble
   * donde se cuelan los errores de espejo. Aplanar y trazar rectas es más
   * verboso pero no admite ambigüedad.
   */
  for (const segment of flatten(item.segments)) {
    const start = project(segment.a, page, margin);
    const end = project(segment.b, page, margin);

    pdfPage.drawLine({
      start,
      end,
      thickness: mmToPt(style.width),
      color,
      ...(style.dash === undefined ? {} : { dashArray: style.dash.map(mmToPt) }),
    });
  }
}

function drawLabel(
  pdfPage: PdfPage,
  item: Extract<DrawItem, { kind: 'text' }>,
  page: PageWindow,
  margin: number,
  font: PdfFont,
): void {
  const size = mmToPt(item.sizeMm);
  const width = font.widthOfTextAtSize(item.text, size);

  const offset = item.anchor === 'middle' ? -width / 2 : item.anchor === 'end' ? -width : 0;
  const at = project(item.at, page, margin);

  pdfPage.drawText(item.text, {
    x: at.x + offset,
    y: at.y,
    size,
    font,
    color: rgb(0, 0, 0),
    ...(item.angle === 0 ? {} : { rotate: degrees(item.angle) }),
  });
}

interface FlatSegment {
  readonly a: { readonly x: number; readonly y: number };
  readonly b: { readonly x: number; readonly y: number };
}

/** Tolerancia de aplanado para impresión, en mm. Un quinto de la resolución útil. */
const PRINT_TOLERANCE_MM = 0.05;

function flatten(segments: readonly Segment[]): FlatSegment[] {
  const out: FlatSegment[] = [];

  for (const segment of segments) {
    if (segment.kind === 'line') {
      out.push({ a: segment.a, b: segment.b });
      continue;
    }

    const cubics: CubicSeg[] = segment.kind === 'cubic' ? [segment] : arcToCubics(segment);

    for (const cubic of cubics) {
      const points = flattenCubic(cubic);
      for (let i = 0; i + 1 < points.length; i++) {
        const a = points[i];
        const b = points[i + 1];
        if (a === undefined || b === undefined) continue;
        out.push({ a, b });
      }
    }
  }

  return out;
}

function flattenCubic(cubic: CubicSeg): { x: number; y: number }[] {
  const start = segmentStart(cubic);
  const chord = Math.hypot(cubic.p3.x - start.x, cubic.p3.y - start.y);
  const steps = Math.max(4, Math.ceil(Math.sqrt(chord / PRINT_TOLERANCE_MM)));

  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    points.push({
      x:
        u * u * u * cubic.p0.x +
        3 * u * u * t * cubic.p1.x +
        3 * u * t * t * cubic.p2.x +
        t * t * t * cubic.p3.x,
      y:
        u * u * u * cubic.p0.y +
        3 * u * u * t * cubic.p1.y +
        3 * u * t * t * cubic.p2.y +
        t * t * t * cubic.p3.y,
    });
  }

  return points;
}

export type { TilingResult };
