import type { Rect } from '@core/geometry/rect';
import type { Vec2 } from '@core/geometry/vec2';

import type { Avatar, Vec3 } from '@domain/avatar/types';
import { vec3 } from '@domain/avatar/types';
import { pieceBounds } from '@domain/pattern/piece';
import type { PatternPiece } from '@domain/pattern/types';

import type { PanelPlacement } from './types';

export type PanelKind = 'bodiceFront' | 'bodiceBack' | 'skirtFront' | 'skirtBack' | 'sleeve' | 'band';

/**
 * Clasifica la pieza por sus ARISTAS, no por su nombre.
 *
 * Una pieza con copa es una manga; una con hombro es un cuerpo; una con bajo y
 * cintura pero sin hombro es una falda. La alternativa —mirar si el
 * identificador contiene «Sleeve»— funcionaría hoy y se rompería en cuanto un
 * generador nuevo bautizara sus piezas de otra manera. Los papeles de arista
 * son parte del modelo y no cambian.
 */
export function classifyPanel(piece: PatternPiece): PanelKind {
  const roles = new Set(piece.edges.map((edge) => edge.role));
  const isFront = roles.has('center-front');

  if (roles.has('sleeve-cap')) return 'sleeve';
  if (roles.has('shoulder')) return isFront ? 'bodiceFront' : 'bodiceBack';
  if (roles.has('hem') && roles.has('waist')) return isFront ? 'skirtFront' : 'skirtBack';

  return 'band';
}

/**
 * ¿Es esta arista el plano de simetría de la pieza?
 *
 * Sólo lo son las de centro delantero y centro espalda. El trazado las sitúa
 * siempre en `x = 0`, que es lo que permite obtener la otra mitad reflejando.
 *
 * Ojo con confundirlo con «va al doblez»: una pretina también se traza al
 * doblez, pero a lo LARGO —se pliega sobre sí misma para quedar de doble
 * grosor— y ese doblez superpone las dos mitades en vez de extender la prenda.
 */
export const isCenterEdge = (edge: PatternPiece['edges'][number]): boolean =>
  edge.role === 'center-front' || edge.role === 'center-back';

/**
 * Cuántas veces se instancia la pieza en la prenda montada.
 *
 * Una pieza con arista de centro es MEDIA prenda: hay que reflejarla para tener
 * la otra mitad, tanto si el centro va al doblez como si lleva costura o
 * cremallera. Una manga se corta dos veces, una por brazo. En ambos casos son
 * dos instancias, y lo único que cambia es cómo se unen.
 */
export function instanceCount(piece: PatternPiece): number {
  if (piece.edges.some(isCenterEdge)) return 2;
  return piece.cutCount >= 2 ? 2 : 1;
}

/**
 * Sitúa cada pieza alrededor del cuerpo, ANTES de simular.
 *
 * ── Planos tangentes, no envolvente ────────────────────────────────────────
 *
 * Las piezas se colocan PLANAS sobre planos tangentes a un cilindro alrededor
 * del cuerpo, no envueltas sobre él. Envolverlas parece más directo pero es
 * peor: introduciría una deformación arbitraria antes de que el solver diga
 * nada, y esa deformación se confundiría después con la que produce la propia
 * tela. Planas, la geometría de partida es exactamente el patrón, y todo lo que
 * ocurra después lo habrá hecho la simulación.
 *
 * Es lo mismo que hacen las herramientas del sector: las piezas flotan
 * alrededor del maniquí y la simulación las cierra.
 */
