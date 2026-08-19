import type { Ring } from '@domain/avatar/types';
import type { PanelMesh } from '@domain/garment3d';
import type { PatternPiece } from '@domain/pattern/types';

import type { Section } from './bodySurface';
import { sectionAt, sectionPerimeter } from './bodySurface';

/**
 * Perfil de circunferencias de la prenda, altura a altura.
 *
 * ── LA DECISIÓN CENTRAL DE ESTA FASE ───────────────────────────────────────
 *
 * Lo obvio sería envolver los paneles sobre el cuerpo a una distancia fija. Y
 * sería incorrecto: aplastaría la holgura contra la piel, y una prenda holgada
 * y una ajustada quedarían idénticas en pantalla — justo la diferencia que uno
 * quiere ver antes de cortar.
 *
 * Lo que hace una prenda suelta al colgar es formar una superficie cuyo
 * contorno a cada altura es el del PATRÓN, no el del cuerpo. Así que el
 * perímetro se mide en el patrón y la prenda se envuelve sobre la elipse que lo
 * tiene. La holgura aparece entonces como separación real, y hay un efecto
 * secundario que vale por sí solo: los costadillos CIERRAN SIN AJUSTAR NADA.
 * Recorrer el ancho del delantero desde el centro deja exactamente el ancho de
 * la espalda hasta el centro de atrás, porque el perímetro se definió como la
 * suma de los cuatro.
 */
export interface Profile {
  readonly minY: number;
  readonly maxY: number;
  readonly stepMm: number;
  /** Circunferencia de la prenda en cada altura muestreada. */
  readonly perimeters: readonly number[];
}

/** Resolución del perfil. Más fino no aporta: las piezas varían despacio. */
const PROFILE_STEP_MM = 10;

/**
 * Anchura horizontal de un panel a una altura local dada.
 *
 * Se cuentan los cruces del contorno con la recta y se suman los tramos
 * interiores por paridad. Sumar simplemente `max − min` sería más corto y
 * estaría mal: una pinza abierta en el borde de la cintura dejaría de contar
 * como lo que es —tela que se retira— y el contorno saldría de más.
 */
export function panelWidthAt(panel: PanelMesh, localY: number): number {
  const crossings = scanline(panel, localY);
  const first = crossings[0];
  const last = crossings[crossings.length - 1];
  if (first === undefined || last === undefined) return 0;

  return panelArcFrom(crossings, last) - panelArcFrom(crossings, first);
}

/**
 * Coordenada de la pieza YA COSIDA, medida desde el `x = 0` del patrón.
 *
 * ── Sólo los huecos INTERIORES desplazan ───────────────────────────────────
 *
 * En el plano, una pinza es un hueco abierto en la pieza. Cosida, desaparece:
 * todo lo que queda a su derecha se corre hacia la izquierda tanto como medía.
 * Confundir la `x` del patrón con la posición alrededor del cuerpo abre los
 * costadillos justo lo que suman las pinzas — 68 mm medidos en la blusa.
 *
 * Pero un escote NO es una pinza. Es tela que falta en el BORDE, no un hueco
 * que se cierre, y descontarlo desplazaría el escote hasta el centro delantero:
 * la prenda se colapsaría sobre sí misma por arriba. La distinción es la que
 * separa un hueco interior —con tela a ambos lados— de un recorte del contorno.
 *
 * El origen es siempre el `x = 0` del trazado, que es el centro de la prenda.
 * Medir desde el primer trozo de tela lo movería con la altura, y con él toda
 * la pieza.
 */
export function panelArcAt(panel: PanelMesh, localX: number, localY: number): number {
  return panelArcFrom(scanline(panel, localY), localX);
}

/** Cruces del contorno con la recta horizontal, ordenados. */
function scanline(panel: PanelMesh, localY: number): number[] {
  const crossings: number[] = [];
  const boundary = boundaryLoop(panel);

  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i];
    const b = boundary[(i + 1) % boundary.length];
    if (a === undefined || b === undefined) continue;

    // Regla semiabierta: cada vértice pertenece a un solo tramo, así que un
    // cruce justo por un vértice se cuenta una vez y no dos.
    const lower = Math.min(a.y, b.y);
    const upper = Math.max(a.y, b.y);
    if (localY < lower || localY >= upper || upper === lower) continue;

    crossings.push(a.x + ((b.x - a.x) * (localY - a.y)) / (b.y - a.y));
  }

  return crossings.sort((p, q) => p - q);
}

