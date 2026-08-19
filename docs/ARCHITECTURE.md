# Costura Inteligente — Arquitectura Técnica

> Documento de arquitectura previo a la implementación.
> Estado: propuesta para validación. Versión 0.1.

---

## 0. Resumen ejecutivo y decisiones vinculantes

Siete decisiones estructurales que condicionan todo lo demás. Si alguna se cambia
más adelante, el coste es una reescritura, no un refactor.

| # | Decisión | Alternativa descartada | Motivo |
|---|----------|------------------------|--------|
| D1 | El patrón 2D es la **única fuente de verdad**. El 3D es geometría *derivada*. | Modelo 3D editable como fuente | Es el modelo de CLO/Marvelous. Evita duplicar lógica. |
| D2 | El motor paramétrico es un **DAG explícito de pasos de construcción**, evaluado topológicamente. | Solver geométrico bidireccional (Newton-Raphson tipo SolveSpace) | Determinista, O(n), serializable, diffable, gradable. Un solver bidireccional no converge de forma fiable y es indepurable. |
| D3 | **Milímetros en todo el sistema**, `float64` en el modelo, `float32` sólo en buffers GPU. | cm en 3D, px en 2D | Una sola unidad elimina una clase entera de bugs. |
| D4 | **Y hacia arriba** en coordenadas de mundo. La inversión a Y-abajo ocurre **sólo** en la capa de render SVG. | Adoptar el sistema de SVG en el núcleo | Si Y-abajo entra en el núcleo, todo el 3D queda espejado. |
| D5 | La geometría emitida por los generadores es **topológica y etiquetada** (aristas con nombre + grafo de costuras), no una lista de puntos. | Contornos como arrays de puntos | Sin identidad de arista no hay costuras en 3D, ni piquetes estables, ni grading. |
| D6 | La simulación de tela será un **solver XPBD propio**, no un motor genérico. | Rapier / Ammo / Jolt | Ver §8. Ninguno modela costuras, anisotropía por hilo, ni la fase de *stitch*. |
| D7 | Sin backend hasta la Fase 9+. Todo el motor corre en el cliente, en TypeScript puro. | Motor de patronaje en Python | Duplicaría la lógica (viola D1) y añade latencia por cada cambio de medida. |

### Tres avisos previos (petición explícita de «DETENTE y avísame»)

**AVISO 1 — Sincronización 3D → 2D.**
La sincronización inversa *libre* (deformar la malla 3D y re-obtener el patrón)
requiere *surface flattening* (ABF++, LSCM) con control de distorsión. Es un
proyecto de investigación en sí mismo y no cabe en este MVP ni en su año siguiente.
Lo que sí es viable y es lo que hacen las herramientas comerciales: exponer en 3D
**manipuladores enlazados a parámetros con nombre** (largo, profundidad de escote,
ease, ancho de manga). El manipulador escribe el parámetro → se regenera el 2D →
se regenera el 3D. Necesito que confirmes que esta es la definición de «modificar
en 3D» con la que trabajamos.

**AVISO 2 — Ediciones manuales vs. regeneración paramétrica.**
Si el usuario arrastra un punto y luego cambia el busto, ¿se pierde su edición?
Es el problema de arquitectura más subestimado de este tipo de sistema. La
solución adoptada: las ediciones manuales se guardan como **overrides con nombre**
(delta asociado a un id de punto del DAG), se reaplican tras cada regeneración, y
son visibles y borrables desde la UI. Esto debe existir desde la Fase 5, no
añadirse después.

**AVISO 3 — Calidad de malla para la simulación.**
El solver de tela necesita triángulos **uniformes y bien formados**. `earcut`
(ear clipping) produce slivers y hace explotar cualquier solver. Por eso la
triangulación no es un detalle de la Fase 11: el modelo de datos debe soportar
desde la Fase 3 el muestreo de aristas **por longitud de arco**, para que dos
aristas cosidas entre sí tengan vértices emparejables.

---

## 1. Arquitectura general

Cinco capas. Cada una depende sólo de las inferiores. La dirección de las flechas
no se invierte nunca.

```
┌──────────────────────────────────────────────────────────────┐
│  L5  APLICACIÓN — React, paneles, atajos, i18n               │
├──────────────────────────────────────────────────────────────┤
│  L4  PRESENTACIÓN                                            │
│      editor2d (SVG)   ·   editor3d (R3F)   ·   export        │
├──────────────────────────────────────────────────────────────┤
│  L3  ESTADO — Zustand: spec + viewport + selección + historia│
├──────────────────────────────────────────────────────────────┤
│  L2  DOMINIO — generadores de prenda, grading, costuras,     │
│      márgenes, pinzas, piquetes                              │
├──────────────────────────────────────────────────────────────┤
│  L1  NÚCLEO — geometría, expresiones, DAG paramétrico        │
│      TypeScript puro · sin DOM · sin React · sin Three       │
└──────────────────────────────────────────────────────────────┘
```

