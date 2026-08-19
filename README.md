# Costura Inteligente

Diseño de moda paramétrico: patronaje 2D, generación de tallas, exportación a
escala real y —más adelante— visualización y simulación 3D.

La arquitectura completa y el plan por fases están en
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Léelo antes de tocar `src/core`.

## Estado

**Fase 1 completada** — proyecto, sistema de coordenadas, editor SVG, puntos,
líneas, selección, zoom y desplazamiento.

**Fase 2 completada** — motor geométrico: `LineSeg`, `CubicSeg`, `ArcSeg` tras
una interfaz común; `Contour`, `Polygon`, `Mat3`; spline de Catmull-Rom
centrípeta; longitud de arco por cuadratura y su inversa; intersecciones;
raíces de polinomios y solvers unidimensionales.

Criterio de salida verificado: la longitud de una cúbica coincide con una suma
densa de cuerdas —método independiente— por debajo de **0.001 mm**, diez veces
mejor que el objetivo de la fase.

**Fase 3 completada** — `PatternPiece` con aristas nombradas que forman una
partición del contorno, grafo de costuras con emparejamiento punto a punto,
margen de costura de anchura variable por arista, piquetes por longitud de arco
y línea de hilo. Validador de pieza, de costura y de patrón completo.

Criterio de salida verificado sobre un delantero de cuerpo real: **seis
márgenes distintos a la vez** —de 0 mm en el doblez a 40 en el bajo— medidos
con un error inferior a 0.2 mm, y piquetes proyectados a la línea de corte
recorriendo exactamente el margen de su arista.

**Fase 4 completada** — `BodyMeasurements` con 19 medidas y validación de
plausibilidad, `EaseProfile` con cuatro tipos de ajuste, tablas XS–XL, parser de
expresiones propio y DAG paramétrico con orden topológico y detección de ciclos.
Panel de medidas y de parámetros con fórmulas editables.

Criterio de salida verificado en navegador: cambiar el pecho de 880 a 1000 mm
propaga a todos los derivados (`finishedBust` 960→1080, `bustQuarter` 240→270)
y deja intactos los que no dependen de él; una fórmula circular informa del
camino exacto —`bustQuarter → frontWidthQuarter → bustQuarter`— y un error de
sintaxis señala la columna con un cursor.

**Fase 5 completada** — primer generador paramétrico: **falda recta básica**
con delantero, espalda y pretina, pinzas, piquetes de cadera y costuras.
Vocabulario de construcción (nivel B del DAG) y sistema de ajustes manuales.

Criterio de salida verificado: en las **20 combinaciones** de talla y ajuste, el
contorno de cintura del patrón coincide con la cintura del cuerpo más la
holgura con menos de 1 mm de error. No sale aproximado por suerte: el generador
resuelve numéricamente la anchura de la cintura para que la curva mida lo
pedido.

Pendiente de la Fase 5: **prueba física de corte y confección**. Un patrón
matemáticamente correcto puede ser incosible, y ninguna comprobación
automática sustituye a cortarlo en tela.

**Fase 6 completada** — **blusa básica con manga montada**: delantero, espalda
y manga, con escote, sisa, hombro, pinzas de talle y copa.

Criterio de salida verificado en las 20 combinaciones de talla y ajuste: la
copa mide la sisa más el embebido con menos de **2 mm** de error, y cada mitad
casa con su propia sisa con menos de 1 mm. Ninguna de las dos longitudes se
puede despejar de una fórmula —son longitudes de arco de Bézier—: se dibujan
las sisas, **se miden**, y se resuelve numéricamente la altura de copa.

Pendiente de las Fases 5 y 6: **prueba física de corte y confección**.

**Fase 7 completada** — **vestido básico** con costura de talle, y refactor de
los tres generadores sobre bloques compartidos.

Criterio de salida —arquitectónico— verificado midiendo, no contando líneas:
la sisa, el hombro, el escote y el costado del cuerpo del vestido salen
**idénticos a los de la blusa** hasta la millonésima de milímetro, y su falda
al bajo de la falda suelta. Una reimplementación «equivalente» divergiría en
algún decimal.

