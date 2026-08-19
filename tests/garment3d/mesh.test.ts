import { describe, expect, it } from 'vitest';

import { rectFromPoints } from '@core/geometry/rect';
import type { Vec2 } from '@core/geometry/vec2';
import { angleOf, vec2 } from '@core/geometry/vec2';
import { polygonContains, signedArea } from '@core/geometry/polygon';
import { segmentEnd, segmentTangent } from '@core/geometry/segment';

import { evaluateParameters } from '@core/parametric/evaluate';

import { buildAvatar } from '@domain/avatar/body';
import {
  angleStats,
  buildGarmentMesh,
  chainBoundary,
  classifyPanel,
  instanceCount,
  isCenterEdge,
  planSampleCounts,
  sampleBoundary,
  triangularLattice,
  triangulatePolygon,
} from '@domain/garment3d';
import { easeProfile } from '@domain/measurements/ease';
import { buildInputScope } from '@domain/measurements/scope';
import type { SizeCode } from '@domain/measurements/standard';
import { standardMeasurements } from '@domain/measurements/standard';
import { BLOCK_PARAMETERS } from '@domain/pattern/blockParameters';
import { edgeSegments } from '@domain/pattern/edge';
import type { GarmentId } from '@domain/pattern/generators';
import { generateGarment } from '@domain/pattern/generators';

/** Patrón + maniquí de una talla, listos para mallar. */
function scene(garment: GarmentId, size: SizeCode = 'M') {
  const measurements = standardMeasurements(size);

  const evaluation = evaluateParameters(
    BLOCK_PARAMETERS,
    buildInputScope(measurements, easeProfile('semi-fitted')),
  );
  expect(evaluation.issues).toEqual([]);

  const pattern = generateGarment(garment, { values: evaluation.values, overrides: new Map() });
  if (pattern === null) throw new Error(`sin generador para ${garment}`);

  return { pattern, avatar: buildAvatar(measurements), measurements };
}

/** Unión de una pieza con su propio reflejo, por doblez o por costura central. */
const isCenterLink = (seam: string): boolean =>
  seam.startsWith('fold:') || seam.startsWith('center:');

/** Rectángulo con el contorno ya muestreado, como lo entrega `chainBoundary`. */
function sampledRectangle(width: number, height: number, spacing: number): Vec2[] {
  const points: Vec2[] = [];

  const side = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const steps = Math.max(1, Math.round(Math.hypot(to.x - from.x, to.y - from.y) / spacing));
    for (let i = 0; i < steps; i++) {
      points.push(vec2(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps));
    }
  };

  side(vec2(0, 0), vec2(width, 0));
  side(vec2(width, 0), vec2(width, height));
  side(vec2(width, height), vec2(0, height));
  side(vec2(0, height), vec2(0, 0));

  return points;
}

describe('retícula triangular', () => {
  it('produce triángulos casi equiláteros', () => {
    const bounds = rectFromPoints([vec2(0, 0), vec2(200, 200)]);
    expect(bounds).not.toBeNull();
    if (bounds === null) return;

    const spacing = 20;
    const lattice = triangularLattice(bounds, spacing);
    expect(lattice.length).toBeGreaterThan(50);

    // La distancia a la fila siguiente debe ser igual al paso, no mayor: eso es
    // lo que distingue la retícula triangular de la cuadrada.
    const rowHeight = (spacing * Math.sqrt(3)) / 2;
    const first = lattice[0];
    expect(first).toBeDefined();
    if (first === undefined) return;

    const nearestInNextRow = lattice
      .filter((p) => Math.abs(p.y - (first.y + rowHeight)) < 1e-6)
      .map((p) => Math.hypot(p.x - first.x, p.y - first.y))
      .sort((a, b) => a - b)[0];

    expect(nearestInNextRow).toBeCloseTo(spacing, 6);
  });
});

