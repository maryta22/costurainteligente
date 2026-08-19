import { Fragment, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';

import type { FittedGarment } from '@domain/fitting';
import type { GarmentMesh } from '@domain/garment3d';

import { useParametricStore } from '@state/parametricStore';
import { currentPattern } from '@state/patternStore';
import { usePatternStore } from '@state/patternStore';
import { useViewer3DStore } from '@state/viewer3dStore';

import { Avatar } from './Avatar';
import { Garment } from './Garment';

/**
 * Vista 3D.
 *
 * ── Cómo convive con el editor 2D sin comerse la máquina ───────────────────
 *
 * `frameloop="demand"` es la clave. Por defecto un lienzo de Three.js redibuja
 * sesenta veces por segundo aunque nada haya cambiado, y con el editor 2D al
 * lado eso significa un núcleo ocupado permanentemente y el ventilador en
 * marcha. En modo bajo demanda sólo se dibuja cuando algo lo pide: al girar la
 * cámara —los controles lo señalan solos— o al cambiar una medida.
 *
 * ── Unidades ───────────────────────────────────────────────────────────────
 *
 * La escena está en MILÍMETROS, como el resto del sistema. Un avatar mide unos
 * 1660 unidades de alto, lo que obliga a ajustar los planos de recorte de la
 * cámara y el tamaño de la rejilla, pero evita una conversión de escala que
 * sería una fuente permanente de errores de factor mil entre el patrón y la
 * prenda.
 */
export function Viewer3D() {
  const measurements = useParametricStore((state) => state.measurements);
  const showLevels = useViewer3DStore((state) => state.showLevels);
  const showGarment = useViewer3DStore((state) => state.showGarment);
  const showWireframe = useViewer3DStore((state) => state.showWireframe);
  const showSeams = useViewer3DStore((state) => state.showSeams);
  const targetEdgeMm = useViewer3DStore((state) => state.targetEdgeMm);
  const reportMesh = useViewer3DStore((state) => state.reportMesh);
  const dressed = useViewer3DStore((state) => state.dressed);
  const showStrain = useViewer3DStore((state) => state.showStrain);
  const reportFit = useViewer3DStore((state) => state.reportFit);

  /*
   * Suscribirse a los stores que determinan el patrón —no al patrón en sí— y
   * pedirlo con `currentPattern()`. El selector memoriza por identidad, así que
   * mientras nada cambie devuelve la MISMA referencia y `Garment` no reconstruye
   * la malla.
   */
  useParametricStore((state) => state.parameters);
  useParametricStore((state) => state.ease);
  usePatternStore((state) => state.garment);
  usePatternStore((state) => state.overrides);

  const pattern = currentPattern();

  const onQuality = useCallback(
    (mesh: GarmentMesh) => reportMesh(mesh.quality, mesh.warnings),
    [reportMesh],
  );

  const onFit = useCallback(
    (fitted: FittedGarment | null) => {
      if (fitted === null) {
        reportFit(null, new Map());
        return;
      }

      const ease = new Map<string, number>();
      for (const [level, reading] of fitted.easeAtLevels) ease.set(level, reading.easeMm);

      reportFit({ relax: fitted.relax, strain: fitted.strain }, ease);
    },
    [reportFit],
  );

  return (
    <div className="viewer3d">
      <Canvas
        frameloop="demand"
        shadows
        camera={{
          position: [900, 1100, 2200],
          fov: 35,
          // Con la escena en milímetros, los planos por defecto (0.1 y 2000)
          // dejarían al avatar fuera de campo.
          near: 50,
          far: 20_000,
        }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={['#1f2328']} />

        {/*
          Iluminación de estudio de tres puntos: una principal que define el
          volumen, un relleno suave que abre las sombras y un contraluz que
          despega la silueta del fondo. Es lo que hace legible la forma de un
          cuerpo, que si no se lee como una mancha.
        */}
        <hemisphereLight args={['#e8eef5', '#2a2f36', 0.55]} />
        <directionalLight
          position={[1500, 2600, 1800]}
          intensity={1.7}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />
        <directionalLight position={[-1600, 900, -1200]} intensity={0.5} />

        <Avatar measurements={measurements} showLevels={showLevels} />

        {showGarment && pattern !== null && (
          <Garment
            pieces={pattern.pieces}
            seams={pattern.seams}
            measurements={measurements}
            targetEdgeMm={targetEdgeMm}
            showWireframe={showWireframe}
            showSeams={showSeams}
            dressed={dressed}
            showStrain={showStrain}
            onQuality={onQuality}
            onFit={onFit}
          />
        )}

        <Grid
          position={[0, 0, 0]}
          args={[4000, 4000]}
          cellSize={100}
          cellThickness={0.6}
          cellColor="#3a4149"
          sectionSize={500}
          sectionThickness={1}
          sectionColor="#4c5765"
          fadeDistance={6000}
          infiniteGrid
        />

        <OrbitControls
          target={[0, 850, 0]}
          minDistance={400}
          maxDistance={6000}
          enableDamping
          dampingFactor={0.12}
          makeDefault
        />
      </Canvas>

      {showGarment && <MeshReport />}
      {showGarment && showStrain && <StrainLegend />}
    </div>
  );
}

/**
 * Informe de la malla.
 *
 * El ángulo mínimo se muestra por partida doble a propósito: el global incluye
 * los triángulos apoyados en el vértice de una pinza, que es un pico de pocos
 * grados EN EL PATRÓN y que ninguna triangulación puede mejorar. El interior
 * excluye esos y es el que de verdad indica si la malla está bien formada.
 */
function MeshReport() {
  const quality = useViewer3DStore((state) => state.quality);
  const warnings = useViewer3DStore((state) => state.warnings);
  const fit = useViewer3DStore((state) => state.fit);
  const ease = useViewer3DStore((state) => state.ease);

  if (quality === null) return null;

  return (
    <div className="viewer3d__hud">
      <dl>
        <dt>Triángulos</dt>
        <dd>{quality.triangleCount.toLocaleString('es-ES')}</dd>

        <dt>Vértices</dt>
        <dd>{quality.vertexCount.toLocaleString('es-ES')}</dd>

        <dt>Arista media</dt>
        <dd>{quality.meanEdgeMm.toFixed(1)} mm</dd>

        <dt>Ángulo mínimo</dt>
        <dd>{quality.minAngleDeg.toFixed(1)}°</dd>

        <dt>Mínimo interior</dt>
        <dd>{quality.minInteriorAngleDeg.toFixed(1)}°</dd>

        <dt>Degenerados</dt>
        <dd>{quality.degenerateCount}</dd>

        {fit !== null && (
          <>
            <dt>Costura abierta</dt>
            <dd>
              {fit.relax.maxSeamGapMm.toFixed(0)} / {fit.relax.meanSeamGapMm.toFixed(1)} mm
            </dd>

            <dt>Tensión media</dt>
            <dd>{(fit.strain.meanAbs * 100).toFixed(1)} %</dd>

            <dt>Tensión p95</dt>
            <dd>{(fit.strain.p95Abs * 100).toFixed(1)} %</dd>

            <dt>Atraviesan</dt>
            <dd>{fit.relax.penetrating}</dd>
          </>
        )}

        {[...ease].map(([level, mm]) => (
          <Fragment key={level}>
            <dt>Holgura {EASE_LABELS[level] ?? level}</dt>
            <dd>{mm.toFixed(0)} mm</dd>
          </Fragment>
        ))}
      </dl>

      {warnings.map((warning) => (
        <p key={warning}>{warning}</p>
      ))}
    </div>
  );
}

const EASE_LABELS: Record<string, string> = {
  bust: 'pecho',
  waist: 'cintura',
  hip: 'cadera',
};

/**
 * Leyenda del mapa de tensión.
 *
 * Sin ella el color no dice nada: un rojo intenso podría leerse como «aquí está
 * lo importante» en vez de «aquí falta tela».
 */
function StrainLegend() {
  return (
    <div className="viewer3d__legend">
      <span>comprime</span>
      <i className="viewer3d__ramp" />
      <span>estira</span>
    </div>
  );
}
