import type { Segment } from '@core/geometry/segment';
import { segmentEnd, segmentLength, segmentTangent } from '@core/geometry/segment';
import type { Vec2 } from '@core/geometry/vec2';
import { angleOf, distance } from '@core/geometry/vec2';

import { edgeLength, edgeSegments, findEdge, sampleEdgeByArcLength } from '@domain/pattern/edge';
import type { EdgeId, PatternEdge, PatternPiece, PieceId, Seam } from '@domain/pattern/types';

/** Número de tramos en que se divide cada arista. */
export type SampleCounts = ReadonlyMap<string, number>;

const key = (piece: PieceId, edge: EdgeId): string => `${piece}::${edge}`;

/**
 * Decide en cuántos tramos se divide cada arista.
 *
 * ── EL PASO QUE HACE POSIBLE COSER EN 3D ───────────────────────────────────
 *
 * Dos aristas que van a coserse reciben EL MISMO número de muestras, repartidas
 * por longitud de arco normalizada. Así el vértice *i* de una se empareja con
 * el vértice *i* de la otra aunque midan distinto, y la diferencia de longitud
 * —el embebido de una copa de manga, por ejemplo— queda distribuida de forma
 * uniforme a lo largo de toda la costura. Es exactamente lo que hace una
 * costurera al montar una manga.
 *
 * Si cada arista se muestreara por su cuenta, las dos listas tendrían tamaños
 * distintos y no habría forma de emparejarlas sin interpolar; y si se
 * muestrearan por parámetro de curva en vez de por longitud, la costura
 * quedaría fruncida en unos tramos y estirada en otros.
 *
 * El recuento lo fija la arista MÁS LARGA del par: así ninguna de las dos queda
 * por debajo de la resolución pedida.
 */
export function planSampleCounts(
  pieces: readonly PatternPiece[],
  seams: readonly Seam[],
  targetEdgeMm: number,
): SampleCounts {
  const byId = new Map(pieces.map((piece) => [String(piece.id), piece]));
  const counts = new Map<string, number>();

  const lengthOf = (pieceId: PieceId, edgeId: EdgeId): number => {
    const piece = byId.get(String(pieceId));
    if (piece === undefined) return 0;

    const edge = findEdge(piece, edgeId);
    return edge === undefined ? 0 : edgeLength(piece, edge);
  };

  const divisions = (length: number): number =>
    Math.max(2, Math.ceil(length / Math.max(targetEdgeMm, 1)));

  /*
   * Primero las costuras: imponen el recuento a sus dos aristas.
   *
   * Se repite hasta que nada cambia porque una arista puede participar en más
   * de una costura, y entonces el recuento que le impone una tiene que
   * propagarse a la otra. El bucle termina siempre: los recuentos sólo suben y
   * están acotados por el mayor de todos.
   */
  for (let pass = 0; pass < seams.length + 1; pass++) {
    let changed = false;

    for (const seam of seams) {
      const keyA = key(seam.a.piece, seam.a.edge);
      const keyB = key(seam.b.piece, seam.b.edge);

      const shared = Math.max(
        divisions(Math.max(lengthOf(seam.a.piece, seam.a.edge), lengthOf(seam.b.piece, seam.b.edge))),
        counts.get(keyA) ?? 0,
        counts.get(keyB) ?? 0,
      );

      if (counts.get(keyA) !== shared || counts.get(keyB) !== shared) changed = true;
      counts.set(keyA, shared);
      counts.set(keyB, shared);
    }

    if (!changed) break;
  }

  // El resto de aristas, según su propia longitud.
  for (const piece of pieces) {
    for (const edge of piece.edges) {
      const id = key(piece.id, edge.id);
      if (counts.has(id)) continue;
      counts.set(id, divisions(edgeLength(piece, edge)));
    }
  }

  return counts;
}

export interface SampledEdge {
  readonly edge: EdgeId;
  /** Puntos en coordenadas LOCALES de la pieza, del inicio al final. */
  readonly points: readonly Vec2[];
}

/**
 * Ángulo por debajo del cual la unión de dos tramos de una arista se considera
 * una ESQUINA que hay que conservar. Los tramos de una curva suave se unen casi
 * en línea recta —179 grados o más—; el vértice de una pinza forma un pico muy
 * marcado.
 */
const CORNER_THRESHOLD_DEG = 170;

/** Muestrea todas las aristas de una pieza con los recuentos acordados. */
export function sampleBoundary(piece: PatternPiece, counts: SampleCounts): SampledEdge[] {
  return piece.edges.map((edge) => {
    const count = counts.get(key(piece.id, edge.id)) ?? 8;
    const points = sampleEdgeByArcLength(piece, edge, count).map((location) => location.point);

    return { edge: edge.id, points: snapToCorners(piece, edge, points) };
  });
}

