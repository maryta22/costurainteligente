import { niceStep, roundToStep } from './math';
import type { Rect } from './rect';
import type { Vec2 } from './vec2';
import { vec2 } from './vec2';

/** Ajusta un punto de mundo al múltiplo de `stepMm` más próximo. */
export function snapToGrid(p: Vec2, stepMm: number): Vec2 {
  return stepMm > 0 ? vec2(roundToStep(p.x, stepMm), roundToStep(p.y, stepMm)) : p;
}

/**
 * Elige el paso de rejilla visible en función del zoom.
 *
 * La rejilla lógica del documento tiene un paso fijo (`baseStepMm`), pero
 * dibujar todas sus líneas al alejar la vista produce una masa ilegible. Se
 * escoge el menor paso «bonito» (1, 2, 5 × 10ⁿ) cuya separación en pantalla
 * alcance `minScreenSpacingPx`, y nunca menor que el paso base.
 */
export function visibleGridStep(
  baseStepMm: number,
  pxPerMm: number,
  minScreenSpacingPx: number,
): number {
  if (pxPerMm <= 0) return baseStepMm;
  return Math.max(baseStepMm, niceStep(minScreenSpacingPx / pxPerMm));
}

/**
 * Coordenadas de las líneas de rejilla que cruzan `rect`, en mm.
 *
 * `limit` acota la cantidad devuelta para que un zoom extremo no genere
 * millones de elementos; superado el límite se devuelve una lista vacía y la
 * capa de render simplemente no dibuja rejilla.
 */
export function gridLines(rect: Rect, stepMm: number, limit = 2000): {
  readonly vertical: readonly number[];
  readonly horizontal: readonly number[];
} {
  if (stepMm <= 0) return { vertical: [], horizontal: [] };

  const firstX = Math.ceil(rect.min.x / stepMm) * stepMm;
  const firstY = Math.ceil(rect.min.y / stepMm) * stepMm;
  const countX = Math.floor((rect.max.x - firstX) / stepMm) + 1;
  const countY = Math.floor((rect.max.y - firstY) / stepMm) + 1;

  if (countX <= 0 || countY <= 0 || countX + countY > limit) {
    return { vertical: [], horizontal: [] };
  }

  const vertical: number[] = new Array<number>(countX);
  for (let i = 0; i < countX; i++) vertical[i] = firstX + i * stepMm;

  const horizontal: number[] = new Array<number>(countY);
  for (let i = 0; i < countY; i++) horizontal[i] = firstY + i * stepMm;

  return { vertical, horizontal };
}
