import { PX_PER_MM } from '../units';
import { clamp } from './math';
import type { Rect } from './rect';
import { rectHeight, rectWidth, rectCenter } from './rect';
import type { ScreenPoint, ScreenSize } from './screen';
import { isDegenerateSize, screenPoint } from './screen';
import type { Vec2 } from './vec2';
import { vec2 } from './vec2';

/**
 * VIEWPORT — única frontera entre coordenadas de mundo y de pantalla.
 *
 * Es la materialización de la decisión D4 de docs/ARCHITECTURE.md: la inversión
 * del eje Y ocurre en este archivo y en ningún otro lugar del sistema. Si el
 * convenio de SVG (Y hacia abajo) se filtrase al núcleo, toda la geometría 3D
 * quedaría espejada y el error sería carísimo de deshacer.
 *
 *   MUNDO     milímetros · X derecha · Y ARRIBA   · origen del documento
 *   PANTALLA  píxeles CSS · X derecha · Y ABAJO   · esquina sup. izq. del lienzo
 *
 * El estado es un objeto plano e inmutable: serializable, comparable por
 * identidad para React, y sin métodos que puedan cerrar sobre estado oculto.
 * Todas las operaciones devuelven un `Viewport` nuevo.
 */
export interface Viewport {
  /** Punto de mundo que se muestra en el centro geométrico del lienzo. */
  readonly center: Vec2;
  /** 1.0 = tamaño real en una pantalla de 96 dpi. */
  readonly zoom: number;
  /** Tamaño del lienzo en píxeles CSS. */
  readonly size: ScreenSize;
}

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 40;

export function createViewport(center: Vec2, zoom: number, size: ScreenSize): Viewport {
  return { center, zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM), size };
}

/**
 * Factor de conversión: píxeles CSS por milímetro.
 *
 * De aquí sale el criterio de salida de la Fase 1. A `zoom = 1`, la escala es
 * `PX_PER_MM`, de modo que 100 mm del modelo ocupan 100 mm físicos en pantalla.
 */
export const scaleOf = (vp: Viewport): number => vp.zoom * PX_PER_MM;

export function worldToScreen(vp: Viewport, p: Vec2): ScreenPoint {
  const scale = scaleOf(vp);
  return screenPoint(
    vp.size.width / 2 + (p.x - vp.center.x) * scale,
    vp.size.height / 2 - (p.y - vp.center.y) * scale, // ← única inversión de Y
  );
}

export function screenToWorld(vp: Viewport, s: ScreenPoint): Vec2 {
  const scale = scaleOf(vp);
  return vec2(
    vp.center.x + (s.x - vp.size.width / 2) / scale,
    vp.center.y - (s.y - vp.size.height / 2) / scale, // ← única inversión de Y
  );
}

/** Convierte una longitud del modelo (mm) a píxeles. */
export const worldToScreenLength = (vp: Viewport, mm: number): number => mm * scaleOf(vp);

/**
 * Convierte una longitud de pantalla (px) a milímetros.
 *
 * Es la función que hace que las tolerancias de interacción sean constantes en
 * pantalla e independientes del zoom: el radio de acierto de un punto se define
 * en píxeles y se traduce a mm aquí, justo antes de consultar la geometría.
 */
export const screenToWorldLength = (vp: Viewport, px: number): number => px / scaleOf(vp);

/** Rectángulo de mundo actualmente visible. */
export function visibleWorldRect(vp: Viewport): Rect {
  const scale = scaleOf(vp);
  const halfW = vp.size.width / 2 / scale;
  const halfH = vp.size.height / 2 / scale;
  return {
    min: vec2(vp.center.x - halfW, vp.center.y - halfH),
    max: vec2(vp.center.x + halfW, vp.center.y + halfH),
  };
}

export function withSize(vp: Viewport, size: ScreenSize): Viewport {
  return vp.size.width === size.width && vp.size.height === size.height ? vp : { ...vp, size };
}

export function withCenter(vp: Viewport, center: Vec2): Viewport {
  return { ...vp, center };
}

/**
 * Desplaza la vista como si se arrastrase el lienzo `(dxPx, dyPx)` píxeles.
 *
 * El contenido acompaña al cursor: arrastrar hacia la derecha muestra la
 * región de mundo situada más a la izquierda, de ahí el signo negativo en X.
 * En Y los signos se invierten de nuevo por el convenio de pantalla.
 */
export function panByScreen(vp: Viewport, dxPx: number, dyPx: number): Viewport {
  const scale = scaleOf(vp);
  return withCenter(vp, vec2(vp.center.x - dxPx / scale, vp.center.y + dyPx / scale));
}

/**
 * Fija el zoom manteniendo inmóvil el punto de mundo situado bajo `anchor`.
 *
 * Es el comportamiento esperado del zoom con rueda: el usuario apunta a un
 * detalle y ese detalle no se mueve. Se resuelve invirtiendo `screenToWorld`
 * para el nuevo factor de escala y despejando el centro:
 *
 *     w = center' + (anchor.x − w/2) / scale'      (X)
 *     w = center' − (anchor.y − h/2) / scale'      (Y)
 */
export function setZoomAtScreen(vp: Viewport, anchor: ScreenPoint, zoom: number): Viewport {
  const nextZoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  if (nextZoom === vp.zoom) return vp;

  const anchorWorld = screenToWorld(vp, anchor);
  const nextScale = nextZoom * PX_PER_MM;

  return {
    ...vp,
    zoom: nextZoom,
    center: vec2(
      anchorWorld.x - (anchor.x - vp.size.width / 2) / nextScale,
      anchorWorld.y + (anchor.y - vp.size.height / 2) / nextScale,
    ),
  };
}

export function zoomByFactorAtScreen(
  vp: Viewport,
  anchor: ScreenPoint,
  factor: number,
): Viewport {
  return setZoomAtScreen(vp, anchor, vp.zoom * factor);
}

/** Zoom centrado en el lienzo, sin punto de anclaje. */
export function setZoom(vp: Viewport, zoom: number): Viewport {
  return { ...vp, zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM) };
}

/**
 * Encuadra un rectángulo de mundo dejando `paddingPx` de margen.
 *
 * Un rectángulo degenerado (un punto, una línea vertical) no tiene escala
 * definida en algún eje: en ese caso se conserva el zoom actual y sólo se
 * recentra, en lugar de devolver un zoom infinito.
 */
export function fitToRect(vp: Viewport, rect: Rect, paddingPx = 40): Viewport {
  if (isDegenerateSize(vp.size)) return withCenter(vp, rectCenter(rect));

  const availableW = Math.max(vp.size.width - paddingPx * 2, 1);
  const availableH = Math.max(vp.size.height - paddingPx * 2, 1);
  const w = rectWidth(rect);
  const h = rectHeight(rect);

  const scaleX = w > 0 ? availableW / w : Number.POSITIVE_INFINITY;
  const scaleY = h > 0 ? availableH / h : Number.POSITIVE_INFINITY;
  const scale = Math.min(scaleX, scaleY);

  const zoom = Number.isFinite(scale) ? scale / PX_PER_MM : vp.zoom;

  return createViewport(rectCenter(rect), zoom, vp.size);
}