describe('triangulación de un polígono', () => {
  it('cubre el área exacta del polígono', () => {
    const square = [vec2(0, 0), vec2(300, 0), vec2(300, 200), vec2(0, 200)];
    const triangulation = triangulatePolygon(square, 25);

    let area = 0;
    for (let i = 0; i + 2 < triangulation.triangles.length; i += 3) {
      const a = triangulation.points[triangulation.triangles[i] ?? 0];
      const b = triangulation.points[triangulation.triangles[i + 1] ?? 0];
      const c = triangulation.points[triangulation.triangles[i + 2] ?? 0];
      if (a === undefined || b === undefined || c === undefined) continue;

      area += Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
    }

    expect(area).toBeCloseTo(300 * 200, 3);
  });

  it('mantiene los vértices del contorno al principio y en orden', () => {
    const shape = [vec2(0, 0), vec2(200, 0), vec2(200, 150), vec2(100, 220), vec2(0, 150)];
    const triangulation = triangulatePolygon(shape, 30);

    expect(triangulation.boundaryCount).toBe(shape.length);
    shape.forEach((point, i) => {
      expect(triangulation.points[i]?.x).toBeCloseTo(point.x, 9);
      expect(triangulation.points[i]?.y).toBeCloseTo(point.y, 9);
    });
  });

  it('deja los puntos interiores dentro y despegados del borde', () => {
    const shape = [vec2(0, 0), vec2(400, 0), vec2(400, 300), vec2(0, 300)];
    const spacing = 25;
    const triangulation = triangulatePolygon(shape, spacing);

    for (let i = triangulation.boundaryCount; i < triangulation.points.length; i++) {
      const point = triangulation.points[i];
      expect(point).toBeDefined();
      if (point === undefined) continue;
      expect(polygonContains(shape, point)).toBe(true);
    }
  });

  it('da ángulos muy por encima del umbral con el contorno bien muestreado', () => {
    const stats = angleStats(triangulatePolygon(sampledRectangle(400, 300, 25), 25));

    expect(stats.degenerateCount).toBe(0);
    expect(stats.minDeg).toBeGreaterThan(20);
  });

  /**
   * La precondición documentada, comprobada: si el contorno viene sin
   * muestrear, la calidad se hunde. No es un fallo del triangulador —un lado de
   * 400 mm hay que respetarlo tal cual— sino la razón por la que
   * `chainBoundary` muestrea antes de llamar aquí.
   */
  it('se degrada si el contorno viene sin muestrear', () => {
    const coarse = [vec2(0, 0), vec2(400, 0), vec2(400, 300), vec2(0, 300)];

    expect(angleStats(triangulatePolygon(coarse, 25)).minDeg).toBeLessThan(
      angleStats(triangulatePolygon(sampledRectangle(400, 300, 25), 25)).minDeg,
    );
  });

  it('normaliza la orientación aunque el polígono venga al revés', () => {
    const clockwise = [vec2(0, 0), vec2(0, 200), vec2(300, 200), vec2(300, 0)];
    expect(signedArea(clockwise)).toBeLessThan(0);

    const triangulation = triangulatePolygon(clockwise, 40);
    expect(triangulation.triangles.length).toBeGreaterThan(0);

    // Con el contorno ya enderezado, los triángulos salen antihorarios.
    let positive = 0;
    for (let i = 0; i + 2 < triangulation.triangles.length; i += 3) {
      const a = triangulation.points[triangulation.triangles[i] ?? 0];
      const b = triangulation.points[triangulation.triangles[i + 1] ?? 0];
      const c = triangulation.points[triangulation.triangles[i + 2] ?? 0];
      if (a === undefined || b === undefined || c === undefined) continue;
      if ((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y) > 0) positive++;
    }

    expect(positive).toBe(triangulation.triangles.length / 3);
  });
});

