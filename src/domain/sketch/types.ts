import type { Brand } from '@core/brand';
import type { Vec2 } from '@core/geometry/vec2';

export type PointId = Brand<string, 'PointId'>;
export type LineId = Brand<string, 'LineId'>;

/**
 * Punto del boceto.
 *
 * En la Fase 4 este tipo se convertirá en el resultado de un paso de
 * construcción del DAG paramétrico. La identidad estable (`id`) ya está aquí
 * porque es lo que permitirá adjuntarle overrides manuales sin perderlos al
 * regenerar (AVISO 2 de docs/ARCHITECTURE.md).
 */
export interface SketchPoint {
  readonly id: PointId;
  /** Posición en coordenadas de mundo, milímetros. */
  readonly p: Vec2;
  readonly label?: string;
}

/**
 * Línea del boceto.
 *
 * Referencia sus extremos POR IDENTIDAD, no por coordenadas. Es la decisión D5
 * aplicada en pequeño: mover un punto arrastra consigo todas las líneas que lo
 * comparten, y borrar un punto no puede dejar líneas colgando.
 */
export interface SketchLine {
  readonly id: LineId;
  readonly a: PointId;
  readonly b: PointId;
}

export interface SketchDocument {
  readonly points: readonly SketchPoint[];
  readonly lines: readonly SketchLine[];
}

/** Referencia a una entidad cualquiera del boceto, discriminada por tipo. */
export type EntityRef =
  | { readonly kind: 'point'; readonly id: PointId }
  | { readonly kind: 'line'; readonly id: LineId };

export const pointRef = (id: PointId): EntityRef => ({ kind: 'point', id });
export const lineRef = (id: LineId): EntityRef => ({ kind: 'line', id });

export const refEquals = (a: EntityRef, b: EntityRef): boolean =>
  a.kind === b.kind && a.id === b.id;

/** Clave estable para usar en `Set`/`Map` y como `key` de React. */
export const refKey = (ref: EntityRef): string => `${ref.kind}:${ref.id}`;