### La regla de pureza de L1/L2

`src/core/**` compila con un `tsconfig.core.json` cuyo `"lib"` es `["ES2022"]`,
**sin `DOM`**. Consecuencia: `document`, `window`, `HTMLElement` no tipan ahí.
La pureza deja de ser una convención y pasa a ser un error de compilación.
Es el 5% del coste de un monorepo con el 80% del beneficio.

Extracción a workspaces npm (`packages/core`, `packages/sim`) prevista en Fase 10,
cuando el solver necesite ejecutarse en un Worker y el exportador en Node.

### Flujo de datos (unidireccional)

```
  Measurements + StyleParams + Overrides   ←── el usuario edita SÓLO esto
                    │                          (esto es lo que se guarda,
                    │                           lo que se deshace, ~4 KB)
                    ▼
            [ evaluate(DAG) ]                  puro, determinista, memoizado
                    │
                    ▼
             PatternDocument                   derivado, nunca se guarda
          pieces · edges · seams
                    │
        ┌───────────┼───────────┬──────────────┐
        ▼           ▼           ▼              ▼
     SVG live    Seam alw.   Export        Mesh 3D
     (pantalla)  (offset)   SVG/PDF/DXF   (triangulación)
                                              │
                                              ▼
                                        Cloth solver (XPBD)
```

**Consecuencia práctica del diseño:** el store guarda la *especificación*, nunca
la geometría derivada. Undo/redo es una pila de snapshots de unos pocos KB.
No existe forma de que el 2D y el 3D se desincronicen, porque el 3D no tiene
estado propio de geometría — sólo estado de simulación.

---

## 2. Diagrama de módulos

```
                        ┌────────────────────┐
                        │   core/expression  │  parser + evaluador
                        │   Parser · AST     │  (recursive descent, sin eval)
                        └─────────┬──────────┘
                                  │ deps de identificadores
                                  ▼
┌──────────────────┐    ┌────────────────────┐
│  core/geometry   │◄───│  core/parametric   │
│  Vec2 Line       │    │  Parameter · Dag   │
│  Cubic Arc       │    │  ConstructionStep  │
│  Contour Polygon │    │  topoSort · eval   │
│  offset flatten  │    └─────────┬──────────┘
│  intersect length│              │
└────────┬─────────┘              │
         │                        │
         └──────────┬─────────────┘
                    ▼
         ┌──────────────────────┐      ┌───────────────────┐
         │  domain/pattern      │◄─────│ domain/measure    │
         │  PatternPiece        │      │ BodyMeasurements  │
         │  Edge · Seam · Dart  │      │ SizeTable · Ease  │
         │  Notch · GrainLine   │      └───────────────────┘
         │  seamAllowance()     │
         └──────┬───────────────┘
                │
     ┌──────────┼────────────┬─────────────────┐
     ▼          ▼            ▼                 ▼
┌─────────┐ ┌────────┐ ┌───────────┐   ┌──────────────┐
│generators│ │grading │ │  export   │   │  garment3d   │
│ skirt    │ │Measure-│ │ svg · pdf │   │ triangulate  │
│ blouse   │ │Driven  │ │ dxf(AAMA) │   │ seamGraph→   │
│ dress    │ │RuleBase│ │ tiling A4 │   │ constraints  │
└─────────┘ └────────┘ └───────────┘   └──────┬───────┘
                                              │
                                    ┌─────────┴────────┐
                                    ▼                  ▼
                            ┌──────────────┐   ┌──────────────┐
                            │  sim/xpbd    │   │  avatar      │
                            │ stretch bend │   │ morph targets│
                            │ seam collide │◄──│ SDF collider │
                            │ (Worker/WASM)│   │ GLB loader   │
                            └──────────────┘   └──────────────┘

        ── estado ──────────────────────────────────────────
        state/  patternStore · viewportStore · selection · history
        ── UI ──────────────────────────────────────────────
        editor2d/ (SVG)   editor3d/ (R3F)   components/  app/
```

---

## 3. Modelo matemático

### 3.1 Primitivas

Tres tipos de segmento, una interfaz común. Los arcos se conservan como arcos
(exportación DXF exacta) y se convierten a cúbicas sólo para render.

```ts
type Segment = LineSeg | CubicSeg | ArcSeg;

interface SegmentOps {
  pointAt(t: number): Vec2;        // t ∈ [0,1], paramétrico
  tangentAt(t: number): Vec2;
  length(tol?: number): number;    // Gauss-Legendre adaptativo
  splitAt(t: number): [Segment, Segment];
  pointAtLength(s: number): Vec2;  // inversión de longitud de arco
  bbox(): Rect;
  toPolyline(tol: number): Vec2[]; // flattening por tolerancia de cuerda
  reverse(): Segment;
}
```

