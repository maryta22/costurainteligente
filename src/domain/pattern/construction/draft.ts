import type { Vec2 } from '@core/geometry/vec2';
import { add, distance, vec2 } from '@core/geometry/vec2';

/**
 * Desplazamiento manual de un punto del trazado.
 *
 * ── AVISO 2 de docs/ARCHITECTURE.md, resuelto ──────────────────────────────
 *
 * El problema: si el usuario arrastra un punto y luego cambia una medida, ¿se
 * pierde su ajuste? Es el defecto más subestimado de un sistema paramétrico, y
 * la respuesta ingenua —guardar la posición absoluta— es la peor: al regenerar,
 * el punto se quedaría donde estaba mientras el resto de la pieza se mueve.
 *
 * La solución es guardar un DELTA asociado al NOMBRE del punto en el trazado.
 * Al regenerar, el generador vuelve a calcular la posición paramétrica y el
 * delta se suma encima. El ajuste sobrevive al cambio de medidas, de talla y de
 * holgura, porque describe una corrección relativa y no un sitio.
 *
 * Y, por la misma razón, es enumerable y borrable: el usuario puede ver qué
 * puntos ha tocado y devolverlos a su valor paramétrico.
 */
export interface PointOverride {
  /** Nombre del punto en el trazado, p. ej. `front.waistSide`. */
  readonly point: string;
  /** Corrección en milímetros, en coordenadas locales de la pieza. */
  readonly delta: Vec2;
  readonly note?: string;
}

export type OverrideMap = ReadonlyMap<string, Vec2>;

export const buildOverrideMap = (overrides: readonly PointOverride[]): OverrideMap =>
  new Map(overrides.map((override) => [override.point, override.delta]));

/** Un punto del trazado, con su valor paramétrico y el aplicado. */
export interface DraftPoint {
  readonly name: string;
  /** Posición que da el trazado paramétrico, sin corregir. */
  readonly parametric: Vec2;
  /** Posición final, con el override sumado si lo hay. */
  readonly position: Vec2;
  readonly overridden: boolean;
}

export interface DraftContext {
  /** Parámetros ya evaluados por el motor de la Fase 4. */
  readonly values: ReadonlyMap<string, number>;
  readonly overrides: OverrideMap;
}

/**
 * Registro de un trazado en construcción.
 *
 * Todo punto con nombre pasa por `point()`, que es donde se aplica el override.
 * Concentrarlo aquí tiene una consecuencia importante: cualquier generador
 * futuro obtiene el soporte de ajustes manuales sin escribir una línea, y es
 * imposible que un generador se olvide de aplicarlos.
 *
 * El registro es además la traza del trazado: los nombres son los que aparecen
 * en la interfaz de ajustes y en los diagnósticos.
 */
export class Draft {
  private readonly registry = new Map<string, DraftPoint>();

  constructor(private readonly context: DraftContext) {}

  /** Valor de un parámetro. Cero si no existe, para no romper el trazado entero. */
  value(name: string): number {
    return this.context.values.get(name) ?? 0;
  }

  /** ¿Está definido el parámetro? Permite al generador avisar en vez de fallar. */
  has(name: string): boolean {
    return this.context.values.has(name);
  }

  /**
   * Registra un punto con nombre y devuelve su posición FINAL.
   *
   * El generador siempre trabaja con lo que devuelve esta función, nunca con la
   * posición paramétrica: así el resto del trazado —curvas, intersecciones,
   * pinzas— se construye a partir del punto ya corregido, y el ajuste manual
   * arrastra consigo todo lo que dependa de él en lugar de quedar suelto.
   */
  point(name: string, parametric: Vec2): Vec2 {
    const delta = this.context.overrides.get(name);
    const position = delta === undefined ? parametric : add(parametric, delta);

    this.registry.set(name, {
      name,
      parametric,
      position,
      overridden: delta !== undefined,
    });

    return position;
  }

  /** Posición registrada de un punto. */
  get(name: string): Vec2 {
    return this.registry.get(name)?.position ?? vec2(0, 0);
  }

  points(): readonly DraftPoint[] {
    return [...this.registry.values()];
  }

  /** Puntos con ajuste manual, para poder enumerarlos y deshacerlos. */
  overriddenPoints(): readonly DraftPoint[] {
    return this.points().filter((point) => point.overridden);
  }

  /** Cuánto se ha desplazado un punto respecto a su valor paramétrico. */
  overrideMagnitude(name: string): number {
    const point = this.registry.get(name);
    return point === undefined ? 0 : distance(point.parametric, point.position);
  }
}
