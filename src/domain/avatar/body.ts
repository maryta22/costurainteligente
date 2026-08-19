import type { BodyMeasurements } from '@domain/measurements/types';

import { DEPTH_RATIOS, axesForPerimeter } from './crossSection';
import { loft, mergeMeshes } from './loft';
import type { Avatar, AvatarParts, BodySections, Landmarks, MeshData, Ring } from './types';
import { vec3 } from './types';

/** Anillos por miembro. Menos que el torso: son casi cónicos. */
const LIMB_RADIAL = 20;
const TORSO_RADIAL = 40;

const ring = (y: number, perimeter: number, ratio: number, x = 0, z = 0): Ring => {
  const axes = axesForPerimeter(perimeter, ratio);
  return { center: vec3(x, y, z), halfWidth: axes.halfWidth, halfDepth: axes.halfDepth };
};

/**
 * MANIQUÍ PARAMÉTRICO — el cuerpo se GENERA a partir de las medidas.
 *
 * ── Por qué no se usa un modelo comprado ni descargado (riesgo R4) ─────────
 *
 * El plan original era un GLB base con «morph targets» accionados por las
 * medidas. Se descartó por tres razones, y la primera es la que decide:
 *
 *   · LICENCIAS. Los cuerpos paramétricos de referencia —la familia SMPL— son
 *     de licencia de investigación, no comercial. Adoptar uno hipotecaría el
 *     proyecto entero, y el problema aparecería tarde.
 *   · EXACTITUD. Un morph target interpola entre formas esculpidas: el cuerpo
 *     resultante se PARECE a las medidas pedidas. Aquí cada sección se resuelve
 *     para tener exactamente el perímetro medido, de modo que el maniquí mide
 *     lo que dice medir — que es la única forma de que probar una prenda sobre
 *     él signifique algo.
 *   · CADENA DE MONTAJE. No hay que versionar, cargar ni descomprimir un
 *     activo binario de varios megas.
 *
 * A cambio es un MANIQUÍ, no una persona: no tiene musculatura ni asimetrías.
 * Para probar la caída de una prenda y para servir de colisionador al solver de
 * tela es justamente lo que hace falta. Si algún día se quiere un cuerpo
 * esculpido, entra detrás de esta misma interfaz.
 */
export function buildAvatar(m: BodyMeasurements): Avatar {
  const levels = bodyLevels(m);
  const landmarks = bodyLandmarks(m, levels);

  /*
   * Los anillos se guardan además de la malla. La malla sirve para dibujar; los
   * anillos son la descripción ANALÍTICA del cuerpo, y con ella se resuelve en
   * unas operaciones lo que sobre la malla costaría recorrer miles de
   * triángulos: a qué distancia del eje está la piel a una altura dada, si un
   * punto ha entrado en el cuerpo, por dónde sacarlo. Vestir la prenda (Fase 12)
   * y hacerla colisionar (Fase 13) preguntan eso constantemente.
   */
  const torso = torsoRings(m, levels);
  const arms = armRings(m, levels);
  const legs = legRings(m, levels);

  const parts: AvatarParts = {
    torso: loft(torso, { radialSegments: TORSO_RADIAL, subdivisions: 5, capStart: true }),
    head: buildHead(m, levels),
    arms: arms.map((rings) => loftLimb(rings)),
    legs: legs.map((rings) => loftLimb(rings)),
  };

  /*
   * Ordenadas de abajo arriba, SIEMPRE. El torso ya se traza así, pero los
   * miembros se trazan del hombro a la muñeca y de la cadera al tobillo, que es
   * como se piensan al construirlos. Consultarlos exige lo contrario, y ordenar
   * aquí evita que cada consulta tenga que preguntarse en qué sentido vienen.
   *
   * No se reordenan los que van al «loft»: invertirlos cambiaría el sentido de
   * los triángulos y el miembro se vería del revés.
   */
  const sections: BodySections = {
    torso: ascending(torso),
    arms: arms.map(ascending),
    legs: legs.map(ascending),
  };

  const mesh = mergeMeshes([parts.torso, parts.head, ...parts.legs, ...parts.arms]);

  return { mesh, parts, sections, landmarks, levels, heightMm: m.height };
}