**Por qué cúbica de Bézier como única curva libre:** una sola ruta de código para
offset, flattening, intersección, longitud y subdivisión. Las «curvas francesas»
del patronaje tradicional son cúbicas. Cuadráticas y B-splines se convierten a
cúbicas sin pérdida.

### 3.2 Curvas suaves por puntos (escotes, sisas, cadera)

El patronaje necesita «curva suave que pasa por N puntos». La primitiva correcta
es **Catmull-Rom centrípeta** (α = 0.5) convertida a segmentos de Bézier, con
override manual de tirador por nodo.

La parametrización centrípeta es el detalle que importa: la uniforme (α = 0)
produce *overshoot* y cúspides cuando los puntos están desigualmente espaciados
— exactamente el caso de una sisa. Es un fallo visible y difícil de diagnosticar
si se elige mal.

### 3.3 Longitud de arco: la operación central del patronaje

Casi toda validación de patrón es una igualdad de longitudes:

```
largo(copa de manga) = largo(sisa) + embebido
largo(costado delantero) = largo(costado espalda)
largo(cintura del patrón) = cintura + ease + suma(pinzas)
```

El motor debe exponer:
- `contourLength(contour, tol)` — Gauss-Legendre adaptativo, error < 0.01 mm
- `pointAtLength(contour, s)` — para colocar piquetes por longitud de arco
- `solveParameterForLength(param, contour, target)` — inversión numérica 1D
  (secante, ≤ 8 iteraciones). Esto es lo que permite «arrastrar y que cuadre»
  sin necesidad de un solver geométrico completo.

### 3.4 Sistema paramétrico: DAG explícito

Dos niveles.

**Nivel A — parámetros escalares.** Expresiones sobre un scope de medidas:

```
easeBust      = 60
finishedBust  = bust + easeBust
frontWidth    = finishedBust / 4 + 5
waistDartTake = (finishedBust - finishedWaist) / 4 * 0.6
```

Un parser de descenso recursivo (≈200 líneas) produce un AST. Recorrer el AST
da las dependencias **gratis** → el DAG se construye solo. Sin `eval`, sin
`mathjs` (150 kB para lo que necesitamos en 200 líneas), y con detección de
ciclos y mensajes de error con posición.

**Nivel B — pasos de construcción.** Cada paso produce puntos o segmentos con
identidad estable. Argumentos = expresiones del nivel A.

```
PointAtDistanceAngle(from, dist, angle)
PointOnSegment(seg, t | length)
Intersection(a, b)                       PerpendicularFoot(pt, seg)
MirrorPoint(pt, axis)                    OffsetPoint(pt, dx, dy)
CurveThrough([pts], tension)             Dart(apex, legA, legB)
```

Este es el modelo de **Valentina / Seamly2D**, el único software libre de
patronaje paramétrico serio. Está validado en producción por patronistas reales.

**Por qué no un solver geométrico bidireccional:** el patronaje se *describe*
de forma naturalmente procedural («el punto B está a bust/4 a la derecha de A»).
Forzarlo a un sistema de restricciones implícitas resuelto por Newton-Raphson
añade: no determinismo en la selección de rama, fallos de convergencia sin
diagnóstico útil, coste O(n³) por paso, imposibilidad de hacer *diff* de
versiones y grading impredecible. El DAG explícito es O(n), determinista y
serializable a JSON legible.

La manipulación directa («arrastro el punto, ajusta el parámetro») se resuelve
con la inversión numérica 1D de §3.3, no con un solver global.

### 3.5 Topología: aristas con nombre y grafo de costuras

Esta es D5, la decisión que habilita todo el 3D.

```ts
interface PatternEdge {
  id: EdgeId;                 // 'front.shoulder', 'front.armhole'
  role: EdgeRole;             // SHOULDER | ARMHOLE | SIDE | WAIST | HEM | NECK | CB | CF
  segments: SegmentRef[];     // sub-path del contorno
  seamAllowance: number;      // mm, por arista (dobladillo ≠ costura ≠ escote)
  onFold: boolean;            // línea de doblez
}

interface Seam {
  id: SeamId;
  a: { piece: PieceId; edge: EdgeId; reversed: boolean };
  b: { piece: PieceId; edge: EdgeId; reversed: boolean };
  ease: number;               // mm de embebido distribuidos en b
}
```

`reversed` no es un detalle: determina la orientación del emparejamiento de
vértices al coser en 3D. Sin él, las piezas se cosen retorcidas.

El grafo de costuras lo emite **el generador**, no se dibuja a mano. Es lo que
consume el mesher para crear las restricciones de costura del solver.

### 3.6 Margen de costura = offset de polígono

Es el algoritmo no trivial más importante del 2D. Un offset ingenuo falla en:
esquinas cóncavas (auto-intersección), curvas de radio menor que el offset
(bucles invertidos), y anchura variable por arista.

El offset de una Bézier **no es una Bézier** — no existe solución exacta.

