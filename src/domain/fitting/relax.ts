import type { Ring } from '@domain/avatar/types';

import { pushOutside, sectionAt } from './bodySurface';

/**
 * Colisionador del cuerpo: todas sus partes, cada una como serie de secciones.
 *
 * Se comprueban todas por vértice. Podría acotarse con una jerarquía espacial,
 * pero son cinco pruebas de coste constante y el perfilado dice que el tiempo se
 * va en otra parte; añadir un árbol ahora sería complicar sin motivo.
 */
export interface BodyCollider {
  readonly parts: readonly (readonly Ring[])[];
  readonly clearanceMm: number;
}

export interface RelaxConstraints {
  /** Dos índices de vértice por arista de la malla. */
  readonly edges: Uint32Array;
  /** Longitud de la arista EN EL PATRÓN: la que la tela quiere tener. */
  readonly restLengths: Float32Array;
  /** Dos índices por pareja cosida. Su distancia objetivo es cero. */
  readonly seams: Uint32Array;
}

export interface RelaxOptions {
  readonly iterations: number;
  /** Cuánto se corrige cada costura por pasada, de 0 a 1. */
  readonly seamStiffness: number;
  /** Cuánto se corrige cada arista estirada o encogida, de 0 a 1. */
  readonly edgeStiffness: number;
  /**
   * Corrección máxima por costura y pasada, en mm.
   *
   * ── Por qué hace falta un tope ───────────────────────────────────────────
   *
   * Hay costuras que esta fase no puede cerrar: la copa de manga tiene que
   * salvar los 270 mm que separan la sisa del brazo, y eso no es un desajuste
   * local sino una forma que un envoltorio cilíndrico no sabe representar.
   * Sin tope, la restricción tira de esos vértices con toda su fuerza en cada
   * pasada y desgarra el panel entero para acercarlos un poco: la deformación
   * media pasaba del 7 % al 19 % a cambio de cerrar veinte milímetros.
   *
   * Con tope, las costuras que están cerca se cierran igual y las imposibles se
   * quedan tirando suavemente sin arrastrar la prenda. Es preferible verlas
   * abiertas y saber que lo están.
   */
  readonly maxSeamPullMm: number;
}

export interface RelaxReport {
  readonly iterations: number;
  /** Separación máxima que queda entre dos vértices cosidos, en mm. */
  readonly maxSeamGapMm: number;
  readonly meanSeamGapMm: number;
  /** Vértices que siguen dentro del cuerpo al terminar. */
  readonly penetrating: number;
}

/**
 * RELAJACIÓN CINEMÁTICA — cerrar las costuras sin simular.
 *
 * ── Qué es y qué no es ─────────────────────────────────────────────────────
 *
 * Es una proyección de posiciones al estilo Gauss-Seidel: se recorren las
 * restricciones y cada una corrige un poco los dos vértices que toca, en
 * pasadas sucesivas. NO hay masa, ni velocidad, ni gravedad, ni paso de tiempo.
 * El resultado es determinista y estático: la misma entrada da siempre la misma
 * prenda vestida, y no hay nada que pueda «explotar».
 *
 * ── Por qué esto no es tirar trabajo de cara a la Fase 13 ──────────────────
 *
 * Es exactamente el bucle interior de un solver XPBD, sin la parte dinámica.
 * Añadir masa, velocidad, gravedad, subpasos y el término de complianza
 * convierte esto en el solver de tela; las restricciones de costura y de
 * longitud son literalmente las mismas. La Fase 13 amplía este bucle, no lo
 * sustituye.
 *
 * ── Por qué el orden importa y aun así se acepta ───────────────────────────
 *
 * Gauss-Seidel usa las correcciones ya aplicadas dentro de la misma pasada, así
 * que el resultado depende del orden de las restricciones. Converge mucho más
 * deprisa que Jacobi —la mitad de pasadas para el mismo residuo— y el sesgo que
 * introduce es imperceptible frente a la aproximación de partida. Lo que sí hay
 * que garantizar es que el orden sea FIJO, y lo es: viene de la malla.
 */