/** `x` menos los huecos interiores que quedan entre el origen y `x`. */
function panelArcFrom(crossings: readonly number[], x: number): number {
  const low = Math.min(0, x);
  const high = Math.max(0, x);
  let gaps = 0;

  // Los huecos interiores son los tramos IMPARES: van de un cierre al siguiente
  // arranque, con tela a los dos lados. El de antes del primer cruce y el de
  // después del último son contorno, no huecos.
  for (let i = 1; i + 1 < crossings.length; i += 2) {
    const from = crossings[i] ?? 0;
    const to = crossings[i + 1] ?? 0;

    const overlap = Math.min(high, to) - Math.max(low, from);
    if (overlap > 0) gaps += overlap;
  }

  return x < 0 ? x + gaps : x - gaps;
}

/** El contorno del panel en coordenadas de patrón, tomado de las UV. */
function boundaryLoop(panel: PanelMesh): { x: number; y: number }[] {
  const indices = new Set<number>();
  for (const list of panel.boundary.values()) {
    for (const index of list) indices.add(index);
  }

  /*
   * Los índices del contorno son los primeros de la triangulación y van en
   * orden alrededor de la pieza (ver `triangulatePolygon`), así que ordenarlos
   * reconstruye el bucle.
   */
  return [...indices]
    .sort((a, b) => a - b)
    .map((index) => ({ x: panel.uv[index * 2] ?? 0, y: panel.uv[index * 2 + 1] ?? 0 }));
}

export interface ProfileInput {
  readonly panel: PanelMesh;
  /** Altura de la escena en la que cae el `y = 0` del patrón. */
  readonly heightOrigin: number;
}

/**
 * Franja en la que la pieza es un TUBO COMPLETO, en coordenadas locales.
 *
 * ── El artefacto que arregla ───────────────────────────────────────────────
 *
 * La cintura de una falda no es horizontal: sube hacia el costado, y encima
 * lleva pinzas. Medir la anchura sobre una recta a cinco milímetros del borde
 * superior corta la pieza donde ya casi no hay, y da 436 mm de contorno donde
 * la prenda mide 780. La falda saldría estrangulada justo en la cintura, que es
 * donde peor se ve.
 *
 * Y sin embargo la cintura se corta curva PRECISAMENTE para que, puesta, quede
 * a nivel. Así que el contorno «a la altura de la cintura» es el que hay justo
 * por debajo de la franja conformada, no el de dentro de ella.
 *
 * Dónde acaba esa franja se sabe con exactitud, sin estimar nada: es donde
 * terminan las aristas LATERALES —costadillo y centro—, que son las que
 * delimitan el tubo. Por encima del final de la más corta, la pieza ya no da la
 * vuelta y su anchura deja de significar un contorno.
 */
export function tubeRange(panel: PanelMesh, piece: PatternPiece): { low: number; high: number } | null {
  let low = -Infinity;
  let high = Infinity;
  let found = false;

  for (const edge of piece.edges) {
    if (!SIDE_ROLES.has(edge.role)) continue;

    const indices = panel.boundary.get(edge.id);
    if (indices === undefined || indices.length === 0) continue;

    let edgeLow = Infinity;
    let edgeHigh = -Infinity;

    for (const index of indices) {
      const y = panel.uv[index * 2 + 1] ?? 0;
      edgeLow = Math.min(edgeLow, y);
      edgeHigh = Math.max(edgeHigh, y);
    }

    // La franja común: la limita la lateral más corta por cada lado.
    low = Math.max(low, edgeLow);
    high = Math.min(high, edgeHigh);
    found = true;
  }

  return found && high > low ? { low, high } : null;
}

/** Aristas que delimitan el tubo de la prenda a los lados. */
const SIDE_ROLES = new Set(['side', 'center-front', 'center-back', 'underarm']);