Estrategia adoptada:
1. Flatten a polilínea con tolerancia de cuerda 0.05 mm.
2. Offset por arista con la anchura de esa arista (variable).
3. Resolución de uniones: miter con límite, o round en curvas.
4. Limpieza de auto-intersecciones con **Clipper2** (aritmética entera a escala
   1e-3 mm → robustez garantizada, sin epsilons frágiles).
5. Opcional: re-ajuste a Béziers para exportación suave.

Escribir un offset robusto desde cero son semanas. Clipper2 es pequeño, sin
dependencias y está detrás de una interfaz `OffsetProvider` por si se sustituye.

### 3.7 Piquetes, pinzas, hilo

- **Piquete (notch):** se guarda como `{ edgeId, arcLength, type }`, **nunca**
  como coordenada absoluta. Al dibujar con margen se proyecta hacia fuera a lo
  largo de la normal hasta la línea de corte. Guardado absoluto = piquetes
  desalineados en cuanto cambia una medida.
- **Pinza:** operación sobre el contorno, no una forma dibujada. Requiere
  `rotateContourSection(pivot, from, to, angle)` para soportar **traslado de
  pinza** (rotar parte del contorno alrededor del punto de busto) — operación
  fundamental del patronaje que no existe si las pinzas son dibujos.
- **Hilo (grain line):** vector con origen y ángulo en espacio local de pieza.
  Alimenta la anisotropía del solver (urdimbre/trama/bies tienen rigideces
  distintas). Por eso pertenece al modelo, no a la capa de presentación.

### 3.8 Sistemas de coordenadas

Cuatro espacios, tres conversiones, todas explícitas.

```
PIEZA (local, mm, Y↑) ──placement (rot+trans+mirror)──► DOCUMENTO (mm, Y↑)
                                                             │
                                          viewport (pan+zoom)│
                                                             ▼
                                                     PANTALLA (px, Y↓)

DOCUMENTO ──mesher + placement rig──► ESCENA 3D (mm, Y↑, Three.js)
```

```ts
class Viewport {
  worldToScreen(p: Vec2): Vec2;
  screenToWorld(p: Vec2): Vec2;
  readonly scale: number;   // px por mm
}
```

El render SVG usa `transform` en un `<g>` raíz (rendimiento), pero el
*hit-testing* usa `screenToWorld` en TS. Nunca se lee geometría del DOM.

La inversión de Y ocurre **exclusivamente** dentro de `Viewport`. Es D4.

---

## 4. Estructura de carpetas

```
costurainteligente/
├─ docs/
│  └─ ARCHITECTURE.md
├─ src/
│  ├─ core/                    ← tsconfig.core.json, sin lib DOM
│  │  ├─ geometry/
│  │  │  ├─ vec2.ts            add sub dot cross rotate normalize
│  │  │  ├─ line.ts  cubic.ts  arc.ts
│  │  │  ├─ contour.ts         secuencia de segmentos, cierre, área
│  │  │  ├─ polygon.ts         point-in-polygon, orientación, simplicidad
│  │  │  ├─ flatten.ts         tolerancia de cuerda adaptativa
│  │  │  ├─ offset.ts          + adapters/clipper.ts
│  │  │  ├─ intersect.ts       línea-línea, línea-bézier, bézier-bézier
│  │  │  ├─ arclength.ts       length, pointAtLength, solveForLength
│  │  │  ├─ spline.ts          Catmull-Rom centrípeta → Bézier
│  │  │  ├─ transform.ts       Mat3 afín: rot, mirror, translate
│  │  │  └─ epsilon.ts         política única de tolerancias
│  │  ├─ expression/
│  │  │  ├─ lexer.ts  parser.ts  ast.ts  evaluate.ts  dependencies.ts
│  │  ├─ parametric/
│  │  │  ├─ parameter.ts  dag.ts  toposort.ts  steps/  evaluate.ts
│  │  └─ index.ts
│  ├─ domain/
│  │  ├─ measurements/         BodyMeasurements, EaseProfile, validación
│  │  ├─ pattern/              PatternPiece, Edge, Seam, Dart, Notch,
│  │  │                        GrainLine, seamAllowance, validate
│  │  ├─ generators/           skirt/ blouse/ dress/ + registry.ts
│  │  ├─ grading/              SizeTable, MeasurementDrivenGrader,
│  │  │                        RuleBasedGrader (fase posterior)
│  │  └─ garment/              seamGraph, placementRig, triangulate
│  ├─ export/                  svg/ pdf/ dxf/ tiling/
│  ├─ editor2d/                canvas/ tools/ overlays/ hooks/
│  ├─ editor3d/                scene/ garment/ avatar/ controls/
│  ├─ sim/                     xpbd/ constraints/ collision/ worker/
│  ├─ state/                   patternStore, viewportStore, selectionStore,
│  │                           historyStore
│  ├─ components/              UI reutilizable
│  ├─ app/                     App.tsx, layout, routing
│  ├─ types/
│  └─ utils/
├─ tests/
│  ├─ geometry/                unitarios + property-based (fast-check)
│  ├─ generators/              golden files + aserciones dimensionales
│  └─ fixtures/
├─ tsconfig.json  tsconfig.core.json
├─ vite.config.ts  vitest.config.ts
└─ package.json
```

