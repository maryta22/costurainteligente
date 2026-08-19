import type { Vec2 } from '@core/geometry/vec2';

import type { Avatar } from '@domain/avatar/types';
import type { EdgeId, PatternPiece, PieceId, Seam } from '@domain/pattern/types';

import {
  instanceCount,
  isCenterEdge,
  panelNormal,
  panelPointToWorld,
  planPlacement,
} from './placement';
import { chainBoundary, planSampleCounts, sampleBoundary } from './sampling';
import { angleStats, meanEdgeLength, triangulatePolygon } from './triangulate';
import type { BuildOptions, GarmentMesh, PanelMesh, SeamLink } from './types';
import { DEFAULT_TARGET_EDGE_MM } from './types';

/**
 * Convierte el patrón 2D en la malla 3D de la prenda.
 *
 * ── UNA SOLA FUENTE DE VERDAD ──────────────────────────────────────────────
 *
 * Esta función es una PROYECCIÓN, no una copia. La prenda 3D no se guarda en
 * ninguna parte ni se edita por su cuenta: se recalcula del patrón cada vez.
 * Cambiar una medida cambia el patrón y, con él, la malla — sin ninguna
 * sincronización que pueda quedar desfasada, porque no hay dos cosas que
 * sincronizar.
 *
 * Es la decisión que hará posible la Fase 13. El solver de tela moverá los
 * vértices, pero el reposo al que tienden —la forma que la tela «quiere»
 * tener— seguirá siendo el patrón plano. Esa forma de reposo es lo que
 * distingue simular tela de simular una membrana cualquiera.
 */
export function buildGarmentMesh(
  pieces: readonly PatternPiece[],
  seams: readonly Seam[],
  avatar: Avatar,
  options: BuildOptions = {},
): GarmentMesh {
  const targetEdgeMm = options.targetEdgeMm ?? DEFAULT_TARGET_EDGE_MM;
  const warnings: string[] = [];

  const counts = planSampleCounts(pieces, seams, targetEdgeMm);

  const panels: PanelMesh[] = [];
  /** De `pieceId::instancia` al índice dentro de `panels`. */
  const panelIndex = new Map<string, number>();

  let triangleCount = 0;
  let vertexCount = 0;
  let minAngleDeg = 180;
  let minInteriorAngleDeg = 180;
  let degenerateCount = 0;
  let edgeTotal = 0;
  let edgeWeight = 0;

  for (const piece of pieces) {
    const { polygon, byEdge } = chainBoundary(sampleBoundary(piece, counts));

    if (polygon.length < 3) {
      warnings.push(`La pieza «${piece.name}» no tiene contorno suficiente para mallar.`);
      continue;
    }

    const triangulation = triangulatePolygon(polygon, targetEdgeMm);

    if (triangulation.triangles.length === 0) {
      warnings.push(`No se pudo triangular la pieza «${piece.name}».`);
      continue;
    }

    const stats = angleStats(triangulation);
    const pieceTriangles = triangulation.triangles.length / 3;

    minAngleDeg = Math.min(minAngleDeg, stats.minDeg);
    minInteriorAngleDeg = Math.min(minInteriorAngleDeg, stats.minInteriorDeg);
    degenerateCount += stats.degenerateCount;
    edgeTotal += meanEdgeLength(triangulation) * pieceTriangles;
    edgeWeight += pieceTriangles;

    const instances = instanceCount(piece);

    for (let instance = 0; instance < instances; instance++) {
      const panel = buildPanel(piece, instance, avatar, triangulation.points, triangulation.triangles, byEdge);

      panelIndex.set(instanceKey(piece.id, instance), panels.length);
      panels.push(panel);

      triangleCount += pieceTriangles;
      vertexCount += panel.vertexCount;
    }
  }

  const links = buildSeamLinks(pieces, seams, panels, panelIndex, warnings);

  return {
    panels,
    seams: links,
    quality: {
      triangleCount,
      vertexCount,
      minAngleDeg: minAngleDeg === 180 ? 0 : minAngleDeg,
      minInteriorAngleDeg: minInteriorAngleDeg === 180 ? 0 : minInteriorAngleDeg,
      meanEdgeMm: edgeWeight === 0 ? 0 : edgeTotal / edgeWeight,
      degenerateCount,
    },
    warnings,
  };
}

