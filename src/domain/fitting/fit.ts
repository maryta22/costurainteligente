import type { Avatar, Ring } from '@domain/avatar/types';
import { computeNormals } from '@domain/avatar/loft';
import type { GarmentMesh, PanelMesh } from '@domain/garment3d';
import { classifyPanel } from '@domain/garment3d';
import { pieceBounds } from '@domain/pattern/piece';
import type { PatternPiece } from '@domain/pattern/types';

import { sectionAt } from './bodySurface';
import type { Profile } from './profile';
import { buildProfile, panelArcAt, perimeterAt, tubeRange } from './profile';
import type { BodyCollider } from './relax';
import { relax } from './relax';
import { computeStrain } from './strain';
import type { EaseReading, FitOptions, FittedGarment, FittedPanel, WrapGroup } from './types';
import {
  DEFAULT_CLEARANCE_MM,
  DEFAULT_EDGE_STIFFNESS,
  DEFAULT_ITERATIONS,
  DEFAULT_MAX_SEAM_PULL_MM,
  DEFAULT_SEAM_STIFFNESS,
} from './types';
import type { FitSurface } from './wrap';
import { buildFitSurface, wrapPoint } from './wrap';

/** Cuánto se aparta del borde de la pieza al leer su contorno. */
const INSET_MM = 1;

/** Dónde y cómo se ciñe un panel al cuerpo. */
interface Assignment {
  readonly group: WrapGroup;
  /** Altura de la escena en la que cae el `y = 0` del patrón. */
  readonly heightOrigin: number;
  /** Fracción del perímetro donde cae el `x = 0` del patrón. */
  readonly arcOriginFraction: number;
  readonly mirrored: boolean;
}

/**
 * Reparte los paneles entre las partes del cuerpo.
 *
 * Las fracciones son cuartos exactos —0, ¼, ½, ¾— y eso no es una aproximación:
 * los cuatro cuadrantes de una elipse tienen exactamente la misma longitud de
 * arco por simetría, así que la fracción ½ cae SIEMPRE en el centro de la
 * espalda y ¼ en el costado, sea cual sea la excentricidad de la sección.
 * Trabajar con fracciones y no con ángulos es lo que hace que eso se cumpla.
 */
function assign(
  piece: PatternPiece,
  instance: number,
  avatar: Avatar,
  underarmLevel: number,
): Assignment | null {
  const waist = avatar.levels.waist ?? 0;
  const mirrored = instance === 1;

  switch (classifyPanel(piece)) {
    case 'bodiceFront':
      return { group: 'torso', heightOrigin: waist, arcOriginFraction: 0, mirrored };
    case 'bodiceBack':
      return { group: 'torso', heightOrigin: waist, arcOriginFraction: 0.5, mirrored };

    // En una falda el `y = 0` es el BAJO: se alinea por arriba.
    case 'skirtFront':
      return {
        group: 'torso',
        heightOrigin: waist - (pieceBounds(piece)?.max.y ?? 0),
        arcOriginFraction: 0,
        mirrored,
      };
    case 'skirtBack':
      return {
        group: 'torso',
        heightOrigin: waist - (pieceBounds(piece)?.max.y ?? 0),
        arcOriginFraction: 0.5,
        mirrored,
      };

    /*
     * La manga da una vuelta entera al brazo, y su `x = 0` es la línea de hilo,
     * que cae por la parte de fuera. Los dos costadillos de sobaco se juntan
     * porque medio contorno a cada lado suma exactamente el contorno.
     */
    case 'sleeve':
      return mirrored
        ? { group: 'arm0', heightOrigin: underarmLevel, arcOriginFraction: 0.75, mirrored }
        : { group: 'arm1', heightOrigin: underarmLevel, arcOriginFraction: 0.25, mirrored };

    case 'band':
      return { group: 'band', heightOrigin: waist, arcOriginFraction: 0.5, mirrored: false };
  }
}

/**
 * VISTE LA PRENDA sobre el maniquí.
 *
 * Tres pasos, en este orden y por esta razón:
 *
 *   1. ENVOLVER. Cada panel se ciñe a una superficie cuyo contorno a cada
 *      altura es el del patrón. Los costadillos, el centro y la cintura cierran
 *      solos: no es que se ajusten bien, es que caen en el mismo sitio por cómo
 *      se definió la superficie.
 *   2. RELAJAR. Quedan sueltas las costuras que NO son horizontales —hombro y
 *      sisa—, porque unen alturas distintas y ninguna elección de contorno las
 *      hace coincidir. Ahí sí hace falta iterar.
 *   3. MEDIR. La tensión respecto al patrón dice dónde falta o sobra tela, que
 *      es lo que de verdad se quiere saber antes de cortar.
 */