Diferencias respecto a la estructura que propusiste, y por qué:

- `pattern/` se divide en `core/` (matemática pura, reutilizable fuera de moda)
  y `domain/` (conocimiento de patronaje). El límite se puede compilar y testear
  por separado.
- `constraints/` desaparece como carpeta: no hay solver de restricciones, hay un
  DAG (`core/parametric/`). Ver §3.4.
- `avatar/` y `physics/` se agrupan bajo `editor3d/` y `sim/`. `sim/` no depende
  de React ni de Three — debe correr en un Worker y, más adelante, en WASM.
- `export/` sale de `pattern/`: consume el dominio, no forma parte de él.

---

## 5. Dependencias npm

### Fases 1–2 (arranque)

```
react  react-dom
typescript  vite  @vitejs/plugin-react
zustand
vitest  @vitest/coverage-v8  jsdom
eslint  typescript-eslint  prettier
fast-check                      ← property-based testing para geometría
```

`fast-check` no es un lujo. Invariantes como «el área del offset hacia fuera es
mayor que la original», «`split(t)` conserva la longitud total», «`pointAtLength`
es inversa de `length`» atrapan bugs que los tests de ejemplo no ven.

### Fase 3

```
clipper2-js        (o js-angusj-clipper, binding WASM)   ← offset robusto
```

### Fase 9 (exportación)

```
pdf-lib
```

`pdf-lib` sobre `jsPDF` + `svg2pdf`: emitimos paths de PDF **directamente desde
la geometría exacta**, sin pasar por el DOM de SVG. Menos capas, menos fragilidad,
control total de MediaBox para el escalado real.

### Fases 10–12 (3D)

```
three  @react-three/fiber  @react-three/drei
poly2tri                   ← CDT con soporte de huecos
three-mesh-bvh             ← consultas de colisión contra el avatar
comlink                    ← RPC tipado con el Worker del solver
```

`poly2tri` sobre `earcut`: earcut es ear-clipping, produce triángulos degenerados.
Ver AVISO 3.

### Fase 13+

```
(Rust → wasm-bindgen, sin dependencia npm de terceros)
```

### Backend, cuando llegue

```
fastapi  uvicorn  pydantic  sqlalchemy  alembic  psycopg[binary]
```

Nota: Python 3.14.5 está instalado en la máquina. Es muy reciente y varias
dependencias científicas aún no publican wheels. Para el backend conviene fijar
**Python 3.12 o 3.13** en un venv dedicado.

### Descartadas deliberadamente

`mathjs` (200 líneas propias bastan y dan el DAG gratis) · `d3` (no necesitamos
su modelo de datos) · `redux` (Zustand cubre el caso) · `rapier` (§8) ·
`lodash` (ES2022 basta) · framework de UI pesado (CSS plano hasta que duela).

---

## 6. TypeScript vs. C++/WebAssembly

Regla: WASM sólo donde haya un bucle numérico caliente con una interfaz estrecha.
Lenguaje recomendado: **Rust + wasm-bindgen** (toolchain en Windows muy superior
a emscripten, y sin la gestión manual de memoria de C++).

| Módulo | Dónde | Cuándo migrar |
|---|---|---|
| Solver XPBD (bucle de restricciones) | **WASM** | Fase 13. Es *el* candidato. 10–30× sobre JS con SIMD. |
| Broad-phase de auto-colisión (hash espacial / BVH) | **WASM** | Fase 13, junto al solver. |
| Refinamiento de Delaunay (Ruppert) | WASM opcional | Sólo si mallar tarda > 200 ms. |
| Offset de polígonos | WASM vía Clipper2 | Ya disponible; usar el binding WASM. |
| Surface flattening (LSCM/ABF++) | **WASM** | Sólo si se aprueba el 3D→2D libre. |
| Geometría base, arclength, splines | **TypeScript** | Nunca. Son µs, no ms. |
| DAG paramétrico, expresiones | **TypeScript** | Nunca. Dominado por I/O y UI. |
| Generadores de prenda | **TypeScript** | Nunca. Es lógica de negocio que debe iterarse rápido. |
| Exportación SVG/PDF/DXF | **TypeScript** | Nunca. |
| Todo lo de UI | **TypeScript** | Nunca. |

La preparación que hay que hacer **desde ahora** para que la migración sea barata:
`sim/` recibe y devuelve `Float32Array` planos (posiciones, índices, restricciones),
nunca objetos. Con esa interfaz, cambiar la implementación de TS a WASM no toca
nada fuera de `sim/`.

