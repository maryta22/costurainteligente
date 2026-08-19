import type { MeshData, Ring, Vec3 } from './types';
import { vec3 } from './types';

export interface LoftOptions {
  /** Vértices por anillo. Múltiplo de 4 para que los ejes caigan en un vértice. */
  readonly radialSegments?: number;
  /** Anillos interpolados entre cada par de anillos clave. */
  readonly subdivisions?: number;
  readonly capStart?: boolean;
  readonly capEnd?: boolean;
}

const DEFAULT_RADIAL = 32;
const DEFAULT_SUBDIVISIONS = 4;

/**
 * Interpolación de Catmull-Rom uniforme sobre cuatro valores.
 *
 * Se usa la variante uniforme y no la centrípeta que emplea el patrón: aquí los
 * anillos clave están razonablemente espaciados a lo largo del cuerpo y no se
 * dan las distribuciones desiguales que hacían sobreoscilar a la uniforme en
 * una sisa.
 */
const catmull = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
  const t2 = t * t;
  const t3 = t2 * t;

  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
};

const at = (rings: readonly Ring[], index: number): Ring => {
  const clamped = Math.min(rings.length - 1, Math.max(0, index));
  const ring = rings[clamped];
  if (ring === undefined) throw new Error('anillo fuera de rango');
  return ring;
};

/**
 * Densifica el perfil interpolando entre los anillos clave.
 *
 * Sin este paso el cuerpo saldría facetado: se vería el salto entre la sección
 * del pecho y la de la cintura como una arista. Interpolar cada atributo por
 * separado —altura, centro, semiejes— produce una transición suave y respeta
 * exactamente las secciones medidas, que siguen estando en el resultado.
 */
export function densify(rings: readonly Ring[], subdivisions: number): Ring[] {
  if (rings.length < 2 || subdivisions < 1) return [...rings];

  const out: Ring[] = [];

  for (let i = 0; i + 1 < rings.length; i++) {
    const p0 = at(rings, i - 1);
    const p1 = at(rings, i);
    const p2 = at(rings, i + 1);
    const p3 = at(rings, i + 2);

    for (let step = 0; step < subdivisions; step++) {
      const t = step / subdivisions;

      out.push({
        center: vec3(
          catmull(p0.center.x, p1.center.x, p2.center.x, p3.center.x, t),
          catmull(p0.center.y, p1.center.y, p2.center.y, p3.center.y, t),
          catmull(p0.center.z, p1.center.z, p2.center.z, p3.center.z, t),
        ),
        halfWidth: catmull(p0.halfWidth, p1.halfWidth, p2.halfWidth, p3.halfWidth, t),
        halfDepth: catmull(p0.halfDepth, p1.halfDepth, p2.halfDepth, p3.halfDepth, t),
      });
    }
  }

  const last = rings.at(-1);
  if (last !== undefined) out.push(last);

  return out;
}

/**
 * Construye una superficie tubular a partir de una pila de anillos elípticos.
 *
 * Es la única primitiva de malla del avatar: torso, brazos, piernas y cuello
 * son la misma operación con perfiles distintos. Tener una sola primitiva
 * significa que corregir la topología —o cambiar la densidad de la malla para
 * la simulación de la Fase 13— se hace en un sitio.
 */
