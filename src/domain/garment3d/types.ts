import type { Vec2 } from '@core/geometry/vec2';
import type { Vec3 } from '@domain/avatar/types';
import type { EdgeId, PieceId } from '@domain/pattern/types';

/**
 * Panel: una pieza del patrón convertida en malla.
 *
 * ── Las coordenadas UV son las del PATRÓN ──────────────────────────────────
 *
 * No hay que calcularlas ni desplegar nada: la posición 2D de cada vértice en
 * el patrón ES su coordenada de textura, exacta y sin distorsión. Es una
 * propiedad elegante de este diseño —el patrón plano es, por definición, el
 * despliegue de la prenda— y tiene una consecuencia práctica: un estampado o
 * una raya salen alineados al hilo por construcción, sin ajustar nada.
 */
export interface PanelMesh {
  readonly piece: PieceId;
  /** Instancia: una pieza al doblez produce dos, reflejada la segunda. */
  readonly instance: number;
  readonly mirrored: boolean;

  /** Posición en el espacio de la escena, en mm. Tres flotantes por vértice. */
  readonly positions: Float32Array;
  /** Coordenada en el PATRÓN, en mm. Dos flotantes por vértice. */
  readonly uv: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;

  /** Índices de los vértices del contorno, por arista. */
  readonly boundary: ReadonlyMap<EdgeId, readonly number[]>;
  readonly vertexCount: number;
}

/**
 * Emparejamiento de vértices entre dos paneles que se cosen.
 *
 * Es lo que consumirá el solver de la Fase 13 para cerrar la prenda. Cada
 * pareja es una restricción de distancia que tiende a cero.
 */
export interface SeamLink {
  readonly seam: string;
  readonly panelA: number;
  readonly panelB: number;
  /** Índices dentro de `panelA`, en orden de cosido. */
  readonly verticesA: readonly number[];
  /** Índices dentro de `panelB`, emparejados uno a uno con los anteriores. */
  readonly verticesB: readonly number[];
}

export interface MeshQuality {
  readonly triangleCount: number;
  readonly vertexCount: number;
  /** Ángulo mínimo de toda la malla, en grados. */
  readonly minAngleDeg: number;
  /**
   * Ángulo mínimo EXCLUYENDO los triángulos apoyados en una esquina aguda del
   * patrón. Ver la nota de `triangulate.ts`: el vértice de una pinza es un pico
   * de pocos grados y ninguna triangulación puede mejorarlo.
   */
  readonly minInteriorAngleDeg: number;
  readonly meanEdgeMm: number;
  readonly degenerateCount: number;
}

export interface GarmentMesh {
  readonly panels: readonly PanelMesh[];
  readonly seams: readonly SeamLink[];
  readonly quality: MeshQuality;
  readonly warnings: readonly string[];
}

/** Colocación de una pieza alrededor del cuerpo, antes de simular. */
export interface PanelPlacement {
  /** Giro alrededor del eje vertical. 0 mira al frente, π a la espalda. */
  readonly azimuth: number;
  /** Distancia al eje del cuerpo. */
  readonly radiusMm: number;
  /** Altura de la escena en la que se sitúa el `y = 0` del patrón. */
  readonly originHeightMm: number;
  /** Desplazamiento tangencial, para separar izquierda y derecha. */
  readonly offsetMm: number;
  /** Si la instancia es el reflejo de una pieza al doblez. */
  readonly mirrored: boolean;
}

export interface BuildOptions {
  /** Arista objetivo de la malla, en mm. Controla la densidad. */
  readonly targetEdgeMm?: number;
  /** Tolerancia de aplanado de las curvas del contorno, en mm. */
  readonly toleranceMm?: number;
}

export const DEFAULT_TARGET_EDGE_MM = 18;

export type { Vec2, Vec3 };