const ascending = (rings: readonly Ring[]): Ring[] =>
  [...rings].sort((a, b) => a.center.y - b.center.y);

const loftLimb = (rings: readonly Ring[]): MeshData =>
  loft(rings, { radialSegments: LIMB_RADIAL, subdivisions: 3, capEnd: true });

/**
 * Alturas de las secciones clave, medidas desde el suelo.
 *
 * Se derivan de las medidas verticales reales —cintura al suelo, largo de talle,
 * altura de pecho— y no de proporciones sobre la estatura. Es la diferencia
 * entre un cuerpo que responde a quien lo mide y un maniquí genérico estirado.
 */
function bodyLevels(m: BodyMeasurements): Record<string, number> {
  const waist = m.waistToFloor;
  const shoulder = waist + m.napeToWaist;

  return {
    floor: 0,
    ankle: 70,
    knee: waist - m.waistToKnee,
    crotch: waist - m.waistToHip - 90,
    hip: waist - m.waistToHip,
    waist,
    bust: shoulder - m.bustHeight,
    // El bajo pecho está DEBAJO del pecho. Con el signo cambiado los anillos
    // del torso dejaban de ir en orden de altura, y todo lo que interpola entre
    // secciones —vestir la prenda, colisionarla— leía el contorno equivocado.
    underbust: shoulder - m.bustHeight - 55,
    shoulder,
    neck: shoulder + 25,
    chin: shoulder + 95,
    headTop: m.height,
  };
}

function bodyLandmarks(m: BodyMeasurements, levels: Record<string, number>): Landmarks {
  const halfShoulder = m.backWidth / 2 + m.shoulderLength * 0.55;
  const armY = levels.shoulder ?? 0;

  return {
    neck: vec3(0, levels.neck ?? 0, 0),
    shoulderLeft: vec3(-halfShoulder, armY, 0),
    shoulderRight: vec3(halfShoulder, armY, 0),
    bust: vec3(0, levels.bust ?? 0, 0),
    underbust: vec3(0, levels.underbust ?? 0, 0),
    waist: vec3(0, levels.waist ?? 0, 0),
    hip: vec3(0, levels.hip ?? 0, 0),
    crotch: vec3(0, levels.crotch ?? 0, 0),
    kneeLeft: vec3(-m.hip * 0.13, levels.knee ?? 0, 0),
    kneeRight: vec3(m.hip * 0.13, levels.knee ?? 0, 0),
    wristLeft: vec3(-halfShoulder, armY - m.armLength, 0),
    wristRight: vec3(halfShoulder, armY - m.armLength, 0),
  };
}

/**
 * Torso: de la cadera al cuello.
 *
 * Cada sección se resuelve para tener EXACTAMENTE el perímetro medido. Es la
 * propiedad que hace útil el maniquí: una cinta métrica alrededor de su cintura
 * da la cintura introducida.
 *
 * Las dos secciones que no vienen de una medida directa son la del hombro
 * —derivada del ancho de espalda, porque ahí el cuerpo deja de ser un tubo— y
 * la del bajo vientre, interpolada entre cadera y entrepierna.
 */