export function loft(rings: readonly Ring[], options: LoftOptions = {}): MeshData {
  const radial = options.radialSegments ?? DEFAULT_RADIAL;
  const profile = densify(rings, options.subdivisions ?? DEFAULT_SUBDIVISIONS);

  if (profile.length < 2 || radial < 3) {
    return { positions: new Float32Array(), indices: new Uint32Array(), normals: new Float32Array() };
  }

  const vertexCount = profile.length * radial + (options.capStart === true ? 1 : 0) + (options.capEnd === true ? 1 : 0);
  const positions = new Float32Array(vertexCount * 3);

  let cursor = 0;
  for (const ring of profile) {
    for (let i = 0; i < radial; i++) {
      const angle = (i / radial) * Math.PI * 2;
      positions[cursor++] = ring.center.x + Math.cos(angle) * ring.halfWidth;
      positions[cursor++] = ring.center.y;
      positions[cursor++] = ring.center.z + Math.sin(angle) * ring.halfDepth;
    }
  }

  const indices: number[] = [];

  for (let ringIndex = 0; ringIndex + 1 < profile.length; ringIndex++) {
    const base = ringIndex * radial;
    const next = base + radial;

    for (let i = 0; i < radial; i++) {
      const j = (i + 1) % radial;
      // Dos triángulos por cuadrilátero, orientados hacia fuera.
      indices.push(base + i, next + i, base + j);
      indices.push(base + j, next + i, next + j);
    }
  }

  // Tapas: un vértice central unido a todo el anillo del extremo.
  let capIndex = profile.length * radial;

  if (options.capStart === true) {
    const first = profile[0];
    if (first !== undefined) {
      positions[capIndex * 3] = first.center.x;
      positions[capIndex * 3 + 1] = first.center.y;
      positions[capIndex * 3 + 2] = first.center.z;

      for (let i = 0; i < radial; i++) {
        indices.push(capIndex, (i + 1) % radial, i);
      }
      capIndex++;
    }
  }

  if (options.capEnd === true) {
    const last = profile.at(-1);
    if (last !== undefined) {
      const base = (profile.length - 1) * radial;
      positions[capIndex * 3] = last.center.x;
      positions[capIndex * 3 + 1] = last.center.y;
      positions[capIndex * 3 + 2] = last.center.z;

      for (let i = 0; i < radial; i++) {
        indices.push(capIndex, base + i, base + ((i + 1) % radial));
      }
    }
  }

  const indexArray = new Uint32Array(indices);
  return { positions, indices: indexArray, normals: computeNormals(positions, indexArray) };
}

/**
 * Normales por vértice, promediando las de las caras que lo comparten.
 *
 * El promedio es lo que da el sombreado suave: sin él cada triángulo se vería
 * plano y el cuerpo parecería tallado a facetas. Se pondera por el área del
 * triángulo de forma implícita —el producto vectorial sin normalizar ya tiene
 * esa magnitud—, que da mejor resultado que promediar direcciones puras.
 */
export function computeNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);

  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = (indices[i] ?? 0) * 3;
    const b = (indices[i + 1] ?? 0) * 3;
    const c = (indices[i + 2] ?? 0) * 3;

    const ax = positions[a] ?? 0;
    const ay = positions[a + 1] ?? 0;
    const az = positions[a + 2] ?? 0;

    const ux = (positions[b] ?? 0) - ax;
    const uy = (positions[b + 1] ?? 0) - ay;
    const uz = (positions[b + 2] ?? 0) - az;

    const vx = (positions[c] ?? 0) - ax;
    const vy = (positions[c + 1] ?? 0) - ay;
    const vz = (positions[c + 2] ?? 0) - az;

    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;

    for (const offset of [a, b, c]) {
      normals[offset] = (normals[offset] ?? 0) + nx;
      normals[offset + 1] = (normals[offset + 1] ?? 0) + ny;
      normals[offset + 2] = (normals[offset + 2] ?? 0) + nz;
    }
  }

  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i] ?? 0;
    const y = normals[i + 1] ?? 0;
    const z = normals[i + 2] ?? 0;
    const length = Math.hypot(x, y, z);

    if (length > 0) {
      normals[i] = x / length;
      normals[i + 1] = y / length;
      normals[i + 2] = z / length;
    } else {
      normals[i + 1] = 1;
    }
  }

  return normals;
}

/** Une varias mallas en una sola, desplazando los índices. */
export function mergeMeshes(parts: readonly MeshData[]): MeshData {
  const totalVertices = parts.reduce((sum, part) => sum + part.positions.length, 0);
  const totalIndices = parts.reduce((sum, part) => sum + part.indices.length, 0);

  const positions = new Float32Array(totalVertices);
  const normals = new Float32Array(totalVertices);
  const indices = new Uint32Array(totalIndices);

  let vertexCursor = 0;
  let indexCursor = 0;
  let vertexOffset = 0;

  for (const part of parts) {
    positions.set(part.positions, vertexCursor);
    normals.set(part.normals, vertexCursor);

    for (let i = 0; i < part.indices.length; i++) {
      indices[indexCursor + i] = (part.indices[i] ?? 0) + vertexOffset;
    }

    vertexOffset += part.positions.length / 3;
    vertexCursor += part.positions.length;
    indexCursor += part.indices.length;
  }

  return { positions, indices, normals };
}

/** Desplaza una malla completa. */
export function translateMesh(mesh: MeshData, offset: Vec3): MeshData {
  const positions = new Float32Array(mesh.positions);

  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = (positions[i] ?? 0) + offset.x;
    positions[i + 1] = (positions[i + 1] ?? 0) + offset.y;
    positions[i + 2] = (positions[i + 2] ?? 0) + offset.z;
  }

  return { ...mesh, positions };
}