export function fitGarment(
  mesh: GarmentMesh,
  pieces: readonly PatternPiece[],
  avatar: Avatar,
  options: FitOptions = {},
): FittedGarment {
  const clearanceMm = options.clearanceMm ?? DEFAULT_CLEARANCE_MM;
  const warnings: string[] = [];

  const byId = new Map(pieces.map((piece) => [String(piece.id), piece]));
  const underarm = underarmLevel(mesh, byId, avatar);

  const assignments: (Assignment | null)[] = mesh.panels.map((panel) => {
    const piece = byId.get(String(panel.piece));
    return piece === undefined ? null : assign(piece, panel.instance, avatar, underarm);
  });

  // ── 1. Envolver ──────────────────────────────────────────────────────────

  const surfaces = buildSurfaces(mesh.panels, assignments, byId, avatar, clearanceMm);

  let total = 0;
  for (const panel of mesh.panels) total += panel.vertexCount;

  const positions = new Float32Array(total * 3);
  const offsets: number[] = [];

  let cursor = 0;
  mesh.panels.forEach((panel, index) => {
    offsets.push(cursor);

    const assignment = assignments[index];
    const surface = assignment === null || assignment === undefined
      ? undefined
      : surfaces.get(assignment.group);

    if (assignment === null || assignment === undefined || surface === undefined) {
      // Sin sitio conocido en el cuerpo, se deja donde estaba: es mejor verla
      // fuera de lugar que no verla.
      positions.set(panel.positions, cursor * 3);
      warnings.push(`No se supo dónde ceñir «${String(panel.piece)}»; queda sin vestir.`);
      cursor += panel.vertexCount;
      return;
    }

    /*
     * La MISMA franja que usa el perfil. Dentro de la banda conformada —la
     * curva de cintura, el escote— la fila se lee en el borde de la banda: si el
     * perfil recorta ahí y el envoltorio no, los dos dejan de hablar del mismo
     * contorno y los costadillos se abren 61 mm.
     */
    const piece = byId.get(String(panel.piece));
    const tube = piece === undefined ? null : tubeRange(panel, piece);

    /*
     * Nunca se lee EN el borde de la pieza, sino una pizca por dentro. Justo en
     * el borde superior de una falda de vestido, el contorno ya lo aporta el
     * cuerpo y no la falda —se cuentan una vez cada uno para no duplicar la
     * cintura—, así que leer ahí devolvía el contorno del cuerpo para un punto
     * de la falda y abría el costadillo 68 mm en su último par de vértices.
     */
    let extentLow = Infinity;
    let extentHigh = -Infinity;
    for (let i = 1; i < panel.uv.length; i += 2) {
      const value = panel.uv[i] ?? 0;
      extentLow = Math.min(extentLow, value);
      extentHigh = Math.max(extentHigh, value);
    }

    const inset = Math.min(INSET_MM, (extentHigh - extentLow) / 4);
    const readLow = Math.max(tube?.low ?? extentLow, extentLow + inset);
    const readHigh = Math.min(tube?.high ?? extentHigh, extentHigh - inset);

    for (let i = 0; i < panel.vertexCount; i++) {
      const localX = panel.uv[i * 2] ?? 0;
      const localY = panel.uv[i * 2 + 1] ?? 0;

      // La altura es la de verdad; lo que se recorta es sólo dónde se LEE.
      const y = assignment.heightOrigin + localY;
      const readAt = Math.min(readHigh, Math.max(readLow, localY));

      // La pieza cosida, no la plana: las pinzas ya no ocupan sitio.
      const sewn = panelArcAt(panel, localX, readAt);
      const tangential = assignment.mirrored ? -sewn : sewn;

      const point = wrapPoint(
        surface,
        y,
        assignment.arcOriginFraction,
        tangential,
        assignment.heightOrigin + readAt,
      );

      const at = (cursor + i) * 3;
      positions[at] = point.x;
      positions[at + 1] = point.y;
      positions[at + 2] = point.z;
    }

    cursor += panel.vertexCount;
  });

  // ── 2. Relajar ───────────────────────────────────────────────────────────

  const { edges, restLengths } = buildEdges(mesh.panels, offsets);
  const seams = buildSeams(mesh, offsets);

  const collider: BodyCollider = {
    parts: [avatar.sections.torso, ...avatar.sections.arms, ...avatar.sections.legs],
    clearanceMm: clearanceMm * 0.5,
  };

  const report = relax(positions, { edges, restLengths, seams }, collider, {
    iterations: options.iterations ?? DEFAULT_ITERATIONS,
    seamStiffness: options.seamStiffness ?? DEFAULT_SEAM_STIFFNESS,
    edgeStiffness: options.edgeStiffness ?? DEFAULT_EDGE_STIFFNESS,
    maxSeamPullMm: options.maxSeamPullMm ?? DEFAULT_MAX_SEAM_PULL_MM,
  });

  // ── 3. Medir ─────────────────────────────────────────────────────────────

  const strain = computeStrain(positions, edges, restLengths, total);

  const panels: FittedPanel[] = mesh.panels.map((panel, index) => {
    const start = offsets[index] ?? 0;
    const slice = positions.slice(start * 3, (start + panel.vertexCount) * 3);

    return {
      piece: panel.piece,
      instance: panel.instance,
      group: assignments[index]?.group ?? 'torso',
      positions: slice,
      normals: computeNormals(slice, panel.indices),
      uv: panel.uv,
      indices: panel.indices,
      boundary: panel.boundary,
      strain: strain.perVertex.slice(start, start + panel.vertexCount),
      vertexCount: panel.vertexCount,
    };
  });

  return {
    panels,
    relax: report,
    strain,
    easeAtLevels: readEase(avatar, surfaces.get('torso')?.profile ?? null),
    warnings,
  };
}

