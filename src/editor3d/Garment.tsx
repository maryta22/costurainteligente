import { useLayoutEffect, useMemo, useRef } from 'react';
import { BufferAttribute, DoubleSide } from 'three';
import type { BufferGeometry } from 'three';

import { buildAvatar } from '@domain/avatar/body';
import { fitGarment, strainColor } from '@domain/fitting';
import type { FittedGarment } from '@domain/fitting';
import { buildGarmentMesh } from '@domain/garment3d';
import type { GarmentMesh } from '@domain/garment3d';
import type { BodyMeasurements } from '@domain/measurements/types';
import type { PatternPiece, Seam } from '@domain/pattern/types';

/** Lo que hace falta para dibujar un panel, venga plano o ya vestido. */
interface DrawablePanel {
  readonly piece: string;
  readonly instance: number;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uv: Float32Array;
  readonly indices: Uint32Array;
  readonly strain?: Float32Array;
}

interface GarmentProps {
  readonly pieces: readonly PatternPiece[];
  readonly seams: readonly Seam[];
  readonly measurements: BodyMeasurements;
  readonly targetEdgeMm: number;
  readonly showWireframe: boolean;
  readonly showSeams: boolean;
  readonly dressed: boolean;
  readonly showStrain: boolean;
  onQuality?(mesh: GarmentMesh): void;
  onFit?(fitted: FittedGarment | null): void;
}

/**
 * La prenda alrededor del maniquí, plana o ya vestida.
 *
 * Se reconstruye entera cada vez que cambia el patrón. Puede parecer derrochador
 * frente a actualizar sólo lo que cambió, pero es lo correcto: no hay estado 3D
 * propio que pueda quedar desfasado del patrón, y el coste —unas decenas de
 * milisegundos— sólo se paga al soltar un control, no en cada fotograma.
 */
export function Garment({
  pieces,
  seams,
  measurements,
  targetEdgeMm,
  showWireframe,
  showSeams,
  dressed,
  showStrain,
  onQuality,
  onFit,
}: GarmentProps) {
  const avatar = useMemo(() => buildAvatar(measurements), [measurements]);

  const mesh = useMemo(
    () => buildGarmentMesh(pieces, seams, avatar, { targetEdgeMm }),
    [pieces, seams, avatar, targetEdgeMm],
  );

  /*
   * Vestir cuesta unas décimas de segundo, así que se memoriza aparte de la
   * malla: girar la cámara o encender el alambre no lo recalcula, y encender el
   * mapa de tensión tampoco — la deformación ya viene calculada de vestir.
   */
  const fitted = useMemo(
    () => (dressed ? fitGarment(mesh, pieces, avatar) : null),
    [dressed, mesh, pieces, avatar],
  );

  useLayoutEffect(() => {
    onQuality?.(mesh);
  }, [mesh, onQuality]);

  useLayoutEffect(() => {
    onFit?.(fitted);
  }, [fitted, onFit]);

  const panels: DrawablePanel[] = useMemo(() => {
    if (fitted !== null) {
      return fitted.panels.map((panel) => ({
        piece: String(panel.piece),
        instance: panel.instance,
        positions: panel.positions,
        normals: panel.normals,
        uv: panel.uv,
        indices: panel.indices,
        strain: panel.strain,
      }));
    }

    return mesh.panels.map((panel) => ({
      piece: String(panel.piece),
      instance: panel.instance,
      positions: panel.positions,
      normals: panel.normals,
      uv: panel.uv,
      indices: panel.indices,
    }));
  }, [fitted, mesh]);

  return (
    <group>
      {panels.map((panel, index) => (
        <Panel
          key={`${panel.piece}:${panel.instance}`}
          panel={panel}
          index={index}
          wireframe={showWireframe}
          showStrain={showStrain}
        />
      ))}
      {showSeams && <SeamLines mesh={mesh} panels={panels} />}
    </group>
  );
}

/**
 * Colores por pieza, para leer el montaje de un vistazo.
 *
 * Con toda la prenda de un solo color no se distingue qué panel es cuál ni si
 * una manga ha ido a parar al lado equivocado, que es justo lo que hay que poder
 * comprobar aquí.
 */
const PANEL_COLORS = ['#c96a6a', '#6a8fc9', '#6ac98f', '#c9a86a', '#9a6ac9', '#6ac9c4'];

