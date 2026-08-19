/**
 * Tipos nominales («branded types»).
 *
 * TypeScript es estructural: con `type PointId = string` nada impide pasar un
 * `LineId` donde se espera un `PointId`. La marca fantasma añade nominalidad
 * sin coste alguno en tiempo de ejecución — el símbolo se declara con
 * `declare const`, por lo que sólo existe en el sistema de tipos y nunca se
 * emite a JavaScript.
 *
 * @example
 * type PointId = Brand<string, 'PointId'>;
 * const id = 'p1' as PointId;   // única forma de construirlo: aserción
 */
declare const BRAND: unique symbol;

export type Brand<T, B extends string> = T & { readonly [BRAND]: B };
