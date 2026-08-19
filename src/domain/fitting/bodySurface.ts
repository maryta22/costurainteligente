import { adaptiveQuadrature } from '@core/numeric/quadrature';
import { solveIncreasing } from '@core/numeric/solve';

import type { Ring, Vec3 } from '@domain/avatar/types';
import { vec3 } from '@domain/avatar/types';

/**
 * Sección horizontal del cuerpo: la elipse que hay a una altura dada.
 *
 * Se usa tanto para el cuerpo como para la superficie sobre la que se viste la
 * prenda, que es otra elipse a la misma altura pero de mayor perímetro.
 */
export interface Section {
  readonly centerX: number;
  readonly centerZ: number;
  readonly halfWidth: number;
  readonly halfDepth: number;
}

/** La elipse a la altura `y`, interpolando entre los anillos vecinos. */
export function sectionAt(rings: readonly Ring[], y: number): Section | null {
  if (rings.length === 0) return null;

  const first = rings[0];
  const last = rings[rings.length - 1];
  if (first === undefined || last === undefined) return null;

  // Fuera del rango se prolonga la sección extrema en vez de devolver nada: una
  // prenda puede sobresalir del torso por arriba o por abajo y hay que saber
  // dónde queda el cuerpo aunque ahí ya no haya anillo.
  if (y <= first.center.y) return toSection(first);
  if (y >= last.center.y) return toSection(last);

  for (let i = 0; i + 1 < rings.length; i++) {
    const lower = rings[i];
    const upper = rings[i + 1];
    if (lower === undefined || upper === undefined) continue;
    if (y < lower.center.y || y > upper.center.y) continue;

    const span = upper.center.y - lower.center.y;
    const t = span <= 0 ? 0 : (y - lower.center.y) / span;

    return {
      centerX: lerp(lower.center.x, upper.center.x, t),
      centerZ: lerp(lower.center.z, upper.center.z, t),
      halfWidth: lerp(lower.halfWidth, upper.halfWidth, t),
      halfDepth: lerp(lower.halfDepth, upper.halfDepth, t),
    };
  }

  return toSection(last);
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const toSection = (ring: Ring): Section => ({
  centerX: ring.center.x,
  centerZ: ring.center.z,
  halfWidth: ring.halfWidth,
  halfDepth: ring.halfDepth,
});

/**
 * Punto de la elipse en el ángulo `θ`, medido desde el FRENTE y hacia el lado
 * derecho del maniquí — el mismo convenio de azimut que la colocación plana.
 */
export function sectionPoint(section: Section, theta: number, y: number, outward = 0): Vec3 {
  const halfWidth = section.halfWidth + outward;
  const halfDepth = section.halfDepth + outward;

  return vec3(
    section.centerX + halfWidth * Math.sin(theta),
    y,
    section.centerZ + halfDepth * Math.cos(theta),
  );
}

/** Longitud de arco recorrida sobre la elipse desde el frente hasta `θ`. */
export function sectionArcLength(section: Section, theta: number): number {
  if (theta === 0) return 0;

  //  |dP/dθ| = √(a²·cos²θ + b²·sin²θ), con a = semianchura y b = semiprofundidad.
  const speed = (t: number): number =>
    Math.hypot(section.halfWidth * Math.cos(t), section.halfDepth * Math.sin(t));

  const sign = theta < 0 ? -1 : 1;
  return sign * adaptiveQuadrature(speed, 0, Math.abs(theta), 1e-4);
}

/** Perímetro completo de la sección. */
export const sectionPerimeter = (section: Section): number =>
  sectionArcLength(section, 2 * Math.PI);

/**
 * Ángulo al que se llega recorriendo `arcLength` sobre la elipse desde el frente.
 *
 * ── Medir y resolver, otra vez ─────────────────────────────────────────────
 *
 * La longitud de arco de una elipse es una integral elíptica: no tiene inversa
 * en forma cerrada. Se resuelve como todo lo demás en este proyecto —midiendo la
 * función e invirtiéndola numéricamente—, y no como se ve a menudo, repartiendo
 * el ángulo de forma uniforme.
 *
 * La diferencia no es cosmética. En una sección de torso, con proporción
 * profundidad/anchura de 0,72, repartir por ángulo desplaza el costadillo más de
 * un centímetro respecto a donde le toca. Una prenda vestida así tendría la
 * costura visiblemente fuera de sitio, y la culpa parecería del patrón.
 */
export function sectionAngleAtArcLength(section: Section, arcLength: number): number {
  const perimeter = sectionPerimeter(section);
  if (perimeter <= 0) return 0;

  // El recorrido puede dar más de una vuelta; se reduce y se recompone después.
  const turns = Math.floor(arcLength / perimeter);
  const remainder = arcLength - turns * perimeter;

  const theta = solveIncreasing(
    (t) => sectionArcLength(section, t),
    remainder,
    0,
    2 * Math.PI,
    { tolerance: 1e-5 },
  );

  return theta + turns * 2 * Math.PI;
}

/**
 * Saca un punto del interior del cuerpo, si ha entrado.
 *
 * ── Por qué no se busca el punto más cercano exacto ────────────────────────
 *
 * La distancia de un punto a una elipse exige resolver una cuártica, y hacerlo
 * por cada vértice y cada iteración sería el grueso del coste. Se normaliza en
 * su lugar: dividiendo por los semiejes, la elipse se vuelve una circunferencia
 * unidad, donde saber si un punto está dentro y por dónde sacarlo es inmediato.
 *
 * El punto de salida no es exactamente el más cercano —está en la dirección
 * radial normalizada, no en la normal verdadera—, pero la diferencia es de
 * décimas de milímetro para las excentricidades de un cuerpo, y a cambio la
 * operación es monótona y estable: nunca oscila ni empuja hacia dentro. Es lo
 * que usan los solvers de tela para colisionadores analíticos, y por lo mismo.
 */
export function pushOutside(
  section: Section,
  point: Vec3,
  clearance: number,
): Vec3 | null {
  const halfWidth = section.halfWidth + clearance;
  const halfDepth = section.halfDepth + clearance;
  if (halfWidth <= 0 || halfDepth <= 0) return null;

  const dx = point.x - section.centerX;
  const dz = point.z - section.centerZ;

  const normalized = Math.hypot(dx / halfWidth, dz / halfDepth);
  if (normalized >= 1) return null;

  // En el eje no hay dirección preferente: se saca hacia el frente.
  if (normalized <= 1e-9) return vec3(section.centerX, point.y, section.centerZ + halfDepth);

  const scale = 1 / normalized;
  return vec3(section.centerX + dx * scale, point.y, section.centerZ + dz * scale);
}

/**
 * Cuánto se ha metido un punto dentro del cuerpo, en milímetros aproximados.
 * Cero o negativo si está fuera.
 */
export function penetration(section: Section, point: Vec3, clearance: number): number {
  const outside = pushOutside(section, point, clearance);
  if (outside === null) return 0;

  return Math.hypot(outside.x - point.x, outside.z - point.z);
}