function torsoRings(m: BodyMeasurements, levels: Record<string, number>): Ring[] {
  const shoulderPerimeter = (m.backWidth + m.shoulderLength) * 2.05;

  return [
    ring((levels.crotch ?? 0) - 20, m.hip * 0.98, DEPTH_RATIOS.hip),
    ring(levels.hip ?? 0, m.hip, DEPTH_RATIOS.hip),
    ring((levels.hip ?? 0) + ((levels.waist ?? 0) - (levels.hip ?? 0)) * 0.5, (m.hip + m.waist) / 2, 0.76),
    ring(levels.waist ?? 0, m.waist, DEPTH_RATIOS.waist),
    ring(levels.underbust ?? 0, m.underbust, DEPTH_RATIOS.underbust),
    ring(levels.bust ?? 0, m.bust, DEPTH_RATIOS.bust),
    ring((levels.bust ?? 0) + ((levels.shoulder ?? 0) - (levels.bust ?? 0)) * 0.6, m.bust * 0.94, 0.66),
    ring(levels.shoulder ?? 0, shoulderPerimeter, DEPTH_RATIOS.shoulder),
    ring((levels.shoulder ?? 0) + 18, m.neck * 1.5, 0.8),
    ring(levels.neck ?? 0, m.neck, DEPTH_RATIOS.neck),
  ];
}

/** Cabeza: un elipsoide sencillo. No influye en el patronaje. */
function buildHead(m: BodyMeasurements, levels: Record<string, number>): MeshData {
  const top = levels.headTop ?? m.height;
  const base = levels.neck ?? 0;
  const height = top - base;
  const halfWidth = height * 0.34;

  const rings: Ring[] = [];
  const steps = 8;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Semicircunferencia vertical: da la silueta del cráneo.
    const radius = Math.sin(t * Math.PI * 0.92 + 0.08) * halfWidth;
    rings.push({
      center: vec3(0, base + height * t, 0),
      halfWidth: radius,
      halfDepth: radius * 1.12,
    });
  }

  return loft(rings, { radialSegments: 20, subdivisions: 2, capEnd: true });
}

/** Piernas: dos troncos cónicos de la entrepierna al tobillo. */
function legRings(m: BodyMeasurements, levels: Record<string, number>): Ring[][] {
  const separation = m.hip * 0.13;
  const crotch = levels.crotch ?? 0;
  const knee = levels.knee ?? 0;
  const ankle = levels.ankle ?? 70;

  return [-1, 1].map((side) => {
    const x = side * separation;

    return [
      ring(crotch + 30, m.hip * 0.6, DEPTH_RATIOS.thigh, x),
      ring(crotch - (crotch - knee) * 0.4, m.hip * 0.52, DEPTH_RATIOS.thigh, x),
      ring(knee, m.hip * 0.39, DEPTH_RATIOS.knee, x),
      ring(knee - (knee - ankle) * 0.35, m.hip * 0.36, DEPTH_RATIOS.knee, x),
      ring(ankle, m.hip * 0.24, DEPTH_RATIOS.ankle, x),
    ];
  });
}

/**
 * Brazos: del hombro a la muñeca, ligeramente separados del cuerpo.
 *
 * Se modelan colgando casi verticales, con una pequeña apertura. La postura
 * importa para la Fase 12: una manga se coloca alrededor del brazo, y con los
 * brazos pegados al costado no habría sitio donde ponerla.
 */
function armRings(m: BodyMeasurements, levels: Record<string, number>): Ring[][] {
  const shoulderY = levels.shoulder ?? 0;
  const halfShoulder = m.backWidth / 2 + m.shoulderLength * 0.4;
  const spread = m.armLength * 0.13;

  return [-1, 1].map((side) => {
    const top = side * halfShoulder;
    const bottom = side * (halfShoulder + spread);

    const lerpX = (t: number): number => top + (bottom - top) * t;
    const yAt = (t: number): number => shoulderY - 30 - m.armLength * t;

    return [
      ring(shoulderY - 10, m.bicep * 1.12, DEPTH_RATIOS.arm, lerpX(0)),
      ring(yAt(0.12), m.bicep, DEPTH_RATIOS.arm, lerpX(0.12)),
      ring(yAt(0.42), m.bicep * 0.82, DEPTH_RATIOS.arm, lerpX(0.42)),
      ring(yAt(0.72), m.wrist * 1.35, DEPTH_RATIOS.arm, lerpX(0.72)),
      ring(yAt(0.95), m.wrist, DEPTH_RATIOS.arm, lerpX(0.95)),
    ];
  });
}