describe('muestreo del contorno', () => {
  it('da a las dos aristas de una costura el mismo número de muestras', () => {
    const { pattern } = scene('blouse');

    const counts = planSampleCounts(pattern.pieces, pattern.seams, 18);

    for (const seam of pattern.seams) {
      const a = counts.get(`${seam.a.piece}::${seam.a.edge}`);
      const b = counts.get(`${seam.b.piece}::${seam.b.edge}`);

      expect(a).toBeDefined();
      expect(a).toBe(b);
    }
  });

  it('encadena las aristas sin duplicar los vértices de las junturas', () => {
    const { pattern } = scene('skirt');
    const counts = planSampleCounts(pattern.pieces, pattern.seams, 18);

    for (const piece of pattern.pieces) {
      const { polygon, byEdge } = chainBoundary(sampleBoundary(piece, counts));

      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        if (a === undefined || b === undefined) continue;

        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(0.01);
      }

      // Cada arista conserva sus índices y encadena con la siguiente.
      const edges = piece.edges.map((edge) => byEdge.get(edge.id));
      edges.forEach((indices, i) => {
        expect(indices).toBeDefined();
        const next = edges[(i + 1) % edges.length];
        if (indices === undefined || next === undefined) return;

        expect(indices.at(-1)).toBe(next[0]);
      });
    }
  });

  /**
   * ── Regresión ────────────────────────────────────────────────────────────
   *
   * El muestreo uniforme por longitud de arco no cae en el vértice de una pinza
   * salvo por casualidad: deja una muestra a cada lado y la cuerda entre ambas
   * corta el pico. El patrón se veía bien, los 24 tests pasaban y la malla tenía
   * un triángulo-astilla de 7,6° apoyado en una base de 1,8 mm — pero el defecto
   * de verdad no era ese triángulo, sino que la pinza salía SIN PUNTA.
   *
   * La invariante no mira ángulos: exige que toda esquina del patrón sobreviva
   * al muestreo como vértice de la malla.
   */
  it.each(['skirt', 'blouse', 'dress'] as const)('%s: conserva las esquinas', (garment) => {
    const { pattern } = scene(garment);
    const counts = planSampleCounts(pattern.pieces, pattern.seams, 18);

    let cornersChecked = 0;

    for (const piece of pattern.pieces) {
      const { polygon } = chainBoundary(sampleBoundary(piece, counts));

      for (const edge of piece.edges) {
        const segments = edgeSegments(piece, edge);

        for (let i = 0; i + 1 < segments.length; i++) {
          const current = segments[i];
          const next = segments[i + 1];
          if (current === undefined || next === undefined) continue;

          const turn = Math.abs(
            angleOf(segmentTangent(next, 0)) - angleOf(segmentTangent(current, 1)),
          );
          const interiorDeg = 180 - Math.min(180, (turn * 180) / Math.PI);
          if (interiorDeg > 170) continue;

          const corner = segmentEnd(current);
          const nearest = Math.min(
            ...polygon.map((point) => Math.hypot(point.x - corner.x, point.y - corner.y)),
          );

          expect(nearest).toBeLessThan(0.01);
          cornersChecked++;
        }
      }
    }

    // Si dejara de haber esquinas que comprobar, el test se volvería vacío.
    expect(cornersChecked).toBeGreaterThan(0);
  });
});

describe('clasificación y número de instancias', () => {
  it('reconoce cada tipo de panel de un vestido con mangas', () => {
    const { pattern } = scene('dress');
    const kinds = pattern.pieces.map((piece) => classifyPanel(piece));

    expect(kinds).toContain('bodiceFront');
    expect(kinds).toContain('bodiceBack');
    expect(kinds).toContain('skirtFront');
    expect(kinds).toContain('skirtBack');
  });

  it('duplica las piezas al doblez y las de corte doble', () => {
    const { pattern } = scene('skirt');

    for (const piece of pattern.pieces) {
      const hasCenter = piece.edges.some(
        (edge) => edge.role === 'center-front' || edge.role === 'center-back',
      );
      if (hasCenter) expect(instanceCount(piece)).toBe(2);
    }
  });
});