/**
 * Lleva la muestra más cercana a cada esquina interior de la arista.
 *
 * ── El vértice de una pinza no se puede redondear ──────────────────────────
 *
 * Una pinza es una arista de dos tramos que se encuentran en un pico. El
 * muestreo uniforme por longitud de arco casi nunca cae justo en ese pico:
 * deja una muestra a un lado y otra al otro, y la cuerda entre ambas corta el
 * vértice. En la malla eso aparece como un triángulo-astilla apoyado en una
 * base de un par de milímetros; en la prenda, como una pinza sin punta. Lo
 * segundo es peor que lo primero.
 *
 * ── Por qué DESPLAZAR y no INSERTAR ────────────────────────────────────────
 *
 * Insertar la esquina como muestra adicional la conservaría igual de bien, pero
 * cambiaría el número de muestras de la arista, y ese número está pactado con
 * la arista con la que se cose: romperlo desharía el emparejamiento que hace
 * posible cerrar la prenda. Desplazar una muestra que ya existía conserva el
 * recuento exacto, y el desplazamiento está acotado por medio intervalo.
 *
 * Los extremos no se tocan: son las junturas con las aristas vecinas y tienen
 * que seguir coincidiendo con ellas.
 */
function snapToCorners(piece: PatternPiece, edge: PatternEdge, points: readonly Vec2[]): Vec2[] {
  const result = [...points];
  if (result.length < 3) return result;

  const segments = edgeSegments(piece, edge);
  if (segments.length < 2) return result;

  const total = edgeLength(piece, edge);
  if (total <= 0) return result;

  const claimed = new Set<number>();
  let travelled = 0;

  for (let i = 0; i + 1 < segments.length; i++) {
    const current = segments[i];
    const next = segments[i + 1];
    if (current === undefined || next === undefined) continue;

    travelled += segmentLength(current);
    if (!isCorner(current, next)) continue;

    // La muestra que corresponde a esta longitud de arco.
    const exact = (travelled / total) * (result.length - 1);
    const nearest = pickNearest(Math.round(exact), result.length, claimed);
    if (nearest === null) continue;

    claimed.add(nearest);
    result[nearest] = segmentEnd(current);
  }

  return result;
}

/** ¿Los dos tramos se encuentran formando un pico? */
function isCorner(current: Segment, next: Segment): boolean {
  const incoming = angleOf(segmentTangent(current, 1));
  const outgoing = angleOf(segmentTangent(next, 0));

  let turn = Math.abs(((outgoing - incoming) * 180) / Math.PI);
  while (turn > 360) turn -= 360;
  if (turn > 180) turn = 360 - turn;

  // `turn` es la desviación respecto de seguir recto: 0 es suave, 180 es pico.
  return 180 - turn < CORNER_THRESHOLD_DEG;
}

/** El índice interior libre más próximo al pedido. */
function pickNearest(wanted: number, length: number, claimed: ReadonlySet<number>): number | null {
  for (let offset = 0; offset < length; offset++) {
    for (const candidate of [wanted - offset, wanted + offset]) {
      // Los extremos son junturas con las aristas vecinas: intocables.
      if (candidate <= 0 || candidate >= length - 1) continue;
      if (!claimed.has(candidate)) return candidate;
    }
  }

  return null;
}

export interface BoundaryResult {
  /** Contorno cerrado, sin vértices repetidos en las junturas. */
  readonly polygon: readonly Vec2[];
  /** Índices dentro de `polygon` que ocupa cada arista, en orden. */
  readonly byEdge: ReadonlyMap<EdgeId, readonly number[]>;
}

/**
 * Encadena las aristas muestreadas en un contorno cerrado.
 *
 * El punto donde acaba una arista es el mismo donde empieza la siguiente, así
 * que aparece dos veces y hay que quedarse con uno. No es una limpieza
 * cosmética: un vértice duplicado produce una arista de longitud cero, y el
 * triangulador la rechaza o —peor— genera con ella un triángulo degenerado.
 *
 * El índice se conserva en AMBAS aristas: el último de una es el primero de la
 * siguiente. Eso es lo que hace que las costuras compartan vértice en las
 * esquinas y que la prenda no se abra por ahí al simular.
 */
export function chainBoundary(edges: readonly SampledEdge[], epsilon = 0.01): BoundaryResult {
  const polygon: Vec2[] = [];
  const byEdge = new Map<EdgeId, number[]>();

  for (const edge of edges) {
    const indices: number[] = [];

    for (const point of edge.points) {
      const previous = polygon.at(-1);

      if (previous !== undefined && distance(previous, point) <= epsilon) {
        indices.push(polygon.length - 1);
        continue;
      }

      indices.push(polygon.length);
      polygon.push(point);
    }

    byEdge.set(edge.edge, indices);
  }

  // El cierre: el último punto coincide con el primero.
  const first = polygon[0];
  const last = polygon.at(-1);

  if (polygon.length > 1 && first !== undefined && last !== undefined) {
    if (distance(first, last) <= epsilon) {
      polygon.pop();

      for (const [edgeId, indices] of byEdge) {
        byEdge.set(
          edgeId,
          indices.map((index) => (index === polygon.length ? 0 : index)),
        );
      }
    }
  }

  return { polygon, byEdge };
}
