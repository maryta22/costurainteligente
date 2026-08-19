/**
 * Punto en el espacio de la escena 3D.
 *
 * Milímetros, igual que todo el modelo (decisión D3), y Y hacia arriba, igual
 * que el patrón (D4). El avatar mide unos 1660 de alto y se apoya en Y = 0.
 *
 * Mantener los milímetros también en 3D evita una conversión que sería una
 * fuente permanente de errores de factor mil, y la precisión de `float32` a esa
 * escala es de una décima de micra: irrelevante.
 */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/**
 * Malla triangulada, en buffers planos.
 *
 * El formato es deliberadamente el que consumen tanto Three.js como WebGL como
 * —más adelante— el solver de tela en WebAssembly. Devolver objetos por vértice
 * obligaría a convertirlos en cada frontera; los `Float32Array` cruzan a un
 * Worker sin copia y llegan a la GPU tal cual.
 */
export interface MeshData {
  /** Tres flotantes por vértice. */
  readonly positions: Float32Array;
  /** Tres índices por triángulo. */
  readonly indices: Uint32Array;
  /** Tres flotantes por vértice, normalizados. */
  readonly normals: Float32Array;
}

/**
 * Punto de referencia con nombre sobre el cuerpo.
 *
 * Es la interfaz entre el avatar y la prenda. En la Fase 12 el «rig» de
 * colocación situará cada pieza del patrón respecto a estos puntos —el
 * delantero frente al pecho, la manga junto al brazo— en vez de con
 * coordenadas fijas que sólo valdrían para un cuerpo.
 */
export type LandmarkName =
  | 'neck'
  | 'shoulderLeft'
  | 'shoulderRight'
  | 'bust'
  | 'underbust'
  | 'waist'
  | 'hip'
  | 'crotch'
  | 'kneeLeft'
  | 'kneeRight'
  | 'wristLeft'
  | 'wristRight';

export type Landmarks = Readonly<Partial<Record<LandmarkName, Vec3>>>;

/** Anillo horizontal del cuerpo: una elipse a una altura dada. */
export interface Ring {
  /** Centro del anillo. */
  readonly center: Vec3;
  /** Semieje transversal, de lado a lado. */
  readonly halfWidth: number;
  /** Semieje sagital, de delante atrás. */
  readonly halfDepth: number;
}

/**
 * Partes del cuerpo por separado.
 *
 * La malla fusionada sirve para dibujar, pero casi todo lo demás necesita
 * distinguirlas: colocar una manga alrededor de un BRAZO (Fase 12), medir el
 * torso sin que los brazos —que cuelgan cruzando la cintura— falseen la
 * anchura, o dar al solver de tela un colisionador por miembro (Fase 13).
 */
export interface AvatarParts {
  readonly torso: MeshData;
  readonly head: MeshData;
  readonly arms: readonly MeshData[];
  readonly legs: readonly MeshData[];
}

/**
 * El cuerpo descrito por sus secciones, no por sus triángulos.
 *
 * Es la misma información con la que se construye la malla, pero en la forma en
 * que hay que preguntarla: «qué elipse hay a esta altura». Vestir una prenda
 * (Fase 12) y hacerla colisionar (Fase 13) preguntan eso miles de veces por
 * fotograma, y contra la malla habría que recorrer los triángulos.
 */
export interface BodySections {
  readonly torso: readonly Ring[];
  /** Un anillado por brazo, en el mismo orden que `AvatarParts.arms`. */
  readonly arms: readonly (readonly Ring[])[];
  readonly legs: readonly (readonly Ring[])[];
}

export interface Avatar {
  /** Todo el cuerpo en una malla, para dibujarlo de una vez. */
  readonly mesh: MeshData;
  readonly parts: AvatarParts;
  readonly sections: BodySections;
  readonly landmarks: Landmarks;
  /** Alturas de las secciones clave, para dibujar guías. */
  readonly levels: Readonly<Record<string, number>>;
  readonly heightMm: number;
}