const instanceKey = (piece: PieceId, instance: number): string => `${piece}::${instance}`;

/** Traslada una triangulación plana a su sitio en la escena. */
function buildPanel(
  piece: PatternPiece,
  instance: number,
  avatar: Avatar,
  points: readonly Vec2[],
  triangles: readonly number[],
  boundary: ReadonlyMap<EdgeId, readonly number[]>,
): PanelMesh {
  const placement = planPlacement(piece, instance, avatar);
  const normal = panelNormal(placement);

  const positions = new Float32Array(points.length * 3);
  const uv = new Float32Array(points.length * 2);
  const normals = new Float32Array(points.length * 3);

  points.forEach((point, i) => {
    const world = panelPointToWorld(point, placement);

    positions[i * 3] = world.x;
    positions[i * 3 + 1] = world.y;
    positions[i * 3 + 2] = world.z;

    // La coordenada del patrón, tal cual: ver la nota de `types.ts`.
    uv[i * 2] = point.x;
    uv[i * 2 + 1] = point.y;

    normals[i * 3] = normal.x;
    normals[i * 3 + 1] = normal.y;
    normals[i * 3 + 2] = normal.z;
  });

  /*
   * Reflejar invierte la orientación del plano, así que los triángulos quedan
   * del revés y la cara miraría hacia el cuerpo. Intercambiar dos índices
   * devuelve la normal hacia fuera.
   */
  const indices = new Uint32Array(triangles.length);

  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const a = triangles[i] ?? 0;
    const b = triangles[i + 1] ?? 0;
    const c = triangles[i + 2] ?? 0;

    indices[i] = a;
    indices[i + 1] = placement.mirrored ? c : b;
    indices[i + 2] = placement.mirrored ? b : c;
  }

  return {
    piece: piece.id,
    instance,
    mirrored: placement.mirrored,
    positions,
    uv,
    normals,
    indices,
    boundary,
    vertexCount: points.length,
  };
}

/**
 * Empareja los vértices de cada costura.
 *
 * ── Las instancias se emparejan por CERCANÍA, no por número ────────────────
 *
 * Un delantero al doblez y una espalda al doblez producen dos instancias cada
 * uno, y hay que saber cuál cose con cuál. Llevar la cuenta a mano —«la
 * instancia 0 del delantero va con la 1 de la espalda porque el azimut π
 * invierte la tangente»— es exactamente el tipo de razonamiento que se rompe en
 * silencio al añadir un tipo de prenda.
 *
 * Buscar la instancia más cercana no se rompe: si la colocación es razonable,
 * los dos lados de una costura ya están próximos, y si no lo está, el
 * emparejamiento por índice tampoco habría servido. Además es comprobable —un
 * test puede exigir que las parejas empiecen cerca.
 */
function buildSeamLinks(
  pieces: readonly PatternPiece[],
  seams: readonly Seam[],
  panels: readonly PanelMesh[],
  panelIndex: ReadonlyMap<string, number>,
  warnings: string[],
): SeamLink[] {
  const links: SeamLink[] = [];

  const instancesOf = (piece: PieceId): number[] => {
    const found: number[] = [];

    for (let instance = 0; ; instance++) {
      const index = panelIndex.get(instanceKey(piece, instance));
      if (index === undefined) break;
      found.push(index);
    }

    return found;
  };

  for (const seam of seams) {
    const sideA = instancesOf(seam.a.piece);
    const sideB = instancesOf(seam.b.piece);

    if (sideA.length === 0 || sideB.length === 0) {
      warnings.push(`La costura «${seam.id}» referencia una pieza que no se malló.`);
      continue;
    }

    const taken = new Set<number>();

    for (const a of sideA) {
      const link = linkInstance(seam, a, sideB, taken, panels, warnings);
      if (link === null) continue;

      taken.add(link.panelB);
      links.push(link);
    }
  }

  links.push(...centerLinks(pieces, panels, panelIndex));
  links.push(...dartLinks(pieces, panels, panelIndex));

  return links;
}