Pendiente de las Fases 5 a 7: **prueba física de corte y confección**.

**Fase 8 completada** — sistema de tallas con dos graduadores tras una misma
interfaz y **vista de nido** superponiendo el rango XS–XL.

Criterio de salida verificado: las tres prendas × cinco tallas × cuatro
ajustes —60 patrones— validan sin una sola geometría degenerada. Ningún
segmento por debajo de 0.5 mm, ninguna arista por debajo de 1 mm, ningún
contorno auto-intersecado, ninguna coordenada no finita, y todas las
magnitudes creciendo de forma monótona al subir de talla.

**Fase 9 completada** — exportación **SVG y PDF a escala real**, con teselado en
A4/A3/A2/A1/A0/carta/plóter, solape, marcas de registro y cuadrado de
comprobación.

Criterio de salida verificado de punta a punta: el SVG exportado, renderizado
en Chrome, mide el cuadrado de calibración en **377.95 px CSS = 99.9997 mm**.
Error: **0.0003 mm** sobre 100 — mil veces mejor que el objetivo de la fase, y
lo que queda es redondeo de subpíxel del navegador, no geometría. Las páginas
del PDF salen de 595.276 × 841.890 puntos, que es la definición exacta del A4.

Falta la comprobación con una **impresora y una regla física**: el archivo es
correcto, pero el riesgo R6 es que el controlador escale al imprimir.

**Fase 10 completada** — vista 3D con React Three Fiber y **maniquí
paramétrico generado a partir de las medidas**.

Criterio de salida verificado en navegador: el cuerpo cambia al cambiar una
medida —con la cintura a 1100 mm la silueta pasa de reloj de arena a recta,
pecho y cadera intactos— y la escena consume **cero llamadas de dibujo en
reposo**, redibujando sólo cuando algo cambia.

**Fase 11 completada** — el patrón 2D se convierte en **malla 3D colocada
alrededor del maniquí**.

