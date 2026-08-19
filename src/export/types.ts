import type { Rect } from '@core/geometry/rect';
import type { Segment } from '@core/geometry/segment';
import type { Vec2 } from '@core/geometry/vec2';

/**
 * Papel de cada trazo en el documento impreso.
 *
 * No es una clase CSS: es una intención. Cada formato de salida decide cómo la
 * representa —grosor, discontinuidad, color— porque un plóter, una impresora
 * doméstica y una máquina de corte no entienden lo mismo por «línea de corte».
 */
export type DrawStyle =
  | 'seam'
  | 'cut'
  | 'fold'
  | 'dart'
  | 'notch'
  | 'grain'
  | 'guide'
  | 'frame';

export interface DrawPath {
  readonly kind: 'path';
  readonly style: DrawStyle;
  /** Geometría en coordenadas de DOCUMENTO: milímetros, Y hacia arriba. */
  readonly segments: readonly Segment[];
  readonly closed: boolean;
}

export interface DrawText {
  readonly kind: 'text';
  readonly text: string;
  readonly at: Vec2;
  /** Altura de la letra en milímetros. */
  readonly sizeMm: number;
  readonly anchor: 'start' | 'middle' | 'end';
  /** Rotación en grados, antihoraria. */
  readonly angle: number;
}

export type DrawItem = DrawPath | DrawText;

/**
 * Documento listo para imprimir, independiente del formato de salida.
 *
 * ── Por qué una representación intermedia ──────────────────────────────────
 *
 * SVG, PDF y —en la Fase 14— DXF necesitan la misma geometría escrita de tres
 * maneras distintas. Sin este paso, cada exportador tendría que recorrer las
 * piezas, calcular sus líneas de corte, resolver los piquetes y colocar las
 * etiquetas por su cuenta: tres copias de la misma lógica que divergirían a la
 * primera corrección.
 *
 * Aquí la conversión de patrón a dibujo ocurre UNA vez, y cada exportador sólo
 * traduce primitivas.
 */
export interface Drawing {
  readonly title: string;
  readonly items: readonly DrawItem[];
  /** Envolvente del contenido, en milímetros. */
  readonly bounds: Rect;
}

export interface PageFormat {
  readonly id: string;
  readonly name: string;
  readonly widthMm: number;
  readonly heightMm: number;
}

/**
 * Formatos de papel, en milímetros.
 *
 * La serie A no es arbitraria: cada formato es el anterior partido por la mitad
 * del lado largo, con una relación de √2 que se conserva al doblar. Por eso un
 * patrón teselado en A4 se puede reimprimir en A3 sin rehacer el teselado.
 */
export const PAGE_FORMATS: readonly PageFormat[] = [
  { id: 'a4', name: 'A4', widthMm: 210, heightMm: 297 },
  { id: 'a4-landscape', name: 'A4 apaisado', widthMm: 297, heightMm: 210 },
  { id: 'a3', name: 'A3', widthMm: 297, heightMm: 420 },
  { id: 'a2', name: 'A2', widthMm: 420, heightMm: 594 },
  { id: 'a1', name: 'A1', widthMm: 594, heightMm: 841 },
  { id: 'a0', name: 'A0', widthMm: 841, heightMm: 1189 },
  { id: 'letter', name: 'Carta', widthMm: 215.9, heightMm: 279.4 },
  /** Rollo de plóter de 914 mm (36 pulgadas). El alto se ajusta al contenido. */
  { id: 'plotter-914', name: 'Plóter 914 mm', widthMm: 914, heightMm: 0 },
];

export const findPageFormat = (id: string): PageFormat | undefined =>
  PAGE_FORMATS.find((format) => format.id === id);

export const A4: PageFormat = { id: 'a4', name: 'A4', widthMm: 210, heightMm: 297 };

export interface ExportOptions {
  readonly title?: string;
  /** Margen no imprimible del papel, en mm. */
  readonly marginMm?: number;
  /** Solape entre páginas contiguas, en mm. */
  readonly overlapMm?: number;
  readonly includeSeamLine?: boolean;
  readonly includeCutLine?: boolean;
  readonly includeNotches?: boolean;
  readonly includeGrainLine?: boolean;
  readonly includeLabels?: boolean;
  /** Cuadrado de comprobación de escala. */
  readonly includeCalibration?: boolean;
  /** Tolerancia de aplanado de curvas, en mm. */
  readonly toleranceMm?: number;
}

export const DEFAULT_MARGIN_MM = 10;
export const DEFAULT_OVERLAP_MM = 10;

/**
 * Lado del cuadrado de comprobación, en milímetros.
 *
 * Cien milímetros es la magnitud correcta: suficiente para que un error de
 * escala del 1 % —un milímetro— se vea con una regla corriente, y lo bastante
 * pequeño para caber en un A4 junto al resto.
 */
export const CALIBRATION_SIZE_MM = 100;

/** Puntos PostScript por milímetro. 72 puntos por pulgada. */
export const PT_PER_MM = 72 / 25.4;