/** Une una instancia de la pieza A con la instancia libre más cercana de B. */
function linkInstance(
  seam: Seam,
  a: number,
  sideB: readonly number[],
  taken: ReadonlySet<number>,
  panels: readonly PanelMesh[],
  warnings: string[],
): SeamLink | null {
  const verticesA = seamVertices(panels[a], seam.a.edge, seam.a.reversed);
  if (verticesA === null) return null;

  let best: { panel: number; vertices: readonly number[]; distance: number } | null = null;

  for (const b of sideB) {
    if (taken.has(b)) continue;

    const verticesB = seamVertices(panels[b], seam.b.edge, seam.b.reversed);
    if (verticesB === null) continue;

    const gap = pairingDistance(panels[a], verticesA, panels[b], verticesB);
    if (best === null || gap < best.distance) {
      best = { panel: b, vertices: verticesB, distance: gap };
    }
  }

  if (best === null) {
    warnings.push(`La costura «${seam.id}» no encontró pareja para una instancia.`);
    return null;
  }

  if (verticesA.length !== best.vertices.length) {
    warnings.push(
      `La costura «${seam.id}» empareja aristas con distinto número de muestras ` +
        `(${verticesA.length} y ${best.vertices.length}).`,
    );
  }

  const shared = Math.min(verticesA.length, best.vertices.length);

  return {
    seam: String(seam.id),
    panelA: a,
    panelB: best.panel,
    verticesA: verticesA.slice(0, shared),
    verticesB: best.vertices.slice(0, shared),
  };
}

/**
 * Cierres del centro: lo que une una pieza con su propio reflejo.
 *
 * ── Una unión que el patrón 2D no representa ───────────────────────────────
 *
 * En el patrón, un delantero al doblez es UNA pieza y una espalda con cremallera
 * es UNA pieza que se corta dos veces. En los dos casos el plano guarda media
 * prenda y la otra mitad se sobreentiende, así que la unión entre ambas mitades
 * no aparece en el grafo de costuras — no hay dos piezas que unir.
 *
 * En 3D sí hay dos: la instancia y su reflejo. Y hay que unirlas, o la prenda
 * quedaría abierta de arriba abajo justo por el centro. Que en la tela una sea
 * un pliegue y la otra una costura con cremallera no cambia nada aquí: en ambos
 * casos son dos filas de vértices que tienen que ir juntas.
 *
 * ── No todo doblez es un plano de simetría ─────────────────────────────────
 *
 * Sólo cuentan las aristas de CENTRO. Una pretina también se traza al doblez,
 * pero a lo largo: se dobla sobre sí misma para quedar de doble grosor, y al
 * plegarla las dos mitades se superponen en vez de extender la prenda. Tratar
 * ese doblez como un espejo duplicaría la pretina hacia abajo, que no es lo que
 * ocurre al coserla.
 */
function centerLinks(
  pieces: readonly PatternPiece[],
  panels: readonly PanelMesh[],
  panelIndex: ReadonlyMap<string, number>,
): SeamLink[] {
  const links: SeamLink[] = [];

  for (const piece of pieces) {
    const a = panelIndex.get(instanceKey(piece.id, 0));
    const b = panelIndex.get(instanceKey(piece.id, 1));
    if (a === undefined || b === undefined) continue;

    for (const edge of piece.edges) {
      if (!isCenterEdge(edge)) continue;

      const vertices = panels[a]?.boundary.get(edge.id);
      if (vertices === undefined) continue;

      links.push({
        seam: `${edge.onFold ? 'fold' : 'center'}:${piece.id}:${edge.id}`,
        panelA: a,
        panelB: b,
        verticesA: [...vertices],
        verticesB: [...vertices],
      });
    }
  }

  return links;
}

