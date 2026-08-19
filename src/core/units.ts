/**
 * Unidades del sistema — decisión D3 de docs/ARCHITECTURE.md.
 *
 * El modelo trabaja SIEMPRE en milímetros, con `number` (float64). Los píxeles
 * existen únicamente en la capa de presentación, y sólo el módulo `viewport`
 * conoce la conversión entre ambos mundos.
 *
 * `PX_PER_MM` usa la referencia CSS de 96 px por pulgada. La consecuencia es el
 * criterio de salida de la Fase 1: a zoom 1.0, un segmento que el modelo dice
 * que mide 100 mm ocupa 100 mm físicos en una pantalla estándar.
 */

export const MM_PER_INCH = 25.4;
export const CSS_PX_PER_INCH = 96;

/** Píxeles CSS por milímetro a zoom 1.0. ≈ 3.779528 */
export const PX_PER_MM = CSS_PX_PER_INCH / MM_PER_INCH;

export const mmToCm = (mm: number): number => mm / 10;
export const cmToMm = (cm: number): number => cm * 10;
export const mmToInch = (mm: number): number => mm / MM_PER_INCH;
export const inchToMm = (inch: number): number => inch * MM_PER_INCH;

/** Unidad de presentación. El modelo no la usa nunca. */
export type DisplayUnit = 'mm' | 'cm' | 'in';

export function toDisplayUnit(mm: number, unit: DisplayUnit): number {
  switch (unit) {
    case 'mm':
      return mm;
    case 'cm':
      return mmToCm(mm);
    case 'in':
      return mmToInch(mm);
  }
}

export function fromDisplayUnit(value: number, unit: DisplayUnit): number {
  switch (unit) {
    case 'mm':
      return value;
    case 'cm':
      return cmToMm(value);
    case 'in':
      return inchToMm(value);
  }
}

const DEFAULT_DECIMALS: Record<DisplayUnit, number> = { mm: 1, cm: 2, in: 3 };

/** Formatea una longitud en milímetros para mostrarla en la unidad indicada. */
export function formatLength(mm: number, unit: DisplayUnit = 'mm', decimals?: number): string {
  const digits = decimals ?? DEFAULT_DECIMALS[unit];
  return `${toDisplayUnit(mm, unit).toFixed(digits)} ${unit}`;
}
