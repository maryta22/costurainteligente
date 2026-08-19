import type { Brand } from '@core/brand';
import type { Contour } from '@core/geometry/contour';
import type { Mat3 } from '@core/geometry/mat3';
import type { Vec2 } from '@core/geometry/vec2';

export type PieceId = Brand<string, 'PieceId'>;
export type EdgeId = Brand<string, 'EdgeId'>;
export type SeamId = Brand<string, 'SeamId'>;
export type NotchId = Brand<string, 'NotchId'>;

/**
 * Papel de una arista dentro de la prenda.
 *
 * No es una etiqueta decorativa: de él dependen el margen por defecto, con qué
 * otra arista se empareja al construir el grafo de costuras y, más adelante, la
 * rigidez que el solver aplicará a esa costura. Un `'other'` que se cuela en un
 * generador es una arista que nadie sabrá coser.
 */
export type EdgeRole =
  | 'shoulder'
  | 'armhole'
  | 'sleeve-cap'
  | 'underarm'
  | 'side'
  | 'waist'
  | 'hip'
  | 'hem'
  | 'neckline'
  | 'center-front'
  | 'center-back'
  | 'dart'
  | 'other';

/**
 * Márgenes de costura por defecto, en milímetros.
 *
 * Son valores de taller, no arbitrarios. Las curvas cerradas —escote, sisa—
 * llevan poco margen porque uno ancho no puede tumbarse sin fruncir al girar.
 * Los costados llevan más para permitir ajustes en la prueba. Los bajos llevan
 * mucho porque se doblan sobre sí mismos.
 */
export const DEFAULT_SEAM_ALLOWANCE_MM: Readonly<Record<EdgeRole, number>> = {
  shoulder: 10,
  armhole: 10,
  'sleeve-cap': 10,
  underarm: 10,
  side: 15,
  waist: 10,
  hip: 15,
  hem: 40,
  neckline: 6,
  'center-front': 15,
  'center-back': 20,
  dart: 0,
  other: 10,
};

/**
 * Arista con nombre: un tramo con identidad del contorno de la pieza.
 *
 * Es la materialización de la decisión D5 de docs/ARCHITECTURE.md, y la
 * diferencia entre un dibujo y un modelo. Sin identidad de arista no hay grafo
 * de costuras —y por tanto no hay prenda en 3D—, los piquetes no sobreviven a
 * un cambio de medidas y el grading no sabe qué está escalando.
 *
 * La geometría NO se duplica: la arista referencia un rango de segmentos del
 * contorno de la pieza. Las aristas forman una PARTICIÓN de ese contorno —lo
 * cubren entero, sin solapes ni huecos— y `validatePiece` lo comprueba.
 */
export interface PatternEdge {
  readonly id: EdgeId;
  readonly role: EdgeRole;
  /** Índice del primer segmento del contorno que pertenece a la arista. */
  readonly startSegment: number;
  /** Cuántos segmentos consecutivos abarca. Siempre ≥ 1. */
  readonly segmentCount: number;
  /** Margen de costura, en mm. Cero es válido: una línea de doblez no lo lleva. */
  readonly seamAllowance: number;
  /** Si va al doblez de la tela: no se corta ni lleva margen. */
  readonly onFold: boolean;
  readonly label?: string;
}

export type NotchType =
  /** Piquete simple: emparejamiento genérico. */
  | 'single'
  /** Doble: por convenio marca la espalda, para no montar una manga al revés. */
  | 'double'
  /** Triple. */
  | 'triple'
  /** Extremo de pinza. */
  | 'dart-leg'
  /** Marca de doblez o de línea de plegado. */
  | 'fold'
  /** Punto de equilibrio: reparte el embebido a lo largo de la costura. */
  | 'balance';

/**
 * Piquete: marca de emparejamiento entre dos piezas.
 *
 * Se guarda como `(arista, longitud recorrida)` y NUNCA como coordenada
 * absoluta. Es lo que le permite sobrevivir a un cambio de medidas: al
 * regenerar el patrón la arista cambia de forma, pero «a 120 mm del hombro»
 * sigue significando lo mismo.
 */
export interface Notch {
  readonly id: NotchId;
  readonly edge: EdgeId;
  /** Distancia recorrida desde el inicio de la arista, en mm. */
  readonly arcLength: number;
  readonly type: NotchType;
  /** Profundidad de la marca hacia el interior, en mm. */
  readonly depth: number;
}

/**
 * Línea de hilo: dirección de la urdimbre sobre la pieza.
 *
 * Pertenece al MODELO y no a la presentación porque no es una anotación. Marca
 * cómo se coloca la pieza sobre la tela y, en la Fase 13, alimentará la
 * anisotropía del solver: urdimbre, trama y bies tienen rigideces muy
 * distintas, y es la razón de que una falda al bies caiga diferente.
 */
export interface GrainLine {
  /** Origen en coordenadas LOCALES de la pieza. */
  readonly origin: Vec2;
  /** Ángulo en radianes. 90° = vertical, el caso habitual. */
  readonly angle: number;
  readonly length: number;
}

export interface PieceLabel {
  readonly text: string;
  readonly position: Vec2;
  readonly angle: number;
}

/**
 * Pieza del patrón.
 *
 * El contorno es la LÍNEA DE COSTURA, no la de corte: es la que define la
 * prenda terminada y la que debe casar con las piezas vecinas. La línea de
 * corte es geometría DERIVADA, que se calcula aplicando los márgenes.
 *
 * Guardar la línea de costura como fuente y derivar la de corte —y no al
 * revés— es lo que permite cambiar un margen sin tocar el patrón, y lo que
 * hace que las longitudes que se comparan al casar dos costuras sean las que
 * de verdad importan.
 */
export interface PatternPiece {
  readonly id: PieceId;
  readonly name: string;
  /** Línea de costura: contorno CERRADO y ANTIHORARIO, en coordenadas locales. */
  readonly contour: Contour;
  readonly edges: readonly PatternEdge[];
  readonly notches: readonly Notch[];
  readonly grainLine: GrainLine | null;
  readonly labels: readonly PieceLabel[];
  /** Colocación de las coordenadas locales en el documento. */
  readonly placement: Mat3;
  /** Cuántas veces se corta. Dos para una manga, uno para un delantero al doblez. */
  readonly cutCount: number;
}

export interface SeamEndpoint {
  readonly piece: PieceId;
  readonly edge: EdgeId;
  /**
   * Si la arista se recorre al revés al coser.
   *
   * No es un detalle: determina el orden en que se emparejan los vértices al
   * cerrar la prenda en 3D. Con el valor equivocado, las dos piezas se cosen
   * retorcidas una sobre otra.
   */
  readonly reversed: boolean;
}

/**
 * Costura: une dos aristas de dos piezas.
 *
 * El grafo que forman estas uniones lo emite el GENERADOR, no se dibuja a mano,
 * y es lo que consumirá el mallador de la Fase 11 para crear las restricciones
 * del solver.
 */
export interface Seam {
  readonly id: SeamId;
  readonly a: SeamEndpoint;
  readonly b: SeamEndpoint;
  /**
   * Embebido, en mm: cuánto más larga es `b` que `a`.
   *
   * No es una holgura accidental sino una técnica: la copa de una manga mide
   * más que su sisa a propósito, y ese exceso se reparte al coser para dar
   * volumen al hombro.
   */
  readonly ease: number;
}