/**
 * Las dos patas de cada pinza, cosidas entre sí.
 *
 * ── La otra unión que el patrón 2D no representa ───────────────────────────
 *
 * Una pinza se dibuja como una cuña abierta en el borde de la pieza, y coserla
 * consiste en juntar sus dos lados: eso es lo que da el volumen. Pero en el
 * modelo es UNA arista de la misma pieza —baja hasta el vértice y vuelve a
 * subir—, así que no hay dos aristas que emparejar y el grafo de costuras no la
 * recoge.
 *
 * Sin esta unión la pinza queda como un boquete en la prenda: el contorno sale
 * bien —al medirlo se descuenta la cuña— pero se ve el hueco. Y la Fase 13 no
 * tendría con qué cerrarla, que es peor: son las pinzas las que hacen que un
 * cuerpo plano se ajuste a uno con relieve.
 *
 * El emparejamiento es por simetría respecto al vértice: el primer punto con el
 * último, el segundo con el penúltimo. Como el vértice es el punto medio de la
 * arista y las dos patas miden lo mismo por construcción, los índices que van
 * juntos son los que equidistan de él.
 */
function dartLinks(
  pieces: readonly PatternPiece[],
  panels: readonly PanelMesh[],
  panelIndex: ReadonlyMap<string, number>,
): SeamLink[] {
  const links: SeamLink[] = [];

  for (const piece of pieces) {
    for (const edge of piece.edges) {
      if (edge.role !== 'dart') continue;

      for (let instance = 0; ; instance++) {
        const index = panelIndex.get(instanceKey(piece.id, instance));
        if (index === undefined) break;

        const vertices = panels[index]?.boundary.get(edge.id);
        if (vertices === undefined || vertices.length < 3) continue;

        const verticesA: number[] = [];
        const verticesB: number[] = [];

        // Se para antes del vértice: ahí las dos patas ya son el mismo punto.
        const pairs = Math.floor(vertices.length / 2);
        for (let i = 0; i < pairs; i++) {
          const a = vertices[i];
          const b = vertices[vertices.length - 1 - i];
          if (a === undefined || b === undefined || a === b) continue;

          verticesA.push(a);
          verticesB.push(b);
        }

        if (verticesA.length === 0) continue;

        links.push({
          seam: `dart:${piece.id}:${edge.id}:${instance}`,
          panelA: index,
          panelB: index,
          verticesA,
          verticesB,
        });
      }
    }
  }

  return links;
}

/** Índices del contorno que ocupa una arista, en el sentido de cosido. */
function seamVertices(
  panel: PanelMesh | undefined,
  edge: EdgeId,
  reversed: boolean,
): readonly number[] | null {
  const vertices = panel?.boundary.get(edge);
  if (vertices === undefined) return null;

  return reversed ? [...vertices].reverse() : vertices;
}

/** Distancia media entre los extremos de dos aristas ya colocadas. */
function pairingDistance(
  panelA: PanelMesh | undefined,
  verticesA: readonly number[],
  panelB: PanelMesh | undefined,
  verticesB: readonly number[],
): number {
  if (panelA === undefined || panelB === undefined) return Infinity;
  if (verticesA.length === 0 || verticesB.length === 0) return Infinity;

  const samples = Math.min(verticesA.length, verticesB.length);
  let total = 0;

  for (let i = 0; i < samples; i++) {
    const ia = (verticesA[i] ?? 0) * 3;
    const ib = (verticesB[i] ?? 0) * 3;

    total += Math.hypot(
      (panelA.positions[ia] ?? 0) - (panelB.positions[ib] ?? 0),
      (panelA.positions[ia + 1] ?? 0) - (panelB.positions[ib + 1] ?? 0),
      (panelA.positions[ia + 2] ?? 0) - (panelB.positions[ib + 2] ?? 0),
    );
  }

  return total / samples;
}
