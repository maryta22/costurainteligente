import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';

import { rectHeight, rectWidth } from '@core/geometry/rect';
import { evaluateParameters } from '@core/parametric/evaluate';

import { easeProfile } from '@domain/measurements/ease';
import { buildInputScope } from '@domain/measurements/scope';
import { standardMeasurements } from '@domain/measurements/standard';
import { BLOCK_PARAMETERS } from '@domain/pattern/blockParameters';
import type { GarmentId } from '@domain/pattern/generators';
import { AVAILABLE_GARMENTS, generateGarment } from '@domain/pattern/generators';

import { boundsOf, buildDrawing } from '@export/drawing';
import { drawingToPdf } from '@export/pdf';
import { drawingToSvg } from '@export/svg';
import { itemIntersectsWindow, tilePages } from '@export/tiling';
import type { PageFormat } from '@export/types';
import { A4, CALIBRATION_SIZE_MM, PAGE_FORMATS, PT_PER_MM } from '@export/types';

function pieces(garment: GarmentId = 'skirt') {
  const evaluation = evaluateParameters(
    BLOCK_PARAMETERS,
    buildInputScope(standardMeasurements('M'), easeProfile('semi-fitted')),
  );

  const result = generateGarment(garment, { values: evaluation.values, overrides: new Map() });
  if (result === null) throw new Error('sin generador');

  return result.pieces;
}

const A3: PageFormat = { id: 'a3', name: 'A3', widthMm: 297, heightMm: 420 };

describe('construcción del dibujo', () => {
  it('produce trazos de todos los tipos esperados', () => {
    const drawing = buildDrawing(pieces('dress'));
    const styles = new Set(
      drawing.items.filter((item) => item.kind === 'path').map((item) => item.style),
    );

    expect(styles).toContain('seam');
    expect(styles).toContain('cut');
    expect(styles).toContain('fold');
    expect(styles).toContain('dart');
    expect(styles).toContain('notch');
    expect(styles).toContain('grain');
  });

  it('respeta las opciones de contenido', () => {
    const minimal = buildDrawing(pieces(), {
      includeCutLine: false,
      includeNotches: false,
      includeGrainLine: false,
      includeLabels: false,
      includeCalibration: false,
    });

    const styles = new Set(
      minimal.items.filter((item) => item.kind === 'path').map((item) => item.style),
    );

    expect(styles).not.toContain('cut');
    expect(styles).not.toContain('notch');
    expect(styles).not.toContain('grain');
    expect(minimal.items.some((item) => item.kind === 'text')).toBe(false);
  });

  /*
   * Todo lo que se exporta es DERIVADO: la línea de corte se recalcula a partir
   * de los márgenes en el momento de exportar. Nunca se lee geometría
   * almacenada que pudiera haber quedado desactualizada.
   */
  it('la línea de corte cambia si cambia el margen', () => {
    const base = pieces();
    const widened = base.map((piece) => ({
      ...piece,
      edges: piece.edges.map((edge) =>
        edge.onFold ? edge : { ...edge, seamAllowance: edge.seamAllowance + 20 },
      ),
    }));

    const before = buildDrawing(base, { includeCalibration: false });
    const after = buildDrawing(widened, { includeCalibration: false });

    expect(rectWidth(after.bounds)).toBeGreaterThan(rectWidth(before.bounds));
  });

  it('la envolvente contiene todo el contenido', () => {
    const drawing = buildDrawing(pieces('blouse'));
    const content = boundsOf(drawing.items);

    expect(content).not.toBeNull();
    if (content === null) return;

    expect(content.min.x).toBeGreaterThanOrEqual(drawing.bounds.min.x);
    expect(content.max.x).toBeLessThanOrEqual(drawing.bounds.max.x);
    expect(content.min.y).toBeGreaterThanOrEqual(drawing.bounds.min.y);
    expect(content.max.y).toBeLessThanOrEqual(drawing.bounds.max.y);
  });
});

