import type { BodyMeasurements } from './types';

/**
 * Tallas del MVP.
 *
 * En la Fase 8 dejarán de ser una lista cerrada: se derivarán de una talla base
 * más un salto de grading. Por ahora son tablas explícitas, que es lo que
 * permite empezar a trazar sin haber resuelto todavía el escalado.
 */
export type SizeCode = 'XS' | 'S' | 'M' | 'L' | 'XL';

export const SIZE_CODES: readonly SizeCode[] = ['XS', 'S', 'M', 'L', 'XL'];

/**
 * Tabla de medidas estándar, en milímetros.
 *
 * Valores aproximados de talla europea de mujer. NO sustituyen a las medidas
 * reales de una persona: sirven de punto de partida y de referencia para el
 * grading. Cualquier prenda que vaya a ponerse alguien concreto se traza con
 * sus medidas, no con estas.
 *
 * Los saltos entre tallas son los habituales del sector: 40 mm en los
 * contornos de pecho y cadera, 40 en cintura, y saltos pequeños en los largos,
 * porque la estatura varía mucho menos que el volumen entre tallas contiguas.
 */
export const STANDARD_SIZES: Readonly<Record<SizeCode, BodyMeasurements>> = {
  XS: {
    height: 1640,
    bust: 800,
    underbust: 680,
    waist: 620,
    hip: 860,
    neck: 340,
    shoulderLength: 116,
    backWidth: 330,
    bustSpan: 165,
    napeToWaist: 388,
    frontWaistLength: 410,
    bustHeight: 240,
    waistToHip: 195,
    waistToKnee: 570,
    waistToFloor: 1000,
    armholeDepth: 190,
    armLength: 570,
    bicep: 250,
    wrist: 148,
  },
  S: {
    height: 1650,
    bust: 840,
    underbust: 720,
    waist: 660,
    hip: 900,
    neck: 350,
    shoulderLength: 119,
    backWidth: 340,
    bustSpan: 172,
    napeToWaist: 394,
    frontWaistLength: 418,
    bustHeight: 248,
    waistToHip: 198,
    waistToKnee: 578,
    waistToFloor: 1010,
    armholeDepth: 196,
    armLength: 578,
    bicep: 265,
    wrist: 153,
  },
  M: {
    height: 1660,
    bust: 880,
    underbust: 760,
    waist: 700,
    hip: 940,
    neck: 360,
    shoulderLength: 122,
    backWidth: 350,
    bustSpan: 179,
    napeToWaist: 400,
    frontWaistLength: 426,
    bustHeight: 256,
    waistToHip: 201,
    waistToKnee: 586,
    waistToFloor: 1020,
    armholeDepth: 202,
    armLength: 586,
    bicep: 280,
    wrist: 158,
  },
  L: {
    height: 1670,
    bust: 930,
    underbust: 810,
    waist: 750,
    hip: 990,
    neck: 372,
    shoulderLength: 126,
    backWidth: 362,
    bustSpan: 187,
    napeToWaist: 407,
    frontWaistLength: 436,
    bustHeight: 266,
    waistToHip: 205,
    waistToKnee: 594,
    waistToFloor: 1030,
    armholeDepth: 209,
    armLength: 594,
    bicep: 298,
    wrist: 164,
  },
  XL: {
    height: 1680,
    bust: 980,
    underbust: 860,
    waist: 800,
    hip: 1040,
    neck: 384,
    shoulderLength: 130,
    backWidth: 374,
    bustSpan: 195,
    napeToWaist: 414,
    frontWaistLength: 446,
    bustHeight: 276,
    waistToHip: 209,
    waistToKnee: 602,
    waistToFloor: 1040,
    armholeDepth: 216,
    armLength: 602,
    bicep: 316,
    wrist: 170,
  },
};

export const standardMeasurements = (size: SizeCode): BodyMeasurements => STANDARD_SIZES[size];

export const DEFAULT_SIZE: SizeCode = 'M';