/**
 * Altura del sobaco, leída del propio patrón.
 *
 * La línea de sobaco de la manga —su `y = 0`— tiene que caer donde acaba el
 * costadillo del cuerpo, porque son los dos extremos de la misma costura. Antes
 * se anclaba a cuarenta milímetros por debajo del hombro, que parecía razonable
 * y estaba 176 mm fuera de sitio: exactamente el hueco que quedaba entre la copa
 * y la sisa, y que ninguna relajación local iba a arreglar porque no era un
 * error local sino de colocación.
 *
 * La cifra no se estima: es dónde termina la arista de costadillo del cuerpo.
 */
function underarmLevel(
  mesh: GarmentMesh,
  pieces: ReadonlyMap<string, PatternPiece>,
  avatar: Avatar,
): number {
  const waist = avatar.levels.waist ?? 0;
  let top: number | null = null;

  for (const panel of mesh.panels) {
    const piece = pieces.get(String(panel.piece));
    if (piece === undefined) continue;

    const kind = classifyPanel(piece);
    if (kind !== 'bodiceFront' && kind !== 'bodiceBack') continue;

    for (const edge of piece.edges) {
      if (edge.role !== 'side') continue;

      const indices = panel.boundary.get(edge.id);
      if (indices === undefined) continue;

      for (const index of indices) {
        const y = waist + (panel.uv[index * 2 + 1] ?? 0);
        top = top === null ? y : Math.max(top, y);
      }
    }
  }

  // Sin cuerpo no hay manga; el valor sólo evita un hueco en el tipo.
  return top ?? (avatar.levels.shoulder ?? 0) - 40;
}

/** Una superficie de vestido por grupo, con el contorno de sus propios paneles. */
function buildSurfaces(
  panels: readonly PanelMesh[],
  assignments: readonly (Assignment | null)[],
  pieces: ReadonlyMap<string, PatternPiece>,
  avatar: Avatar,
  clearanceMm: number,
): Map<WrapGroup, FitSurface> {
  const grouped = new Map<WrapGroup, { panel: PanelMesh; heightOrigin: number }[]>();

  panels.forEach((panel, index) => {
    const assignment = assignments[index];
    if (assignment === null || assignment === undefined) return;

    const list = grouped.get(assignment.group) ?? [];
    list.push({ panel, heightOrigin: assignment.heightOrigin });
    grouped.set(assignment.group, list);
  });

  const ringsFor = (group: WrapGroup): readonly Ring[] => {
    if (group === 'arm0') return avatar.sections.arms[0] ?? avatar.sections.torso;
    if (group === 'arm1') return avatar.sections.arms[1] ?? avatar.sections.torso;
    return avatar.sections.torso;
  };

  const surfaces = new Map<WrapGroup, FitSurface>();

  for (const [group, inputs] of grouped) {
    const profile = buildProfile(inputs, pieces);
    if (profile === null) continue;

    /*
     * Se deja margen por arriba y por abajo del rango del perfil: la relajación
     * mueve vértices y consultar fuera de la tabla los devolvería al extremo,
     * produciendo un escalón visible justo en el bajo y en el escote.
     */
    const surface = buildFitSurface(
      ringsFor(group),
      profile,
      { minY: profile.minY - 60, maxY: profile.maxY + 60 },
      clearanceMm,
    );

    if (surface !== null) surfaces.set(group, surface);
  }

  return surfaces;
}