describe('CRITERIO DE SALIDA — escala real', () => {
  /*
   * MITIGACIÓN DEL RIESGO R6.
   *
   * Los controladores de impresión ajustan al área imprimible por defecto. Una
   * reducción del 4 % es invisible en la vista previa y arruina el patrón: la
   * prenda sale una talla pequeña sin que nada avise. El cuadrado de
   * comprobación convierte ese fallo silencioso en una comprobación de tres
   * segundos con una regla.
   */
  it('el cuadrado de comprobación mide exactamente 100 mm', () => {
    const drawing = buildDrawing(pieces());
    const frame = drawing.items.find(
      (item) => item.kind === 'path' && item.style === 'frame',
    );

    expect(frame).toBeDefined();
    if (frame === undefined || frame.kind !== 'path') return;

    const box = boundsOf([frame]);
    expect(box).not.toBeNull();
    if (box === null) return;

    expect(rectWidth(box)).toBeCloseTo(CALIBRATION_SIZE_MM, 9);
    expect(rectHeight(box)).toBeCloseTo(CALIBRATION_SIZE_MM, 9);
  });

  it('lleva la instrucción de imprimir al 100 %', () => {
    const drawing = buildDrawing(pieces());
    const texts = drawing.items.filter((item) => item.kind === 'text').map((item) => item.text);

    expect(texts.some((text) => text.includes('100 mm'))).toBe(true);
    expect(texts.some((text) => text.includes('100 %'))).toBe(true);
  });

  /*
   * LA GARANTÍA DE ESCALA EN SVG.
   *
   * Depende de que dos atributos sean coherentes: `width`/`height` en
   * MILÍMETROS y un `viewBox` con los mismos números. Con eso, una unidad de
   * usuario es un milímetro por definición.
   */
  it('el SVG declara sus dimensiones en milímetros y el viewBox coincide', () => {
    const drawing = buildDrawing(pieces());
    const svg = drawingToSvg(drawing);

    const width = /width="([\d.]+)mm"/.exec(svg);
    const height = /height="([\d.]+)mm"/.exec(svg);
    const viewBox = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);

    expect(width).not.toBeNull();
    expect(height).not.toBeNull();
    expect(viewBox).not.toBeNull();
    if (width === null || height === null || viewBox === null) return;

    expect(Number(viewBox[1])).toBeCloseTo(Number(width[1]), 6);
    expect(Number(viewBox[2])).toBeCloseTo(Number(height[1]), 6);

    // Y esas dimensiones son las del dibujo, sin ajuste alguno.
    expect(Number(width[1])).toBeCloseTo(rectWidth(drawing.bounds), 3);
  });

  it('el SVG es XML bien formado y con fondo blanco', () => {
    const svg = drawingToSvg(buildDrawing(pieces()));

    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect((svg.match(/<g /g) ?? []).length).toBe((svg.match(/<\/g>/g) ?? []).length);
    expect(svg).toContain('fill="#ffffff"');
  });

  /*
   * LA GARANTÍA DE ESCALA EN PDF.
   *
   * PDF mide en puntos PostScript: 72 por pulgada. Un A4 son 595.276 × 841.890
   * puntos exactos, y esa es su definición — no una aproximación.
   */
  it('las páginas del PDF tienen el tamaño exacto del formato', async () => {
    for (const format of [A4, A3]) {
      const bytes = await drawingToPdf(buildDrawing(pieces()), format);
      const document = await PDFDocument.load(bytes);

      const page = document.getPage(0);
      expect(page.getWidth()).toBeCloseTo(format.widthMm * PT_PER_MM, 6);
      expect(page.getHeight()).toBeCloseTo(format.heightMm * PT_PER_MM, 6);
    }

    // Para el A4: 210 mm × 72/25.4 = 595.2755… puntos.
    const bytes = await drawingToPdf(buildDrawing(pieces()), A4);
    const document = await PDFDocument.load(bytes);
    expect(document.getPage(0).getWidth()).toBeCloseTo(595.2756, 3);
    expect(document.getPage(0).getHeight()).toBeCloseTo(841.8898, 3);
  });

  it('la conversión a puntos es exacta', () => {
    expect(PT_PER_MM * 25.4).toBeCloseTo(72, 12);
    expect(100 * PT_PER_MM).toBeCloseTo(283.46456692913387, 9);
  });
});