export function planPlacement(
  piece: PatternPiece,
  instance: number,
  avatar: Avatar,
): PanelPlacement {
  const kind = classifyPanel(piece);
  const bounds = pieceBounds(piece);
  const mirrored = instance === 1;

  const waist = avatar.levels.waist ?? 0;
  const shoulder = avatar.levels.shoulder ?? 0;
  const bodyRadius = bodyHalfDepth(avatar);

  switch (kind) {
    case 'bodiceFront':
      return front(bodyRadius + 90, waist, mirrored);
    case 'bodiceBack':
      return back(bodyRadius + 90, waist, mirrored);

    /*
     * En una falda el `y = 0` del patrón es el BAJO y la cintura queda arriba,
     * al contrario que en un cuerpo. Se alinea por el borde superior de la
     * pieza para que la cintura del patrón caiga en la cintura del cuerpo.
     */
    case 'skirtFront':
      return front(bodyRadius + 110, waist - topOf(bounds), mirrored);
    case 'skirtBack':
      return back(bodyRadius + 110, waist - topOf(bounds), mirrored);

    case 'sleeve':
      return {
        // Junto al brazo, a un lado y a otro.
        azimuth: mirrored ? -Math.PI / 2 : Math.PI / 2,
        radiusMm: armDistance(avatar),
        // El `y = 0` de la manga es la línea de sobaco; la copa queda por encima.
        originHeightMm: shoulder - 40,
        offsetMm: 0,
        mirrored,
      };

    /*
     * La pretina se deja JUSTO ENCIMA de la cintura de la falda, delante y a la
     * misma distancia del cuerpo que ella. Así se lee como lo que es —una tira
     * lista para montar sobre ese borde— en vez de como un cinturón flotando a
     * media altura. Es larga, de todo el contorno de cintura, así que se centra
     * para que sobresalga por igual a ambos lados.
     */
    case 'band':
      return {
        azimuth: 0,
        radiusMm: bodyRadius + 150,
        originHeightMm: waist + 40,
        offsetMm: -((bounds?.max.x ?? 0) + (bounds?.min.x ?? 0)) / 2,
        mirrored: false,
      };
  }
}

const front = (radiusMm: number, originHeightMm: number, mirrored: boolean): PanelPlacement => ({
  azimuth: 0,
  radiusMm,
  originHeightMm,
  offsetMm: 0,
  mirrored,
});

const back = (radiusMm: number, originHeightMm: number, mirrored: boolean): PanelPlacement => ({
  azimuth: Math.PI,
  radiusMm,
  originHeightMm,
  offsetMm: 0,
  mirrored,
});

const topOf = (bounds: Rect | null): number => bounds?.max.y ?? 0;

/** Semiprofundidad del torso, para separar las piezas del cuerpo. */
function bodyHalfDepth(avatar: Avatar): number {
  let maxZ = 0;
  const { positions } = avatar.parts.torso;

  for (let i = 2; i < positions.length; i += 3) {
    maxZ = Math.max(maxZ, Math.abs(positions[i] ?? 0));
  }

  return maxZ;
}

/** Distancia del eje del cuerpo al exterior del brazo. */
function armDistance(avatar: Avatar): number {
  let maxX = 0;

  for (const arm of avatar.parts.arms) {
    for (let i = 0; i < arm.positions.length; i += 3) {
      maxX = Math.max(maxX, Math.abs(arm.positions[i] ?? 0));
    }
  }

  return maxX + 130;
}

/**
 * Lleva un punto del patrón a la escena.
 *
 * El eje X del patrón corre a lo largo de la tangente del cilindro y el Y del
 * patrón es el Y del mundo: la prenda cuelga como colgaría la tela. Reflejar
 * una instancia invierte la coordenada tangencial, lo que además obliga a
 * invertir el sentido de los triángulos para que las caras sigan mirando hacia
 * fuera.
 */
export function panelPointToWorld(point: Vec2, placement: PanelPlacement): Vec3 {
  const tangential = (placement.mirrored ? -point.x : point.x) + placement.offsetMm;

  const normalX = Math.sin(placement.azimuth);
  const normalZ = Math.cos(placement.azimuth);
  const tangentX = Math.cos(placement.azimuth);
  const tangentZ = -Math.sin(placement.azimuth);

  return vec3(
    normalX * placement.radiusMm + tangentX * tangential,
    placement.originHeightMm + point.y,
    normalZ * placement.radiusMm + tangentZ * tangential,
  );
}

/** Normal del plano en que se apoya el panel: hacia fuera del cuerpo. */
export const panelNormal = (placement: PanelPlacement): Vec3 =>
  vec3(Math.sin(placement.azimuth), 0, Math.cos(placement.azimuth));