Horizonte siguiente: **WebGPU compute** para el solver. Es la vía real hacia
mallas de 50k+ vértices en tiempo interactivo. La misma interfaz de buffers
planos sirve.

---

## 7. Estrategia 2D → 3D

Siete pasos. Los tres primeros son los que deciden si la simulación funciona.

**1. Flattening a polilínea.** Cada arista del contorno se flatten con tolerancia
de cuerda. Tolerancia visual 0.05 mm; tolerancia de simulación mayor (~2 mm),
son dos muestreos distintos del mismo modelo.

**2. Remuestreo por longitud de arco — el paso crítico.**
Dos aristas que van a coserse deben tener vértices emparejables. Se muestrean
por **parámetro de longitud de arco normalizado**: el vértice *i* de la arista A
se empareja con el vértice *i* de la arista B, aunque sus longitudes difieran.
La diferencia de longitud es precisamente el *embebido* (ease), y queda
distribuida de forma natural. Si esto se hace mal, las costuras quedan fruncidas
o el solver diverge.

**3. Triangulación con calidad controlada.**
Puntos de contorno a espaciado uniforme + puntos de Steiner interiores en una
retícula triangular al mismo espaciado → CDT (`poly2tri`). Resultado: triángulos
casi equiláteros a coste bajo, sin necesidad de refinamiento de Ruppert completo.
Objetivo inicial: arista de 5–8 mm.

**4. UV gratis.** La coordenada 2D del patrón **es** la coordenada UV, exacta y
sin distorsión. Es una propiedad elegante de este diseño: el mapa de texturas de
la prenda es el patrón mismo. Estampados y rayas quedan alineados al hilo por
construcción.

**5. Colocación inicial (placement rig).** Cada tipo de prenda define un rig:
delantero al frente del avatar, espalda detrás, mangas junto a los brazos,
dispuestos en un cilindro alrededor del cuerpo, sin intersecar. Es geometría
sencilla, y es lo que en CLO se hace a mano con los *arrangement points*.

**6. Restricciones de costura.** El grafo de costuras (§3.5) se traduce a
restricciones de distancia entre pares de vértices emparejados.

**7. Dos fases de solver.**
- *Stitch:* restricciones de costura con rigidez creciente, gravedad reducida,
  colisión activa. Las piezas se cierran alrededor del cuerpo.
- *Drape:* gravedad completa, costuras rígidas, se deja asentar hasta converger.

El resultado se cachea. Cambiar una medida invalida la caché y rehace 1→7; en
mallas de esta resolución es del orden de 1–3 s, aceptable con feedback de
progreso. Mientras tanto se muestra la vista previa sin simular (paso 1–5),
que es instantánea.

### Avatar

Base GLB con **morph targets** (busto, cintura, cadera, altura, longitud de
brazo) accionados por las mismas `BodyMeasurements`. Una sola fuente de verdad
también para el cuerpo.

Colisionador: **SDF horneado** (campo de distancia con signo, ~128³) en lugar de
malla triangulada. Consulta O(1), gradiente suave (= normal de contacto), sin
artefactos de túnel. Es la elección estándar en simulación de tela y es
notablemente más robusta que BVH+triángulos para este caso. Se rehornea al
cambiar los morph targets (~100 ms en Worker).

**Riesgo de licencias:** SMPL y SMPL-X tienen licencia de investigación, no
comercial. Alternativas viables: mallas base de MakeHuman/MPFB (CC0) o un avatar
propio modelado en Blender. Decidir esto **antes** de la Fase 12.

---

## 8. Simulación de tela: análisis de opciones

### Por qué los motores genéricos no bastan

Cuatro requisitos que ningún motor de física de propósito general modela:

1. **Restricciones de costura entre piezas inicialmente separadas y planas.**
   No es un *joint* rígido: es un emparejamiento progresivo de dos cadenas de
   vértices con distribución de embebido. Habría que emularlo con miles de
   constraints ad-hoc, luchando contra el motor.
2. **Anisotropía ligada al hilo.** Urdimbre, trama y bies tienen rigideces muy
   distintas; es *la* razón por la que una prenda al bies cae diferente. Los
   motores genéricos ofrecen rigidez escalar.
3. **Rigidez de flexión (bending) controlada por ángulo diedro.** Distingue la
   gasa de la sarga. Los soft bodies genéricos usan muelles de flexión burdos.
4. **Fases de resolución distintas** (stitch → drape) con parámetros distintos.

### Evaluación concreta