describe('teselado en páginas', () => {
  it('una página basta si el contenido cabe', () => {
    const small = { min: { x: 0, y: 0 }, max: { x: 100, y: 100 } };
    const tiling = tilePages(small, A4);

    expect(tiling.pages).toHaveLength(1);
    expect(tiling.rows).toBe(1);
    expect(tiling.columns).toBe(1);
  });

  /*
   * Las páginas se SOLAPAN a propósito. Si encajaran justo, montarlas exigiría
   * cortar exactamente por el borde y unir a tope: un milímetro de desvío por
   * junta se acumula y a las diez páginas el patrón mide un centímetro de más.
   */
  it('las páginas contiguas se solapan lo declarado', () => {
    const wide = { min: { x: 0, y: 0 }, max: { x: 900, y: 200 } };
    const tiling = tilePages(wide, A4, { marginMm: 10, overlapMm: 10 });

    expect(tiling.columns).toBeGreaterThan(1);

    const first = tiling.pages.find((page) => page.column === 1);
    const second = tiling.pages.find((page) => page.column === 2);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;

    expect(first.window.max.x - second.window.min.x).toBeCloseTo(10, 9);
  });

  /*
   * La comprobación que importa: entre todas las páginas se cubre el documento
   * entero. Una esquina que no cayera en ninguna página desaparecería del
   * patrón impreso sin que nada avisara.
   */
  it('las páginas cubren todo el documento', () => {
    for (const format of [A4, A3]) {
      const drawing = buildDrawing(pieces('dress'));
      const tiling = tilePages(drawing.bounds, format);

      const covered = {
        minX: Math.min(...tiling.pages.map((page) => page.window.min.x)),
        maxX: Math.max(...tiling.pages.map((page) => page.window.max.x)),
        minY: Math.min(...tiling.pages.map((page) => page.window.min.y)),
        maxY: Math.max(...tiling.pages.map((page) => page.window.max.y)),
      };

      expect(covered.minX).toBeLessThanOrEqual(drawing.bounds.min.x + 1e-6);
      expect(covered.maxX).toBeGreaterThanOrEqual(drawing.bounds.max.x - 1e-6);
      expect(covered.minY).toBeLessThanOrEqual(drawing.bounds.min.y + 1e-6);
      expect(covered.maxY).toBeGreaterThanOrEqual(drawing.bounds.max.y - 1e-6);
    }
  });

  it('cada primitiva del dibujo cae en alguna página', () => {
    const drawing = buildDrawing(pieces('blouse'));
    const tiling = tilePages(drawing.bounds, A4);

    for (const item of drawing.items) {
      const found = tiling.pages.some((page) => itemIntersectsWindow(item, page.window));
      expect(found).toBe(true);
    }
  });

  it('un formato mayor necesita menos páginas', () => {
    const drawing = buildDrawing(pieces('dress'));

    const inA4 = tilePages(drawing.bounds, A4).pages.length;
    const inA1 = tilePages(drawing.bounds, {
      id: 'a1',
      name: 'A1',
      widthMm: 594,
      heightMm: 841,
    }).pages.length;

    expect(inA1).toBeLessThan(inA4);
  });

  /*
   * Un rollo de plóter no tiene alto: se declara con `heightMm = 0` y el
   * documento sale en una sola tira continua, sin juntas horizontales.
   */
  it('el plóter produce una sola fila', () => {
    const drawing = buildDrawing(pieces('dress'));
    const roll = PAGE_FORMATS.find((format) => format.id === 'plotter-914');

    expect(roll).toBeDefined();
    if (roll === undefined) return;

    const tiling = tilePages(drawing.bounds, roll);
    expect(tiling.rows).toBe(1);
  });

  it('las filas se numeran de arriba abajo', () => {
    const tall = { min: { x: 0, y: 0 }, max: { x: 100, y: 1200 } };
    const tiling = tilePages(tall, A4);

    expect(tiling.rows).toBeGreaterThan(1);

    const first = tiling.pages.find((page) => page.row === 1);
    const last = tiling.pages.find((page) => page.row === tiling.rows);
    if (first === undefined || last === undefined) return;

    expect(first.window.max.y).toBeGreaterThan(last.window.max.y);
  });
});

describe('PDF generado', () => {
  it('produce un documento con tantas páginas como el teselado', async () => {
    const drawing = buildDrawing(pieces('dress'));
    const tiling = tilePages(drawing.bounds, A4);

    const bytes = await drawingToPdf(drawing, A4);
    const document = await PDFDocument.load(bytes);

    expect(document.getPageCount()).toBe(tiling.pages.length);
  });

  it('lleva título y no está vacío', async () => {
    const bytes = await drawingToPdf(buildDrawing(pieces(), { title: 'Falda M' }), A4);
    const document = await PDFDocument.load(bytes);

    expect(document.getTitle()).toBe('Falda M');
    expect(bytes.byteLength).toBeGreaterThan(2000);
  });

  it('exporta las tres prendas sin fallar', async () => {
    for (const garment of AVAILABLE_GARMENTS) {
      const bytes = await drawingToPdf(buildDrawing(pieces(garment)), A4);
      const document = await PDFDocument.load(bytes);

      expect(document.getPageCount()).toBeGreaterThan(0);
    }
  });
});