export function relax(
  positions: Float32Array,
  constraints: RelaxConstraints,
  collider: BodyCollider,
  options: RelaxOptions,
): RelaxReport {
  const { edges, restLengths, seams } = constraints;

  for (let pass = 0; pass < options.iterations; pass++) {
    /*
     * Las costuras primero: son el objetivo. Las longitudes después, para que
     * la última palabra sobre cuánto puede estirarse la tela la tenga la tela y
     * no la costura — al revés, una costura tirante deformaría la pieza entera.
     */
    for (let i = 0; i + 1 < seams.length; i += 2) {
      project(
        positions,
        seams[i] ?? 0,
        seams[i + 1] ?? 0,
        0,
        options.seamStiffness,
        options.maxSeamPullMm,
      );
    }

    for (let i = 0; i + 1 < edges.length; i += 2) {
      project(
        positions,
        edges[i] ?? 0,
        edges[i + 1] ?? 0,
        restLengths[i / 2] ?? 0,
        options.edgeStiffness,
      );
    }

    resolveCollisions(positions, collider);
  }

  return report(positions, seams, collider, options.iterations);
}

/** Acerca o separa dos vértices hasta la distancia pedida, parcialmente. */
function project(
  positions: Float32Array,
  a: number,
  b: number,
  rest: number,
  stiffness: number,
  maxPullMm = Infinity,
): void {
  const ia = a * 3;
  const ib = b * 3;

  const dx = (positions[ib] ?? 0) - (positions[ia] ?? 0);
  const dy = (positions[ib + 1] ?? 0) - (positions[ia + 1] ?? 0);
  const dz = (positions[ib + 2] ?? 0) - (positions[ia + 2] ?? 0);

  const distance = Math.hypot(dx, dy, dz);
  if (distance <= 1e-9) return;

  // La mitad a cada vértice: sin masas, todos pesan lo mismo.
  const wanted = (distance - rest) * stiffness;
  const applied = Math.sign(wanted) * Math.min(Math.abs(wanted), maxPullMm);
  const correction = (applied / distance) * 0.5;

  positions[ia] = (positions[ia] ?? 0) + dx * correction;
  positions[ia + 1] = (positions[ia + 1] ?? 0) + dy * correction;
  positions[ia + 2] = (positions[ia + 2] ?? 0) + dz * correction;

  positions[ib] = (positions[ib] ?? 0) - dx * correction;
  positions[ib + 1] = (positions[ib + 1] ?? 0) - dy * correction;
  positions[ib + 2] = (positions[ib + 2] ?? 0) - dz * correction;
}

/**
 * Saca del cuerpo los vértices que hayan entrado.
 *
 * Va después de las demás restricciones y no se promedia con ellas: la
 * prohibición de atravesar el cuerpo no admite grados. Una tela ligeramente
 * más tirante de lo debido pasa desapercibida; una manga metida dentro del
 * brazo se ve desde el primer momento.
 */
function resolveCollisions(positions: Float32Array, collider: BodyCollider): void {
  for (let i = 0; i + 2 < positions.length; i += 3) {
    for (const rings of collider.parts) {
      const y = positions[i + 1] ?? 0;
      const section = sectionAt(rings, y);
      if (section === null) continue;

      const point = { x: positions[i] ?? 0, y, z: positions[i + 2] ?? 0 };
      const outside = pushOutside(section, point, collider.clearanceMm);
      if (outside === null) continue;

      positions[i] = outside.x;
      positions[i + 2] = outside.z;
    }
  }
}

function report(
  positions: Float32Array,
  seams: Uint32Array,
  collider: BodyCollider,
  iterations: number,
): RelaxReport {
  let maxSeamGapMm = 0;
  let totalGap = 0;
  let pairs = 0;

  for (let i = 0; i + 1 < seams.length; i += 2) {
    const ia = (seams[i] ?? 0) * 3;
    const ib = (seams[i + 1] ?? 0) * 3;

    const gap = Math.hypot(
      (positions[ib] ?? 0) - (positions[ia] ?? 0),
      (positions[ib + 1] ?? 0) - (positions[ia + 1] ?? 0),
      (positions[ib + 2] ?? 0) - (positions[ia + 2] ?? 0),
    );

    maxSeamGapMm = Math.max(maxSeamGapMm, gap);
    totalGap += gap;
    pairs++;
  }

  let penetrating = 0;

  for (let i = 0; i + 2 < positions.length; i += 3) {
    const y = positions[i + 1] ?? 0;
    const point = { x: positions[i] ?? 0, y, z: positions[i + 2] ?? 0 };

    for (const rings of collider.parts) {
      const section = sectionAt(rings, y);
      if (section === null) continue;
      // Medio milímetro de margen: por debajo de eso es el redondeo de la
      // interpolación de secciones, no una penetración real.
      if (pushOutside(section, point, collider.clearanceMm - 0.5) !== null) {
        penetrating++;
        break;
      }
    }
  }

  return {
    iterations,
    maxSeamGapMm,
    meanSeamGapMm: pairs === 0 ? 0 : totalGap / pairs,
    penetrating,
  };
}