| Opción | Cloth real | Estado | Limitaciones decisivas |
|---|---|---|---|
| **Rapier** | ✗ | Activo, buena API JS | No tiene cloth ni soft body en las versiones actuales. Descartado. |
| **Ammo.js (Bullet)** | ~ `btSoftBody` | Port sin mantenimiento activo, ~1.5 MB | Cloth muy elástica y con poco control; API de soft body pésima a través de bindings; sin anisotropía; colisión mediocre contra malla detallada; rendimiento malo a 20k triángulos. |
| **Jolt (jolt-physics WASM)** | ~ soft bodies recientes | Muy activo, buena calidad | Soft bodies pensados para volúmenes, no para tela fina de dos caras. Sin costuras ni anisotropía. |
| **PhysX / FleX** | ✓ (FleX sí) | Sin build web viable | Descartado por plataforma. |
| **Solver XPBD propio** | ✓ | — | Hay que escribirlo. Es la única opción que cubre 1–4. |

### Decisión: XPBD propio (D6)

*Extended Position Based Dynamics* — el marco que usan en espíritu las
herramientas modernas de tela. Ventajas: estable a pasos grandes, rigidez
independiente del número de iteraciones (a diferencia de PBD clásico),
restricciones componibles, paralelizable por *graph coloring*.

Conjunto de restricciones:

```
Distance      — estiramiento, con rigidez separada por dirección de hilo
DihedralBend  — flexión por ángulo diedro entre triángulos adyacentes
Seam          — unión de aristas cosidas, rigidez rampada en fase stitch
Collision     — contra SDF del avatar, con fricción de Coulomb
SelfCollision — hash espacial + repulsión por grosor (fase 2 del solver)
Attachment    — pinning (hombros, cintura) para el ajuste inicial
```

Plan de implementación por etapas, para no bloquear el proyecto:
- **13a** — Distance + gravedad + colisión SDF. Un rectángulo cae sobre una
  esfera. Valida integrador, SDF y bucle en Worker.
- **13b** — DihedralBend + fricción. La tela deja de parecer goma.
- **13c** — Seam + fase stitch. Primera prenda real cerrada sobre el avatar.
- **13d** — SelfCollision + grosor. Necesario en cuanto haya pliegues o capas.
- **13e** — Migración del bucle a Rust/WASM, luego WebGPU si hace falta.

Presupuesto de rendimiento objetivo: falda ≈ 6k vértices, 30 Hz de sustep,
20 iteraciones → viable en TS en Worker para 13a–13c; 13d casi con seguridad
exige WASM.

**Alternativa pragmática, si el tiempo aprieta:** limitar la Fase 12 a un
*fitting* geométrico sin física — proyectar la malla del patrón sobre el avatar
por deformación cilíndrica y suavizado laplaciano. No es simulación, pero da una
previsualización 3D útil y desbloquea el producto mientras el solver madura.
Recomiendo tener esto como entregable de la Fase 12 en cualquier caso.

---

## 9. Riesgos técnicos

Ordenados por producto de probabilidad × impacto.

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| R1 | **Calidad/rendimiento del solver de tela en navegador.** El riesgo dominante del proyecto. | Crítico | Etapas 13a–13e independientes; fitting geométrico (§8) como plan B entregable; interfaz de buffers planos lista para WASM/WebGPU desde el día uno. |
| R2 | **Interacción overrides manuales ↔ regeneración paramétrica.** AVISO 2. | Alto | Overrides como deltas con nombre, reaplicados y visibles. Diseñar en Fase 5, no después. |
| R3 | **Robustez del offset de márgenes** en cóncavos y curvas cerradas. | Alto | Clipper2 con aritmética entera. Validador de simplicidad de polígono. Corpus de casos patológicos en tests. |
| R4 | **Licencia y parametrización del avatar.** SMPL no es comercial. | Alto | Decidir antes de Fase 12. Base CC0 (MakeHuman/MPFB) o modelado propio con morph targets. |
| R5 | **Alcance del 3D→2D.** AVISO 1. Si se asume «libre», el proyecto se descarrila. | Alto | Definir contractualmente como sincronización a nivel de parámetro. |
| R6 | **Precisión de impresión real.** Los drivers escalan por defecto. | Medio | Cuadrado de calibración de 100 mm en cada exportación + instrucción «imprimir al 100%, sin ajustar a página». Verificar con regla física en QA. |
| R7 | **Realismo del grading.** El grading por medidas puede desplazar líneas de estilo. | Medio | Interfaz `Grader` con dos implementaciones desde el diseño; `RuleBasedGrader` en fase posterior. |
| R8 | **Convenciones de unidad y eje.** D3/D4. Barato de fijar hoy, carísimo después. | Medio | Tipos de marca (`type Mm = number & {__mm:true}`), lint, y `Viewport` como única frontera. |
| R9 | **Rendimiento de SVG** con muchas piezas + márgenes + nido de tallas. | Medio | Descripción de escena como datos puros y componentes SVG «tontos» → el cambio a canvas es sustituir hojas. |
| R10 | **Geometría degenerada** (aristas de longitud cero, puntos duplicados, contornos auto-intersecados). | Medio | Política única de epsilon en `core/geometry/epsilon.ts` + `sanitize()` + `validatePiece()` invocado tras cada regeneración. |
| R11 | **Alcance del producto.** Esto es un producto de 12–24 meses, no de un trimestre. | Medio | Disciplina de fases; cada fase con criterio de salida verificable. |
| R12 | **Validación por una patronista real.** Un patrón matemáticamente correcto puede ser incosible. | Medio | Prueba de corte y confección física al final de las Fases 5, 6 y 7. Sin esto no hay producto. |