function Panel({
  panel,
  index,
  wireframe,
  showStrain,
}: {
  panel: DrawablePanel;
  index: number;
  wireframe: boolean;
  showStrain: boolean;
}) {
  const geometry = useRef<BufferGeometry>(null);

  /*
   * El color por vértice sustituye al color por pieza cuando se mira la tensión.
   * Se calcula aquí y no en el dominio porque es presentación: el dominio
   * entrega la deformación, que es el dato.
   */
  const colors = useMemo(() => {
    const { strain } = panel;
    if (!showStrain || strain === undefined) return null;

    const buffer = new Float32Array(strain.length * 3);
    for (let i = 0; i < strain.length; i++) {
      const [r, g, b] = strainColor(strain[i] ?? 0);
      buffer[i * 3] = r;
      buffer[i * 3 + 1] = g;
      buffer[i * 3 + 2] = b;
    }

    return buffer;
  }, [panel, showStrain]);

  useLayoutEffect(() => {
    const target = geometry.current;
    if (target === null) return;

    target.setAttribute('position', new BufferAttribute(panel.positions, 3));
    target.setAttribute('normal', new BufferAttribute(panel.normals, 3));
    target.setAttribute('uv', new BufferAttribute(panel.uv, 2));
    target.setIndex(new BufferAttribute(panel.indices, 1));

    if (colors === null) target.deleteAttribute('color');
    else target.setAttribute('color', new BufferAttribute(colors, 3));

    target.computeBoundingSphere();
  }, [panel, colors]);

  const flat = PANEL_COLORS[index % PANEL_COLORS.length] ?? '#c96a6a';

  return (
    <mesh castShadow receiveShadow>
      <bufferGeometry ref={geometry} />
      {/*
        `DoubleSide`: los paneles son superficies sin espesor y hay que verlos
        por el revés también. En la Fase 13, con la prenda cerrada, el revés
        dejará de verse pero seguirá haciendo falta para que la colisión con el
        cuerpo tenga dos caras contra las que resolver.
      */}
      <meshStandardMaterial
        color={colors === null ? flat : '#ffffff'}
        vertexColors={colors !== null}
        side={DoubleSide}
        roughness={0.72}
        metalness={0.03}
        wireframe={wireframe}
        transparent
        opacity={0.94}
      />
    </mesh>
  );
}

/**
 * Las costuras, dibujadas como el emparejamiento que son.
 *
 * Cada segmento une dos vértices que tienen que acabar juntos. Vistos sobre la
 * prenda vestida dicen de un vistazo qué ha cerrado y qué no: los costadillos y
 * el centro quedan como puntos, y el hombro y la sisa como un abanico de líneas
 * que es exactamente lo que esta fase no puede cerrar.
 */
function SeamLines({ mesh, panels }: { mesh: GarmentMesh; panels: readonly DrawablePanel[] }) {
  const positions = useMemo(() => {
    const points: number[] = [];

    for (const link of mesh.seams) {
      const panelA = panels[link.panelA];
      const panelB = panels[link.panelB];
      if (panelA === undefined || panelB === undefined) continue;

      for (let i = 0; i < link.verticesA.length; i++) {
        const ia = (link.verticesA[i] ?? 0) * 3;
        const ib = (link.verticesB[i] ?? 0) * 3;

        points.push(
          panelA.positions[ia] ?? 0,
          panelA.positions[ia + 1] ?? 0,
          panelA.positions[ia + 2] ?? 0,
          panelB.positions[ib] ?? 0,
          panelB.positions[ib + 1] ?? 0,
          panelB.positions[ib + 2] ?? 0,
        );
      }
    }

    return new Float32Array(points);
  }, [mesh, panels]);

  const geometry = useRef<BufferGeometry>(null);

  useLayoutEffect(() => {
    const target = geometry.current;
    if (target === null) return;

    target.setAttribute('position', new BufferAttribute(positions, 3));
    target.computeBoundingSphere();
  }, [positions]);

  if (positions.length === 0) return null;

  return (
    <lineSegments>
      <bufferGeometry ref={geometry} />
      <lineBasicMaterial color="#f2e34a" transparent opacity={0.5} />
    </lineSegments>
  );
}