Criterio de salida verificado en navegador, con las tres prendas y en las cinco
tallas: **cero triángulos degenerados** y ángulo mínimo interior entre 25° y
27°, muy por encima del umbral de 20°. La textura queda alineada al hilo por
construcción, sin desplegar nada — ver *[Las UV son gratis](#las-uv-son-gratis)*.

| | Triángulos | Vértices | Arista media | Ángulo mín. | Mín. interior |
|---|---|---|---|---|---|
| Falda | 4 098 | 2 316 | 18,6 mm | 27,3° | 27,3° |
| Blusa | 5 058 | 2 816 | 18,4 mm | 27,2° | 27,2° |
| Vestido | 8 912 | 4 960 | 18,5 mm | 25,8° | 25,8° |
| Vestido XL | 10 126 | 5 588 | 18,5 mm | 18,3° | **27,4°** |

La talla XL enseña por qué hay dos columnas de ángulo: aparece un pico agudo en
el patrón —el vértice de una pinza— y el mínimo global cae a 18,3°, mientras el
resto de la malla sigue en 27,4°. Ese triángulo no se puede mejorar sin dejar de
respetar el contorno, que es lo que hay que cortar en la tela.

**Fase 12 completada** — la prenda se **viste sobre el maniquí**, sin física.

| | Costura abierta (máx/media) | Tensión media | p95 | Atraviesan | Holgura |
|---|---|---|---|---|---|
| Falda | 19 / 3,9 mm | 5,5 % | 20,1 % | **0** | cintura +54, cadera +69 mm |
| Blusa | 178 / 19,0 mm | 6,1 % | 24,5 % | 29 | pecho +64 mm |
| Vestido | 178 / 17,8 mm | 5,8 % | 21,1 % | 29 | pecho +64, cintura +56, cadera +70 mm |

Costadillos, centros, cintura y pinzas **cierran por construcción** —por debajo
de 5 mm sin relajar nada—. Los 178 mm son el hombro y la sisa, y no son un
defecto que se pueda pulir: ver *[Lo que este método no puede
hacer](#lo-que-este-método-no-puede-hacer)*.

Siguiente: Fase 13, simulación de tela con un solver XPBD propio.

## Puesta en marcha

```bash
npm install
npm run dev          # http://localhost:5173
```

| Script | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Comprobación de tipos + build de producción |
| `npm test` | Suite de tests (unitarios + basados en propiedades) |
| `npm run typecheck` | Comprobación de tipos de todo el proyecto |
| `npm run check:core` | **Verifica la frontera de pureza del núcleo** |
| `npm run lint` | ESLint, incluidas las reglas de capas |
| `npm run verify` | Todo lo anterior, en orden |

`check:core` compila `src/core` sin la librería `DOM` y sin tipos de Node. Si
alguien introduce `document`, `window` o `process` en el núcleo, falla la
compilación. No es una convención: es una barrera.

## Manejo del editor

| Acción | Cómo |
|---|---|
| Seleccionar / mover | `V` · clic, arrastrar, marco; `Mayús` para añadir |
| Crear punto | `P` · clic |
| Crear línea | `L` · clic origen, clic destino; encadena polilíneas; `Esc` termina |
| Desplazar vista | Botón central del ratón, o `Espacio` + arrastrar |
| Zoom | Rueda (anclado al cursor) · `Mayús`+rueda desplaza |
| Escala real 1:1 | `Ctrl`+`0`, o el botón del porcentaje |
| Encuadrar todo | `F` |
| Borrar | `Supr` |
| Deshacer / rehacer | `Ctrl`+`Z` / `Ctrl`+`Mayús`+`Z` |

Las coordenadas exactas se introducen en el panel de propiedades, en
milímetros. Es la misma acción del store que usa el arrastre.

## Convenios que no se negocian

Están razonados en el documento de arquitectura; aquí sólo el resumen.

1. **Milímetros en todo el modelo.** Los píxeles sólo existen en presentación.
2. **Y hacia arriba** en coordenadas de mundo. La inversión a Y‑abajo ocurre
   exclusivamente en `src/core/geometry/viewport.ts`.
3. **El núcleo es TypeScript puro.** Sin DOM, sin React, sin Three.
4. **La geometría se referencia por identidad**, nunca por coordenadas. Borrar
   un punto arrastra las líneas que dependen de él.
5. **El store guarda la especificación, no la geometría derivada.**

## Estructura

```
src/
├─ core/            geometría, numérico y motor paramétrico · SIN DOM
│  ├─ numeric/      quadrature · roots · solve
│  ├─ geometry/     vec2 rect mat3 · line cubic arc segment
│  │                contour polygon spline intersect offset
│  │                viewport grid math epsilon
│  ├─ expression/   lexer · parser · ast · evaluate · functions
│  └─ parametric/   graph (toposort, ciclos) · evaluate
├─ domain/          conocimiento de patronaje · SIN React
│  ├─ sketch/       documento, topología, hit-testing, ajuste
│  ├─ measurements/ medidas, ease, tallas, validación, ámbito
│  ├─ pattern/      pieza, aristas, costuras, márgenes, piquetes
│  ├─ grading/      graduación por medidas y por tabla
│  ├─ avatar/       maniquí paramétrico: secciones, loft, puntos clave
│  ├─ garment3d/    patrón → malla: muestreo · triangulación · colocación
│  └─ fitting/      vestir: superficie · envoltorio · relajación · tensión
├─ export/          dibujo, teselado, SVG, PDF
├─ state/           Zustand: editor · viewport · cursor · patrón · paramétrico
├─ editor2d/        lienzo SVG, capas, herramientas, reglas, paneles
├─ editor3d/        escena R3F: maniquí y prenda
├─ components/      UI reutilizable
├─ app/             composición y atajos
└─ styles/
tests/              unitarios y basados en propiedades (fast-check)
docs/               ARCHITECTURE.md
```

## El lenguaje de fórmulas

Las reglas de trazado se escriben como expresiones sobre las medidas, no como
código:

```
finishedBust    = bust + easeBust
bustQuarter     = finishedBust / 4
neckWidth       = neck / 5
totalDartIntake = (finishedHip - finishedWaist) / 4
```

Operadores `+ − * / % ^`, funciones (`min`, `max`, `clamp`, `sqrt`, `hypot`,
trigonometría **en grados**) y unidades del taller: `bust / 4 + 1cm`.

Se analizan con un parser propio, no con `eval` ni una biblioteca de cálculo.
Son doscientas líneas que dan tres cosas a la vez: es imposible ejecutar código
arbitrario desde un documento; las dependencias salen de recorrer el árbol, sin
declararlas; y los errores señalan la columna exacta.

## Bloques compartidos

Los tres generadores no trazan: componen. Toda la geometría vive en
`domain/pattern/blocks/`, y cada prenda decide qué bloques usa y con qué
parámetros.

| Bloque | Falda | Blusa | Vestido |
|---|:--:|:--:|:--:|
| `waistBlock` — línea de cintura y pinza | ✓ | ✓ | ✓ |
| `skirtLowerBlock` — bajo y costado hasta la cadera | ✓ | | ✓ |
| `bodiceUpperBlock` — costado, sisa, hombro, escote | | ✓ | ✓ |
| `sleeveBlock` — manga y casamiento de copa | | ✓ | ✓ |
| `assemblePanel` — montaje de aristas sobre el contorno | ✓ | ✓ | ✓ |

`assemblePanel` merece mención aparte: una arista referencia su tramo por
`(startSegment, segmentCount)`, que es la representación correcta pero
tediosa y frágil de escribir a mano — insertar una curva desplaza todos los
índices posteriores, y el síntoma no es un error de compilación sino un margen
aplicado a la arista equivocada. Ahora se describe **qué segmentos** forman
cada arista y los índices salen solos.

## El maniquí se genera, no se descarga

El plan original era un GLB base con *morph targets*. Se descartó, y la razón
principal es de **licencias**: los cuerpos paramétricos de referencia —la
familia SMPL— son de licencia de investigación, no comercial. Adoptar uno
hipotecaría el proyecto, y el problema aparecería tarde. Es el riesgo R4, y
generarlo lo elimina por completo.

Las otras dos razones son técnicas. Un morph target interpola entre formas
esculpidas: el cuerpo resultante **se parece** a las medidas pedidas. Aquí cada
sección se resuelve para tener exactamente el perímetro medido —una cinta
alrededor de la cintura del maniquí da la cintura introducida—, que es la única
forma de que probar una prenda sobre él signifique algo. Y no hay que
versionar ni cargar un activo binario de varios megas.

A cambio es un **maniquí, no una persona**: sin musculatura ni asimetrías. Para
probar la caída de una prenda y para servir de colisionador al solver de tela es
justamente lo que hace falta. Un cuerpo esculpido entraría después detrás de la
misma interfaz.

Las secciones son **elipses**, no circunferencias: un torso es sensiblemente más
ancho que profundo, y modelarlo cilíndrico daría el contorno correcto con la
forma equivocada. El perímetro de una elipse no tiene forma cerrada —es una
integral elíptica— así que se integra con la misma cuadratura adaptativa de la
Fase 2 y la anchura se despeja por bisección.

## Del patrón a la malla

El paso que hace posible todo lo demás es el **remuestreo por longitud de arco
con recuentos pactados**: las dos aristas de una costura reciben el mismo número
de muestras, repartidas por longitud normalizada. Así el vértice *i* de una se
empareja con el vértice *i* de la otra aunque midan distinto, y la diferencia
—el embebido de una copa de manga— queda repartida por igual a lo largo de toda
la costura. Es lo que hace una costurera al montar una manga.

Sin ese pacto, cada arista tendría un número distinto de vértices y no habría
forma de emparejarlos; y muestreando por parámetro de curva en vez de por
longitud, la costura saldría fruncida en unos tramos y estirada en otros.

Los puntos interiores van en **retícula triangular**, no cuadrada. Una cuadrada
triangulada da triángulos de 45-45-90 con las diagonales un 41 % más largas que
los lados: la malla tendría direcciones privilegiadas y la tela se estiraría
distinto según hacia dónde tire, un artefacto que no existe en el tejido real.
La triangular da triángulos de 60° sin dirección preferente.

La triangulación es **Delaunay con restricciones** (`poly2tri`), no recorte de
orejas. El recorte de orejas es más rápido pero no controla la forma de los
triángulos: genera astillas de un grado sin inmutarse. Para dibujar da igual;
para simular es fatal, porque el paso de tiempo estable del solver lo fija el
peor triángulo de toda la malla, y una sola astilla obliga a bajarlo para todos.

### Las UV son gratis

La posición 2D de cada vértice en el patrón **es** su coordenada de textura. No
hay que desplegar nada ni calcular nada: el patrón plano es, por definición, el
despliegue de la prenda. La consecuencia práctica es que un estampado o una raya
salen alineados al hilo por construcción. Y es comprobable —lo comprueba un
test—: la distancia entre dos vértices en el espacio UV coincide con la distancia
en la escena milímetro a milímetro, cosa que una parametrización obtenida por
despliegue numérico no cumpliría nunca.

### Las piezas se colocan planas, no envueltas

Los paneles se sitúan sobre **planos tangentes** a un cilindro alrededor del
cuerpo. Envolverlos sobre él parece más directo pero es peor: introduciría una
deformación arbitraria antes de que el solver diga nada, y esa deformación se
confundiría después con la que produce la propia tela. Planas, la geometría de
partida es exactamente el patrón.

Un detalle que el patrón 2D no representa: la unión de una pieza con **su propio
reflejo**. Un delantero al doblez es una sola pieza en plano y dos mitades en 3D;
una espalda con cremallera, igual. Esa unión no está en el grafo de costuras
—no hay dos piezas que unir— y hay que generarla, o la prenda quedaría abierta
de arriba abajo justo por el centro. No cuenta cualquier doblez: una pretina
también va al doblez, pero **a lo largo**, y al plegarla las dos mitades se
superponen en vez de extender la prenda.

## Vestir la prenda

Lo obvio sería envolver los paneles sobre el cuerpo a una distancia fija, y
sería incorrecto: aplastaría la holgura contra la piel, y una prenda holgada y
una ajustada quedarían idénticas en pantalla — justo la diferencia que uno
quiere ver antes de cortar.

Lo que hace una prenda suelta al colgar es formar una superficie cuyo contorno a
cada altura es **el del patrón**, no el del cuerpo. Así que el contorno se mide
en el patrón y la prenda se envuelve sobre la elipse que lo tiene. La holgura
aparece entonces como separación real —y se lee en pantalla— y hay un efecto
secundario que vale por sí solo: **los costadillos cierran sin ajustar nada**.
Recorrer el ancho del delantero desde el centro deja exactamente el ancho de la
espalda hasta el centro de atrás, porque el contorno se definió como la suma de
los cuatro.

Tres detalles que parecen menores y deciden si funciona:

- **La coordenada del patrón no es la posición alrededor del cuerpo.** Una pinza
  cosida desaparece y corre hacia la izquierda todo lo que queda a su derecha.
  Confundirlas abría los costadillos justo lo que suman las pinzas — 68 mm
  medidos en la blusa.
- **Un escote no es una pinza.** Es tela que falta en el borde, no un hueco que
  se cierre. Descontarlo colapsaba el escote sobre el centro delantero.
- **Los cuatro cuadrantes de una elipse miden lo mismo.** Por eso se trabaja con
  fracciones de perímetro y no con ángulos: la fracción ½ cae siempre en el
  centro de la espalda, sea cual sea lo achatada que esté la sección. Repartir
  por ángulo desplaza el costadillo más de un centímetro.

Después queda una **relajación cinemática**: proyección de posiciones al estilo
Gauss-Seidel con las costuras, las longitudes del patrón y la colisión con el
cuerpo. Sin masa, sin velocidad, sin gravedad, sin paso de tiempo — determinista
y estática. Es literalmente el bucle interior de un solver XPBD sin la parte
dinámica, así que la Fase 13 lo amplía en vez de sustituirlo.

### Lo que este método no puede hacer

El hombro y la sisa quedan abiertos, 178 mm, y **no es un ajuste que falte
afinar**. Un envoltorio cilíndrico no tiene por dónde pasar por encima del
hombro, y la copa de manga tiene que salvar los 270 mm que separan la sisa del
brazo colgando. Es una forma que el modelo no sabe representar, no un error
local.

Se nota en la cifra de tensión: el 98,8 % de las aristas del delantero se queda
por debajo del 20 %, y las once restantes —todas en la esquina de hombro y
escote— se disparan. Por eso el informe da el **percentil 95** además del
máximo: una sola cifra extrema no dice nada del resto de la prenda.

Esa región es exactamente la que cierra la simulación de la Fase 13.

### El mapa de tensión

Comparar cada arista de la malla con su longitud en el patrón dice dónde falta o
sobra tela. Y la cifra no es un artefacto del método: un plano no se puede
aplicar sobre una superficie de doble curvatura sin deformarlo —Teorema Egregio
de Gauss—, así que envolver siempre introduce tensión. La pregunta útil no es si
aparece, sino dónde: donde el patrón tiene la curvatura que le toca, es pequeña.

La rampa es **divergente** —azul comprime, gris reposa, rojo estira— porque
falta de tela y sobra de tela son problemas opuestos que un degradado de un solo
color confundiría en los extremos.

## Exportación a escala real

Lo que garantiza la escala es distinto en cada formato:

- **SVG** — `width`/`height` en **milímetros** y un `viewBox` con los mismos
  números. Una unidad de usuario es un milímetro por definición.
- **PDF** — puntos PostScript, 72 por pulgada. Un A4 son 595.276 × 841.890
  puntos exactos. Su eje Y ya apunta hacia arriba, igual que el modelo, así que
  no hay inversión que aplicar; en SVG sí, y es donde vigilar los espejos.

El **cuadrado de comprobación** de 100 mm no es decorativo: los controladores
de impresión ajustan al área imprimible por defecto, una reducción del 4 % es
invisible en la vista previa, y el patrón sale una talla pequeño sin que nada
avise. Convierte un fallo silencioso en una comprobación de tres segundos con
una regla. Es el riesgo R6.

Las páginas **se solapan** a propósito. Si encajaran justo habría que cortar por
el borde y unir a tope: un milímetro de desvío por junta se acumula y a las diez
páginas el patrón mide un centímetro de más. Con solape y marcas de registro
cada junta se alinea contra una referencia absoluta, no contra la anterior.

## Graduación

Una talla **no es el patrón base deformado**: es el trazado completo de otro
cuerpo. Cambiar las medidas y regenerar es lo que garantiza que cada talla sea
coherente consigo misma.

Hay dos graduadores, y la diferencia no es cosmética:

- **Por medidas** — aplica incrementos a las medidas introducidas. El correcto
  para llevar el bloque de una persona a sus tallas vecinas.
- **Por tabla** — usa medidas antropométricas de referencia, que **no son
  lineales**: los saltos entre tallas grandes son mayores que entre pequeñas y
  ninguna fórmula de incrementos constantes los reproduce.

Un cuerpo crece sobre todo en **volumen**: 45 mm de pecho por talla frente a
3.5 de largo de hombro y 6.5 de largo de talle. Escalar el patrón por un
factor —el error intuitivo— daría tallas grandes con hombros de gigante.

Falta el **graduador por reglas de punto**, que es lo que usa la industria
porque conserva las líneas de estilo exactamente. La interfaz `Grader` está
puesta para admitirlo sin tocar ni la interfaz ni los generadores. Es el
riesgo R7 del documento de arquitectura.

## Medir y resolver, en vez de calcular

Dos veces se ha repetido el mismo patrón, y es el que distingue este motor de un
dibujo paramétrico:

| Pregunta | Método |
|---|---|
| ¿Qué anchura da a la cintura la longitud pedida? | Se resuelve invirtiendo la longitud de arco |
| ¿Qué altura de copa mide lo que la sisa más el embebido? | Se dibuja la sisa, **se mide**, y se resuelve |

Ninguna de las dos tiene fórmula cerrada: son longitudes de arco de curvas de
Bézier. El trazado clásico las afina a ojo con la cinta métrica sobre el papel.
Aquí las resuelve una bisección en microsegundos, y por eso los criterios de
salida son exactos y no aproximados.

Es también la razón de no necesitar un solver de restricciones bidireccional
(decisión D2): las preguntas inversas del patronaje son de una sola variable.

## Ajustes manuales sobre el trazado

Arrastrar un punto del patrón en el lienzo guarda un **desplazamiento asociado
al nombre del punto**, no una posición. Al regenerar —otra talla, otra medida,
otra holgura— el generador vuelve a calcular la posición paramétrica y el
desplazamiento se suma encima.

Es la respuesta al problema más subestimado de un sistema paramétrico: guardar
la posición absoluta dejaría el punto quieto mientras el resto de la pieza se
mueve. Los ajustes son además enumerables y reversibles desde el panel de
parámetros — sin eso, el patrón dejaría de comportarse como dicen sus fórmulas
y no habría forma de averiguar por qué.

## Notas de precisión

Tres decisiones numéricas que conviene conocer antes de tocar `core`:

- **Los arcos se conservan como arcos.** Su longitud es `R·|barrido|`, exacta.
  Aproximarlos por cúbicas los alarga un 1.4·10⁻⁴ relativo — 0.09 mm en una
  circunferencia de 628 —, tolerable para dibujar pero no para casar una copa
  de manga con su sisa.
- **La longitud de una cúbica se integra por tramos** partidos en las raíces de
  `B'(t)`. Ahí `|B'|` deja de ser suave y el estimador de error de la cuadratura
  adaptativa puede engañarse, devolviendo un resultado erróneo que no mejora
  aunque se apriete la tolerancia.
- **Toda colocación métrica usa longitud de arco, nunca el parámetro.** En una
  cúbica, `t = 0.5` no está a mitad de recorrido; usar el parámetro para situar
  un piquete lo desplaza milímetros.
- **La línea de costura es la fuente; la de corte es derivada.** Cambiar un
  margen no toca el patrón, sólo vuelve a pasar por `cutLine()`.
- **Las uniones que el patrón 2D no representa hay que generarlas.** Tres: el
  centro (una pieza con su propio reflejo, por doblez o por cremallera), las dos
  patas de cada pinza, y —cuidado— NO el doblez longitudinal de una pretina, que
  superpone las dos mitades en vez de extender la prenda.
- **El muestreo desplaza una muestra a cada esquina; nunca inserta una.** El
  vértice de una pinza casi nunca cae en una muestra uniforme, y la cuerda entre
  las dos muestras que lo rodean redondea el pico —hasta 9 mm medidos en el
  delantero de la blusa—. Insertarlo cambiaría el recuento de la arista, y ese
  recuento está pactado con la arista con la que se cose. Desplazar la muestra
  más cercana lo conserva exacto.

## Limitación conocida del margen de costura

`offsetPolygon` aplana el contorno y desplaza la polilínea con anchura por
arista, resolviendo las esquinas y eliminando los lazos que dejan los vértices
cóncavos. Cubre las piezas normales, pero **no** el caso en que un margen mayor
que el ancho local parte la pieza en regiones inconexas: el tipo de retorno es
un único polígono.

Se implementó de forma nativa en lugar de con Clipper2 —previsto en la
arquitectura— para mantener `core` sin dependencias y poder probarlo a fondo.
La sustitución está acotada a `removeSelfIntersections`; cuando un patrón real
rompa el caso inconexo, ahí entra Clipper. Es el riesgo R3 del documento de
arquitectura.
