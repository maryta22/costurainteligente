/**
 * ESTADO DE LA TELA — arrays planos, sin objetos por partícula.
 *
 * ── Por qué así y no un array de objetos ───────────────────────────────────
 *
 * Un `Particle[]` sería más cómodo de leer y bastante más lento: cada partícula
 * viviría en su propio hueco del montón y recorrerlas saltaría por memoria. Con
 * arrays planos el recorrido es secuencial y la caché acierta casi siempre, que
 * en un bucle que se ejecuta cien mil veces por fotograma es la diferencia entre
 * ir fluido y no ir.
 *
 * Y hay una segunda razón, de plazo más largo: un `Float32Array` es exactamente
 * lo que espera un módulo WebAssembly. Si el solver se lleva a Rust —está
 * previsto en la arquitectura— esta frontera no cambia. Con objetos habría que
 * rehacerla entera.
 */
export interface ClothState {
  readonly count: number;
  /** Posición actual, tres por partícula, en mm. */
  readonly positions: Float32Array;
  /** Posición al empezar el subpaso: de ahí sale la velocidad. */
  readonly previous: Float32Array;
  readonly velocities: Float32Array;
  /**
   * Inversa de la masa. Cero significa CLAVADA: no se mueve.
   *
   * Se guarda la inversa y no la masa porque es lo que aparece en todas las
   * fórmulas del solver, y porque deja expresar «infinitamente pesada» con un
   * cero en vez de con un infinito que envenenaría las cuentas.
   */
  readonly invMass: Float32Array;
}

/**
 * Restricción de distancia entre dos partículas.
 *
 * Es la que hace de tela: mantiene cada arista de la malla a la longitud que
 * tiene EN EL PATRÓN, que es la longitud de la tela cortada.
 */
export interface StretchConstraints {
  readonly count: number;
  /** Dos índices de partícula por restricción. */
  readonly pairs: Uint32Array;
  /** Longitud en el patrón, en mm. */
  readonly rest: Float32Array;
  /**
   * Complianza, en mm/N. Es la INVERSA de la rigidez.
   *
   * Se guarda por arista porque depende de su ángulo con el hilo: ver
   * `grainCompliance`. Cero sería una restricción rígida.
   */
  readonly compliance: Float32Array;
  /** Multiplicador de Lagrange acumulado dentro del subpaso. */
  readonly lambda: Float32Array;
}

/**
 * Restricción de flexión entre dos triángulos que comparten arista.
 *
 * Cuatro partículas: las dos de la arista compartida y las dos opuestas.
 */
export interface BendConstraints {
  readonly count: number;
  /** Cuatro índices por restricción: arista (0,1) y opuestos (2,3). */
  readonly quads: Uint32Array;
  /** Ángulo diedro en reposo, en radianes. Cero en una pieza plana. */
  readonly restAngle: Float32Array;
  readonly compliance: Float32Array;
  readonly lambda: Float32Array;
}

/** Parejas cosidas: su distancia objetivo es cero. */
export interface SeamConstraints {
  readonly count: number;
  readonly pairs: Uint32Array;
  readonly lambda: Float32Array;
}

export interface ClothConstraints {
  readonly stretch: StretchConstraints;
  readonly bend: BendConstraints;
  readonly seam: SeamConstraints;
}

/**
 * Colisionador: el cuerpo descrito por secciones elípticas.
 *
 * Cinco flotantes por anillo —altura, centro X, centro Z, semianchura,
 * semiprofundidad— y un array por parte. Es la misma información que usa la
 * Fase 12, aplanada: un array de estructuras no cruzaría a WebAssembly.
 */
export interface ColliderData {
  readonly parts: readonly Float32Array[];
  readonly clearanceMm: number;
  /** Rozamiento con la piel, de 0 a 1. Frena el deslizamiento tangencial. */
  readonly friction: number;
}

export const RING_STRIDE = 5;

/**
 * Propiedades del tejido.
 *
 * ── De dónde salen los números ─────────────────────────────────────────────
 *
 * La densidad superficial es la que figura en la ficha de cualquier tela y se
 * mide en gramos por metro cuadrado. Las rigideces no: se dan como complianzas
 * calibradas para que la caída se parezca a la del tejido real. No pretenden ser
 * los módulos de Young del material —un tejido no es un continuo elástico, es
 * una malla de hilos— sino reproducir su comportamiento a la vista.
 */
export interface Fabric {
  readonly id: string;
  readonly name: string;
  /** Gramos por metro cuadrado. */
  readonly arealDensity: number;
  /** Complianza al estirar en la dirección del hilo, mm/N. */
  readonly stretchCompliance: number;
  /**
   * Cuánto más blanda es la tela AL BIES, a 45° del hilo.
   *
   * Es la propiedad que distingue una tela de una lámina de goma: un tejido
   * apenas cede en trama y urdimbre —los hilos ya están tensos— pero al bies
   * cede mucho, porque ahí lo que se deforma es el ángulo entre hilos y no los
   * hilos. Es lo que hace que una falda al bies caiga en ondas.
   */
  readonly biasFactor: number;
  /** Complianza a la flexión. Grande es blando y con muchos pliegues. */
  readonly bendCompliance: number;
  readonly damping: number;
}

export interface SimOptions {
  /** Paso de tiempo del fotograma, en segundos. */
  readonly dt?: number;
  /** Subpasos por fotograma. Ver la nota de `step`. */
  readonly substeps?: number;
  readonly gravity?: number;
  /**
   * Cuánto tira cada costura, de 0 a 1.
   *
   * Se sube poco a poco: coser de golpe daría un latigazo que lanzaría los
   * paneles antes de que la tela pueda responder.
   */
  readonly seamStrength?: number;
}

export interface SimReport {
  readonly frames: number;
  /** Separación media que queda entre parejas cosidas, en mm. */
  readonly meanSeamGapMm: number;
  readonly maxSeamGapMm: number;
  /** Deformación media respecto al patrón, en tanto por uno. */
  readonly meanStrain: number;
  /** Velocidad media, en mm/s. Sirve para saber si ya ha reposado. */
  readonly meanSpeed: number;
  readonly penetrating: number;
}

export const GRAVITY_MM_S2 = 9810;

/**
 * Telas de referencia.
 *
 * Cuatro que se comportan de forma claramente distinta: si al cambiar de una a
 * otra la prenda no cambia, algo no está llegando al solver.
 */
export const FABRICS: readonly Fabric[] = [
  {
    id: 'poplin',
    name: 'Popelín de algodón',
    arealDensity: 120,
    stretchCompliance: 2e-7,
    biasFactor: 22,
    bendCompliance: 4e-4,
    damping: 0.02,
  },
  {
    id: 'denim',
    name: 'Denim',
    arealDensity: 350,
    stretchCompliance: 6e-8,
    biasFactor: 9,
    bendCompliance: 4e-5,
    damping: 0.04,
  },
  {
    id: 'silk',
    name: 'Seda',
    arealDensity: 60,
    stretchCompliance: 4e-7,
    biasFactor: 40,
    bendCompliance: 3e-3,
    damping: 0.015,
  },
  {
    id: 'jersey',
    name: 'Punto de algodón',
    arealDensity: 180,
    stretchCompliance: 3e-6,
    biasFactor: 4,
    bendCompliance: 1.5e-3,
    damping: 0.03,
  },
];

export const DEFAULT_FABRIC_ID = 'poplin';

export const findFabric = (id: string): Fabric =>
  FABRICS.find((fabric) => fabric.id === id) ?? FABRICS[0]!;