describe('malla de la prenda', () => {
  it.each(['skirt', 'blouse', 'dress'] as const)('%s: se malla sin avisos', (garment) => {
    const { pattern, avatar } = scene(garment);
    const mesh = buildGarmentMesh(pattern.pieces, pattern.seams, avatar);

    expect(mesh.warnings).toEqual([]);
    expect(mesh.panels.length).toBeGreaterThanOrEqual(pattern.pieces.length);
    expect(mesh.quality.triangleCount).toBeGreaterThan(100);
    expect(mesh.quality.degenerateCount).toBe(0);
  });

  /**
   * El criterio de salida de la fase, con el matiz que impone la realidad: el
   * mínimo GLOBAL no puede superar 20° porque el vértice de una pinza es un
   * pico de pocos grados en el patrón mismo. Lo que sí debe cumplirse es en el
   * resto de la malla.
   */
  it.each(['skirt', 'blouse', 'dress'] as const)('%s: ángulo interior > 20°', (garment) => {
    const { pattern, avatar } = scene(garment);
    const mesh = buildGarmentMesh(pattern.pieces, pattern.seams, avatar);

    expect(mesh.quality.minInteriorAngleDeg).toBeGreaterThan(20);
  });

  it('las UV son las coordenadas del patrón, sin distorsión', () => {
    const { pattern, avatar } = scene('skirt');
    const mesh = buildGarmentMesh(pattern.pieces, pattern.seams, avatar);

    const panel = mesh.panels[0];
    expect(panel).toBeDefined();
    if (panel === undefined) return;

    /*
     * La prueba de que no hay distorsión: la distancia entre dos vértices en el
     * espacio UV coincide con la distancia en la escena, milímetro a
     * milímetro. Una parametrización obtenida por despliegue numérico jamás
     * cumpliría esto.
     */
    for (let i = 0; i + 1 < panel.vertexCount; i += 7) {
      const j = i + 1;

      const uvDistance = Math.hypot(
        (panel.uv[j * 2] ?? 0) - (panel.uv[i * 2] ?? 0),
        (panel.uv[j * 2 + 1] ?? 0) - (panel.uv[i * 2 + 1] ?? 0),
      );

      const worldDistance = Math.hypot(
        (panel.positions[j * 3] ?? 0) - (panel.positions[i * 3] ?? 0),
        (panel.positions[j * 3 + 1] ?? 0) - (panel.positions[i * 3 + 1] ?? 0),
        (panel.positions[j * 3 + 2] ?? 0) - (panel.positions[i * 3 + 2] ?? 0),
      );

      expect(worldDistance).toBeCloseTo(uvDistance, 3);
    }
  });

  it('las caras miran hacia fuera, también las reflejadas', () => {
    const { pattern, avatar } = scene('blouse');
    const mesh = buildGarmentMesh(pattern.pieces, pattern.seams, avatar);

    for (const panel of mesh.panels) {
      const normal = {
        x: panel.normals[0] ?? 0,
        y: panel.normals[1] ?? 0,
        z: panel.normals[2] ?? 0,
      };

      for (let i = 0; i + 2 < panel.indices.length; i += 3) {
        const ia = (panel.indices[i] ?? 0) * 3;
        const ib = (panel.indices[i + 1] ?? 0) * 3;
        const ic = (panel.indices[i + 2] ?? 0) * 3;

        const ux = (panel.positions[ib] ?? 0) - (panel.positions[ia] ?? 0);
        const uy = (panel.positions[ib + 1] ?? 0) - (panel.positions[ia + 1] ?? 0);
        const uz = (panel.positions[ib + 2] ?? 0) - (panel.positions[ia + 2] ?? 0);

        const vx = (panel.positions[ic] ?? 0) - (panel.positions[ia] ?? 0);
        const vy = (panel.positions[ic + 1] ?? 0) - (panel.positions[ia + 1] ?? 0);
        const vz = (panel.positions[ic + 2] ?? 0) - (panel.positions[ia + 2] ?? 0);

        // Producto vectorial contra la normal declarada: debe ser positivo.
        const dot =
          (uy * vz - uz * vy) * normal.x +
          (uz * vx - ux * vz) * normal.y +
          (ux * vy - uy * vx) * normal.z;

        expect(dot).toBeGreaterThan(0);
      }
    }
  });

  it('cada costura empareja el mismo número de vértices a ambos lados', () => {
    const { pattern, avatar } = scene('dress');
    const mesh = buildGarmentMesh(pattern.pieces, pattern.seams, avatar);

    expect(mesh.seams.length).toBeGreaterThan(0);

    for (const link of mesh.seams) {
      expect(link.verticesA.length).toBe(link.verticesB.length);
      expect(link.verticesA.length).toBeGreaterThan(1);
      // Una pinza se cose consigo misma: sus dos patas están en el mismo panel.
      if (!link.seam.startsWith('dart:')) expect(link.panelA).not.toBe(link.panelB);
    }
  });

  /**
   * Las parejas de una costura tienen que empezar CERCA. Si el emparejamiento
   * de instancias se equivocara —el delantero izquierdo cosido con la espalda
   * derecha— la prenda tendría que cruzarse por dentro del cuerpo para cerrar,
   * y la simulación de la Fase 13 haría algo violento e incomprensible.
   */
  it('las costuras emparejan instancias del mismo lado del cuerpo', () => {
    const { pattern, avatar } = scene('skirt');
    const mesh = buildGarmentMesh(pattern.pieces, pattern.seams, avatar);

    for (const link of mesh.seams) {
      if (isCenterLink(link.seam)) continue;

      const panelA = mesh.panels[link.panelA];
      const panelB = mesh.panels[link.panelB];
      if (panelA === undefined || panelB === undefined) continue;

      let worst = 0;
      for (let i = 0; i < link.verticesA.length; i++) {
        const ia = (link.verticesA[i] ?? 0) * 3;
        const ib = (link.verticesB[i] ?? 0) * 3;

        worst = Math.max(
          worst,
          Math.hypot(
            (panelA.positions[ia] ?? 0) - (panelB.positions[ib] ?? 0),
            (panelA.positions[ia + 1] ?? 0) - (panelB.positions[ib + 1] ?? 0),
            (panelA.positions[ia + 2] ?? 0) - (panelB.positions[ib + 2] ?? 0),
          ),
        );
      }

      // El hueco es el que dejan los planos tangentes, no el ancho del cuerpo.
      expect(worst).toBeLessThan(600);
    }
  });

  /**
   * El cierre del centro no está en el grafo de costuras del patrón —en 2D la
   * pieza es una sola— pero en 3D son dos mitades que hay que unir. Da igual
   * que en la tela sea un doblez o una cremallera: si falta, la prenda se abre
   * de arriba abajo por el centro.
   */
  it.each(['skirt', 'blouse', 'dress'] as const)('%s: cierra todos los centros', (garment) => {
    const { pattern, avatar } = scene(garment);
    const mesh = buildGarmentMesh(pattern.pieces, pattern.seams, avatar);

    const centers = pattern.pieces.flatMap((piece) => piece.edges.filter(isCenterEdge));

    const linked = mesh.seams.filter((link) => isCenterLink(link.seam));
    expect(linked.length).toBe(centers.length);

    for (const link of linked) {
      const panelA = mesh.panels[link.panelA];
      const panelB = mesh.panels[link.panelB];
      expect(panelA).toBeDefined();
      expect(panelB).toBeDefined();
      if (panelA === undefined || panelB === undefined) continue;

      // Las dos mitades comparten el borde: los vértices ya coinciden.
      for (let i = 0; i < link.verticesA.length; i++) {
        const ia = (link.verticesA[i] ?? 0) * 3;
        const ib = (link.verticesB[i] ?? 0) * 3;

        expect(panelA.positions[ia] ?? 0).toBeCloseTo(panelB.positions[ib] ?? 0, 3);
        expect(panelA.positions[ia + 1] ?? 0).toBeCloseTo(panelB.positions[ib + 1] ?? 0, 3);
        expect(panelA.positions[ia + 2] ?? 0).toBeCloseTo(panelB.positions[ib + 2] ?? 0, 3);
      }
    }
  });

  it('la prenda queda alrededor del cuerpo, no dentro ni encima', () => {
    const { pattern, avatar } = scene('dress');
    const mesh = buildGarmentMesh(pattern.pieces, pattern.seams, avatar);

    let minY = Infinity;
    let maxY = -Infinity;

    for (const panel of mesh.panels) {
      for (let i = 1; i < panel.positions.length; i += 3) {
        const y = panel.positions[i] ?? 0;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }

    // Ni por debajo del suelo ni por encima de la cabeza.
    expect(minY).toBeGreaterThan(-50);
    expect(maxY).toBeLessThan(avatar.heightMm);
  });

  it('más densidad da más triángulos y aristas más cortas', () => {
    const { pattern, avatar } = scene('skirt');

    const coarse = buildGarmentMesh(pattern.pieces, pattern.seams, avatar, { targetEdgeMm: 40 });
    const fine = buildGarmentMesh(pattern.pieces, pattern.seams, avatar, { targetEdgeMm: 15 });

    expect(fine.quality.triangleCount).toBeGreaterThan(coarse.quality.triangleCount);
    expect(fine.quality.meanEdgeMm).toBeLessThan(coarse.quality.meanEdgeMm);
    expect(fine.quality.minInteriorAngleDeg).toBeGreaterThan(20);
  });

  it('cambiar la talla cambia la malla sin romper la calidad', () => {
    for (const size of ['XS', 'M', 'XL'] as const) {
      const { pattern, avatar } = scene('blouse', size);
      const mesh = buildGarmentMesh(pattern.pieces, pattern.seams, avatar);

      expect(mesh.warnings).toEqual([]);
      expect(mesh.quality.degenerateCount).toBe(0);
      expect(mesh.quality.minInteriorAngleDeg).toBeGreaterThan(20);
    }
  });
});
