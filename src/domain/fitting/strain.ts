/**
 * Tensión de la tela: cuánto se ha estirado o encogido respecto al patrón.
 *
 * ── Por qué esto es la medida útil y no la geometría ───────────────────────
 *
 * Una prenda vestida puede parecer perfecta y ser incómoda. Lo que dice si va
 * bien no es la forma, sino cuánto le falta o le sobra tela a cada zona, y eso
 * se sabe comparando cada arista de la malla con su longitud EN EL PATRÓN —que
 * es la longitud que esa arista tiene en la tela cortada.
 *
 * ── Y por qué esta cifra no es un artefacto del método ─────────────────────
 *
 * Un plano no se puede aplicar sobre una superficie de doble curvatura sin
 * deformarlo: es el Teorema Egregio de Gauss, y no hay algoritmo que lo esquive.
 * Así que envolver un panel plano sobre el cuerpo SIEMPRE introduce tensión. La
 * pregunta útil no es si aparece, sino DÓNDE y CUÁNTA: donde el patrón tiene la
 * curvatura que le toca —por las pinzas, por la copa de manga— la tensión es
 * pequeña; donde no, se dispara. Ese contraste es el diagnóstico.
 */
export interface StrainField {
  /** Deformación por vértice: negativa comprime, positiva estira. */
  readonly perVertex: Float32Array;
  readonly maxStretch: number;
  readonly maxCompression: number;
  /** Media de |deformación|, en tanto por uno. */
  readonly meanAbs: number;
  /**
   * Percentil 95 de |deformación|.
   *
   * El máximo lo fijan un puñado de aristas en la esquina de hombro y escote,
   * donde el método no llega; una sola cifra extrema no dice nada del resto de
   * la prenda. El percentil sí: describe cómo está la tela de verdad.
   */
  readonly p95Abs: number;
  /** Fracción de aristas que se salen del margen tolerable. */
  readonly overTolerance: number;
}

/** Por encima de esto la tela deja de absorberlo con la caída y se marca. */
export const STRAIN_TOLERANCE = 0.05;

export function computeStrain(
  positions: Float32Array,
  edges: Uint32Array,
  restLengths: Float32Array,
  vertexCount: number,
): StrainField {
  const sum = new Float32Array(vertexCount);
  const count = new Float32Array(vertexCount);

  let maxStretch = 0;
  let maxCompression = 0;
  let totalAbs = 0;
  let over = 0;
  let edgeCount = 0;
  const absolutes: number[] = [];

  for (let i = 0; i + 1 < edges.length; i += 2) {
    const a = edges[i] ?? 0;
    const b = edges[i + 1] ?? 0;
    const rest = restLengths[i / 2] ?? 0;
    if (rest <= 1e-6) continue;

    const ia = a * 3;
    const ib = b * 3;

    const length = Math.hypot(
      (positions[ib] ?? 0) - (positions[ia] ?? 0),
      (positions[ib + 1] ?? 0) - (positions[ia + 1] ?? 0),
      (positions[ib + 2] ?? 0) - (positions[ia + 2] ?? 0),
    );

    const strain = (length - rest) / rest;

    sum[a] = (sum[a] ?? 0) + strain;
    sum[b] = (sum[b] ?? 0) + strain;
    count[a] = (count[a] ?? 0) + 1;
    count[b] = (count[b] ?? 0) + 1;

    maxStretch = Math.max(maxStretch, strain);
    maxCompression = Math.min(maxCompression, strain);
    totalAbs += Math.abs(strain);
    absolutes.push(Math.abs(strain));
    if (Math.abs(strain) > STRAIN_TOLERANCE) over++;
    edgeCount++;
  }

  absolutes.sort((a, b) => a - b);
  const p95Abs = absolutes.length === 0
    ? 0
    : absolutes[Math.min(absolutes.length - 1, Math.floor(absolutes.length * 0.95))] ?? 0;

  const perVertex = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const n = count[i] ?? 0;
    perVertex[i] = n === 0 ? 0 : (sum[i] ?? 0) / n;
  }

  return {
    perVertex,
    maxStretch,
    maxCompression,
    meanAbs: edgeCount === 0 ? 0 : totalAbs / edgeCount,
    p95Abs,
    overTolerance: edgeCount === 0 ? 0 : over / edgeCount,
  };
}

/**
 * Color de la tensión: azul comprime, gris neutro, rojo estira.
 *
 * Es una rampa DIVERGENTE, no un degradado de un solo color, porque estirar y
 * comprimir son problemas distintos y opuestos —falta de tela y sobra de
 * tela—, y una rampa lineal los confundiría en los extremos. El gris del centro
 * marca el reposo, que es donde debería estar casi toda la prenda.
 */
export function strainColor(strain: number, scale = STRAIN_TOLERANCE * 2): [number, number, number] {
  const t = Math.max(-1, Math.min(1, strain / Math.max(scale, 1e-9)));

  if (t >= 0) {
    return [0.62 + 0.36 * t, 0.62 - 0.36 * t, 0.62 - 0.44 * t];
  }

  return [0.62 - 0.42 * -t, 0.62 - 0.14 * -t, 0.62 + 0.34 * -t];
}