---

## 10. Plan de desarrollo por fases

Cada fase tiene un **criterio de salida verificable**. No se avanza sin cumplirlo.

| Fase | Contenido | Criterio de salida |
|---|---|---|
| **1** | Vite + React + TS estricto. `Vec2`, `Viewport`, store, lienzo SVG, puntos y líneas, selección, zoom, pan, snapping a rejilla, regla en mm. | Se dibujan y mueven puntos y líneas; el zoom no altera las coordenadas de mundo; una línea mide en pantalla los mm que dice el modelo. |
| **2** | Motor geométrico: `Line`, `Cubic`, `Arc`, `Contour`, `Polygon`, spline centrípeta, flatten, arclength, intersección, transformadas, epsilon. | Suite de tests unitarios + property-based en verde. `length` con error < 0.01 mm frente a valores analíticos conocidos. |
| **3** | `PatternPiece`, aristas con nombre, `Seam`, margen de costura (offset), `GrainLine`, piquetes por longitud de arco, etiquetas, validador. | Una pieza dibujada a mano muestra margen variable correcto, piquetes proyectados a la línea de corte, y pasa `validatePiece()`. |
| **4** | `BodyMeasurements`, `EaseProfile`, validación, parser de expresiones, DAG paramétrico, evaluación topológica, detección de ciclos. | Cambiar `bust` en la UI reevalúa el DAG y actualiza parámetros derivados; expresión con ciclo da error legible con posición. |
| **5** | Generador de **falda básica** completo (delantero, espalda, pretina, pinzas). Sistema de overrides (AVISO 2). | Cambiar cintura/cadera/largo regenera el patrón; aserción automática: contorno de cintura = cintura + ease + pinzas, ± 1 mm. **Prueba física de costura.** |
| **6** | Generador de **blusa básica**: sisa, escote, manga, casamiento sisa↔copa. | Longitud de copa = longitud de sisa + embebido, ± 2 mm, verificado por test. **Prueba física.** |
| **7** | Generador de **vestido básico**, reutilizando bloques de 5 y 6. | Sin duplicación de lógica entre los tres generadores (bloques compartidos). **Prueba física.** |
| **8** | Tallas: `SizeTable` XS–XL, `MeasurementDrivenGrader`, vista de nido de tallas. | Las 5 tallas se generan y superponen; ninguna geometría degenerada en los extremos. |
| **9** | Exportación SVG (escala real), PDF (A4/A3/A2/A1/plotter), teselado A4 con marcas de registro y solape, cuadrado de calibración. | PDF impreso y medido con regla física: error < 0.5 mm en 200 mm. |
| **10** | Vista 3D: R3F, escena, cámara, luces, avatar GLB con morph targets, sincronía con medidas. | El avatar cambia con las medidas; la escena convive con el editor 2D sin pérdida de fps. |
| **11** | Patrón → malla: remuestreo por arco, CDT, UV = coordenada de patrón, placement rig. | Las piezas aparecen colocadas alrededor del avatar, con textura alineada al hilo, sin triángulos degenerados (ángulo mínimo > 20°). |
| **12** | Fitting geométrico (sin física): proyección cilíndrica + suavizado. Costuras visualizadas. | Previsualización 3D reconocible de la falda y la blusa. Entregable de producto por sí mismo. |
| **13** | Cloth simulation XPBD, por etapas 13a–13e (§8). | 13c: la falda se cierra y cae sobre el avatar de forma estable, en Worker, sin explotar. |
| **14** | Exportación DXF con convención **AAMA/ASTM** (capas 1 contorno, 2 puntos de giro, 3 puntos de curva, 4 piquetes, 6 hilo, 8 taladros). | El archivo abre correctamente en un visor DXF con las capas esperadas. |
| **15+** | Backend FastAPI + PostgreSQL: cuentas, proyectos, biblioteca de avatares, tejidos. | — |

Nota sobre la Fase 14 (DXF): el intercambio profesional de patrones no usa DXF
genérico sino la convención **AAMA-DXF / ASTM D6673** sobre DXF R12 ASCII. Es
esencialmente un escritor propio de ~400 líneas; no hace falta librería.

---

## Siguiente paso

Confirmación de:

- **AVISO 1** — sincronización 3D→2D definida a nivel de parámetro.
- **D2** — DAG explícito en lugar de solver de restricciones bidireccional.
- **D6** — solver XPBD propio en lugar de motor genérico.
- La estructura de carpetas de §4.

Con eso, se implementa la **Fase 1**.