/** Suma las anchuras de todos los paneles del grupo, altura a altura. */
export function buildProfile(
  inputs: readonly ProfileInput[],
  pieces: ReadonlyMap<string, PatternPiece>,
): Profile | null {
  if (inputs.length === 0) return null;

  let minY = Infinity;
  let maxY = -Infinity;

  const ranges = inputs.map(({ panel }) => {
    const piece = pieces.get(String(panel.piece));
    const tube = piece === undefined ? null : tubeRange(panel, piece);

    let extentLow = Infinity;
    let extentHigh = -Infinity;
    for (let i = 1; i < panel.uv.length; i += 2) {
      const y = panel.uv[i] ?? 0;
      extentLow = Math.min(extentLow, y);
      extentHigh = Math.max(extentHigh, y);
    }

    return { tube, extentLow, extentHigh };
  });

  for (const { panel, heightOrigin } of inputs) {
    for (let i = 1; i < panel.uv.length; i += 2) {
      const y = heightOrigin + (panel.uv[i] ?? 0);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }

  if (!Number.isFinite(minY) || maxY <= minY) return null;

  /*
   * Se muestrea en el CENTRO de cada franja, nunca en los extremos. Justo en el
   * borde superior de una pieza el contorno no cruza la recta y la anchura sale
   * cero, con lo que la cintura de una falda —que es precisamente su borde
   * superior— aparecería con contorno nulo. No es un caso raro: es el borde que
   * más importa.
   */
  const steps = Math.max(2, Math.ceil((maxY - minY) / PROFILE_STEP_MM));
  const stepMm = (maxY - minY) / steps;
  const perimeters: number[] = [];

  for (let i = 0; i < steps; i++) {
    const y = minY + stepMm * (i + 0.5);

    let total = 0;
    inputs.forEach(({ panel, heightOrigin }, index) => {
      const range = ranges[index];
      if (range === undefined) return;

      const localY = y - heightOrigin;

      /*
       * Fuera del alcance vertical de la pieza no aporta NADA. El recorte a la
       * franja conformada sólo vale dentro: aplicarlo también fuera hacía que
       * el cuerpo de un vestido sumara su contorno de cintura a la altura de la
       * cadera, y la falda salía del doble de ancha.
       */
      /*
       * Semiabierto por arriba. En un vestido, el cuerpo acaba exactamente
       * donde empieza la falda, y contando el borde en las dos piezas la
       * cintura sumaba el doble de contorno del que tiene.
       */
      if (localY < range.extentLow || localY >= range.extentHigh) return;

      // Dentro de la franja conformada se lee el contorno del borde de la
      // franja, que es el que la prenda tiene de verdad ahí.
      const sampleAt = range.tube === null
        ? localY
        : Math.min(range.tube.high, Math.max(range.tube.low, localY));

      total += panelWidthAt(panel, sampleAt);
    });

    perimeters.push(total);
  }

  return { minY: minY + stepMm / 2, maxY, stepMm, perimeters };
}

/** Circunferencia de la prenda a una altura, interpolada. */
export function perimeterAt(profile: Profile, y: number): number {
  const { perimeters } = profile;
  const last = perimeters.length - 1;
  if (last < 0) return 0;

  const position = (y - profile.minY) / Math.max(profile.stepMm, 1e-9);
  if (position <= 0) return perimeters[0] ?? 0;
  if (position >= last) return perimeters[last] ?? 0;

  const index = Math.floor(position);
  const t = position - index;

  return (perimeters[index] ?? 0) * (1 - t) + (perimeters[index + 1] ?? 0) * t;
}

/**
 * La sección sobre la que se viste: la del cuerpo, dilatada hasta el perímetro
 * de la prenda.
 *
 * Si el patrón pide menos contorno que el cuerpo —holgura negativa, o una talla
 * por debajo de las medidas— la sección se queda en la del cuerpo más la
 * separación mínima. La prenda no puede atravesar a quien la lleva; que va
 * apretada lo dirá el mapa de tensión, que para eso está.
 */
export function fitSection(
  rings: readonly Ring[],
  profile: Profile | null,
  y: number,
  clearanceMm: number,
): Section | null {
  const body = sectionAt(rings, y);
  if (body === null) return null;

  const floor: Section = {
    centerX: body.centerX,
    centerZ: body.centerZ,
    halfWidth: body.halfWidth + clearanceMm,
    halfDepth: body.halfDepth + clearanceMm,
  };

  if (profile === null) return floor;

  const wanted = perimeterAt(profile, y);
  const minimum = sectionPerimeter(floor);
  if (wanted <= minimum) return floor;

  /*
   * Se dilata sumando la MISMA cantidad a los dos semiejes, no multiplicando.
   * Escalar deformaría la sección —un torso holgado se volvería más plano de lo
   * que es— mientras que sumar es lo que hace una tela separada del cuerpo: una
   * superficie paralela a la piel, a distancia constante.
   */
  const extra = solveOffsetForPerimeter(floor, wanted);

  return {
    centerX: floor.centerX,
    centerZ: floor.centerZ,
    halfWidth: floor.halfWidth + extra,
    halfDepth: floor.halfDepth + extra,
  };
}

/**
 * Cuánto hay que separarse de la sección para que su perímetro sea el pedido.
 *
 * El perímetro crece de forma monótona con la separación, así que basta con
 * bisecar. La cota superior es generosa: si toda la sección fuese una
 * circunferencia, la separación necesaria sería la diferencia de perímetros
 * dividida por 2π, y con una elipse hace falta algo menos.
 */
function solveOffsetForPerimeter(section: Section, wanted: number): number {
  const current = sectionPerimeter(section);
  if (wanted <= current) return 0;

  let low = 0;
  let high = (wanted - current) / Math.PI + 1;

  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    const perimeter = sectionPerimeter({
      centerX: section.centerX,
      centerZ: section.centerZ,
      halfWidth: section.halfWidth + mid,
      halfDepth: section.halfDepth + mid,
    });

    if (perimeter < wanted) low = mid;
    else high = mid;
  }

  return (low + high) / 2;
}
