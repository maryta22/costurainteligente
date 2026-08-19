import type { Ring, Vec3 } from '@domain/avatar/types';
import { vec3 } from '@domain/avatar/types';

import type { Section } from './bodySurface';
import type { Profile } from './profile';
import { fitSection, perimeterAt } from './profile';

/**
 * Una sección con su recorrido tabulado.
 *
 * ── Por qué se tabula ──────────────────────────────────────────────────────
 *
 * Pasar de longitud de arco a ángulo sobre una elipse exige invertir una
 * integral elíptica. Hacerlo con la cuadratura adaptativa del núcleo da el
 * resultado exacto, pero cuesta unas decenas de evaluaciones por llamada, y
 * aquí se llama una vez por vértice y por iteración: cinco mil vértices por
 * veinte iteraciones son cien mil inversiones.
 *
 * La tabla se construye una vez por sección con la regla del trapecio sobre
 * 256 tramos —el integrando es suave y periódico, donde el trapecio converge
 * muy deprisa— y después cada consulta es una búsqueda binaria. El error queda
 * por debajo de la centésima de milímetro, tres órdenes por debajo de lo que
 * distingue una costura bien puesta de una mal puesta.
 */
export interface SectionTable {
  readonly section: Section;
  /** Arco acumulado en cada ángulo muestreado, de 0 a 2π. */
  readonly cumulative: Float64Array;
  readonly perimeter: number;
}

const TABLE_STEPS = 256;

export function tabulate(section: Section): SectionTable {
  const cumulative = new Float64Array(TABLE_STEPS + 1);
  const step = (2 * Math.PI) / TABLE_STEPS;

  const speed = (t: number): number =>
    Math.hypot(section.halfWidth * Math.cos(t), section.halfDepth * Math.sin(t));

  let total = 0;
  let previous = speed(0);

  for (let i = 1; i <= TABLE_STEPS; i++) {
    const current = speed(i * step);
    total += ((previous + current) / 2) * step;
    cumulative[i] = total;
    previous = current;
  }

  return { section, cumulative, perimeter: total };
}

/**
 * Ángulo al que se llega recorriendo una fracción del perímetro desde el frente.
 *
 * La fracción puede ser negativa o mayor que uno: un panel ancho da la vuelta
 * más allá del origen, y hay que dejarle. Se separa en vueltas completas más
 * resto, y el resto se busca en la tabla.
 */
export function angleAtFraction(table: SectionTable, fraction: number): number {
  const turns = Math.floor(fraction);
  const remainder = fraction - turns;
  const target = remainder * table.perimeter;

  const { cumulative } = table;
  let low = 0;
  let high = cumulative.length - 1;

  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if ((cumulative[mid] ?? 0) <= target) low = mid;
    else high = mid;
  }

  const before = cumulative[low] ?? 0;
  const after = cumulative[high] ?? before;
  const span = after - before;
  const t = span <= 0 ? 0 : (target - before) / span;

  const step = (2 * Math.PI) / TABLE_STEPS;
  return (low + t) * step + turns * 2 * Math.PI;
}

/**
 * Superficie sobre la que se viste un grupo de paneles.
 *
 * Las secciones se precalculan a intervalos regulares y entre ellas se
 * interpola. Resolver la dilatación de cada sección cuesta unas decenas de
 * integraciones, y hacerlo por vértice sería el grueso del tiempo de la fase.
 */
export interface FitSurface {
  readonly minY: number;
  readonly stepMm: number;
  readonly tables: readonly SectionTable[];
  readonly profile: Profile | null;
  readonly rings: readonly Ring[];
  readonly clearanceMm: number;
}

const SURFACE_STEP_MM = 12;

export function buildFitSurface(
  rings: readonly Ring[],
  profile: Profile | null,
  range: { minY: number; maxY: number },
  clearanceMm: number,
): FitSurface | null {
  const span = range.maxY - range.minY;
  if (span <= 0) return null;

  const steps = Math.max(2, Math.ceil(span / SURFACE_STEP_MM) + 1);
  const stepMm = span / (steps - 1);
  const tables: SectionTable[] = [];

  for (let i = 0; i < steps; i++) {
    const section = fitSection(rings, profile, range.minY + stepMm * i, clearanceMm);
    if (section === null) return null;
    tables.push(tabulate(section));
  }

  return { minY: range.minY, stepMm, tables, profile, rings, clearanceMm };
}

/** Sitúa un punto sobre la superficie por su altura y su recorrido tangencial. */
export function wrapPoint(
  surface: FitSurface,
  y: number,
  arcOriginFraction: number,
  tangentialMm: number,
  perimeterY = y,
): Vec3 {
  const position = clamp((y - surface.minY) / surface.stepMm, 0, surface.tables.length - 1);
  const index = Math.min(Math.floor(position), surface.tables.length - 2);
  const t = position - index;

  const lower = surface.tables[index];
  const upper = surface.tables[index + 1] ?? lower;
  if (lower === undefined || upper === undefined) return vec3(0, y, 0);

  /*
   * La FRACCIÓN de perímetro es la misma en las dos secciones vecinas —depende
   * del recorrido pedido y del contorno de la prenda, no de la sección—, así
   * que interpolar los dos ángulos que resultan es coherente. Interpolar
   * longitudes de arco no lo sería: cada sección mide distinto.
   */
  /*
   * El contorno se lee a `perimeterY`, que puede no ser la altura del punto.
   * Dentro de una banda conformada el arco se mide en el borde de la banda, y
   * el contorno tiene que leerse EN LA MISMA FILA: si uno se lee recortado y el
   * otro no, la fracción deja de cuadrar y los costadillos se abren.
   */
  const perimeter = surface.profile === null
    ? lerp(lower.perimeter, upper.perimeter, t)
    : Math.max(perimeterAt(surface.profile, perimeterY), 1e-6);

  const fraction = arcOriginFraction + tangentialMm / perimeter;

  const angle = lerp(angleAtFraction(lower, fraction), angleAtFraction(upper, fraction), t);

  const halfWidth = lerp(lower.section.halfWidth, upper.section.halfWidth, t);
  const halfDepth = lerp(lower.section.halfDepth, upper.section.halfDepth, t);
  const centerX = lerp(lower.section.centerX, upper.section.centerX, t);
  const centerZ = lerp(lower.section.centerZ, upper.section.centerZ, t);

  return vec3(
    centerX + halfWidth * Math.sin(angle),
    y,
    centerZ + halfDepth * Math.cos(angle),
  );
}

/** La sección de la superficie a una altura, ya interpolada. */
export function surfaceSectionAt(surface: FitSurface, y: number): Section {
  const position = clamp((y - surface.minY) / surface.stepMm, 0, surface.tables.length - 1);
  const index = Math.min(Math.floor(position), surface.tables.length - 2);
  const t = position - index;

  const lower = surface.tables[index]?.section;
  const upper = surface.tables[index + 1]?.section ?? lower;

  if (lower === undefined || upper === undefined) {
    return { centerX: 0, centerZ: 0, halfWidth: 0, halfDepth: 0 };
  }

  return {
    centerX: lerp(lower.centerX, upper.centerX, t),
    centerZ: lerp(lower.centerZ, upper.centerZ, t),
    halfWidth: lerp(lower.halfWidth, upper.halfWidth, t),
    halfDepth: lerp(lower.halfDepth, upper.halfDepth, t),
  };
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