/** Aristas únicas de todas las mallas, con su longitud en el patrón. */
function buildEdges(
  panels: readonly PanelMesh[],
  offsets: readonly number[],
): { edges: Uint32Array; restLengths: Float32Array } {
  const pairs: number[] = [];
  const lengths: number[] = [];

  panels.forEach((panel, index) => {
    const base = offsets[index] ?? 0;

    /*
     * Un conjunto POR PANEL, no uno global: los índices son locales al panel y
     * dos paneles distintos comparten los mismos números. Con un conjunto
     * compartido, el primer panel se quedaría con todas las claves y los demás
     * saldrían sin restricciones de longitud — es decir, sin tela.
     */
    const seen = new Set<number>();

    const add = (a: number, b: number): void => {
      const low = Math.min(a, b);
      const high = Math.max(a, b);
      const key = low * panel.vertexCount + high;
      if (seen.has(key)) return;
      seen.add(key);

      // La longitud de reposo es la del PATRÓN: la que tiene la tela cortada.
      const rest = Math.hypot(
        (panel.uv[high * 2] ?? 0) - (panel.uv[low * 2] ?? 0),
        (panel.uv[high * 2 + 1] ?? 0) - (panel.uv[low * 2 + 1] ?? 0),
      );

      pairs.push(base + low, base + high);
      lengths.push(rest);
    };

    for (let i = 0; i + 2 < panel.indices.length; i += 3) {
      const a = panel.indices[i] ?? 0;
      const b = panel.indices[i + 1] ?? 0;
      const c = panel.indices[i + 2] ?? 0;

      add(a, b);
      add(b, c);
      add(c, a);
    }
  });

  return { edges: Uint32Array.from(pairs), restLengths: Float32Array.from(lengths) };
}

/** Las parejas cosidas de la Fase 11, en índices globales. */
function buildSeams(mesh: GarmentMesh, offsets: readonly number[]): Uint32Array {
  const pairs: number[] = [];

  for (const link of mesh.seams) {
    const baseA = offsets[link.panelA];
    const baseB = offsets[link.panelB];
    if (baseA === undefined || baseB === undefined) continue;

    for (let i = 0; i < link.verticesA.length; i++) {
      pairs.push(baseA + (link.verticesA[i] ?? 0), baseB + (link.verticesB[i] ?? 0));
    }
  }

  return Uint32Array.from(pairs);
}

/**
 * La holgura, en las alturas que le importan a quien cose.
 *
 * Es la comprobación de que envolver sobre el contorno del patrón funciona: si
 * el usuario pidió ocho centímetros de holgura en el pecho, aquí tienen que
 * salir ocho centímetros. Si saliera cero, la prenda estaría pegada al cuerpo y
 * el método sería el que se quiso evitar.
 */
function readEase(avatar: Avatar, profile: Profile | null): Map<string, EaseReading> {
  const readings = new Map<string, EaseReading>();
  if (profile === null) return readings;

  for (const level of ['bust', 'waist', 'hip'] as const) {
    const y = avatar.levels[level];
    if (y === undefined) continue;
    if (y < profile.minY || y > profile.maxY) continue;

    const section = sectionAt(avatar.sections.torso, y);
    if (section === null) continue;

    const bodyMm = ellipsePerimeterApprox(section.halfWidth, section.halfDepth);
    const garmentMm = perimeterAt(profile, y);

    readings.set(level, { bodyMm, garmentMm, easeMm: garmentMm - bodyMm });
  }

  return readings;
}

/**
 * Perímetro de elipse por Ramanujan.
 *
 * Aquí sí basta: es exacta a 1e-5 relativo —dos centésimas de milímetro en un
 * contorno de pecho— y esto es una lectura para la interfaz, no geometría que
 * alimente nada. Donde el resultado se usa para construir, se integra de verdad.
 */
function ellipsePerimeterApprox(a: number, b: number): number {
  const h = ((a - b) * (a - b)) / ((a + b) * (a + b));
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}
