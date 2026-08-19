/**
 * Punto de entrada del NÚCLEO (capa L1).
 *
 * TypeScript puro: sin DOM, sin React, sin Three.js. La frontera se verifica en
 * compilación con `npm run check:core` y en lint con las reglas de capas de
 * `eslint.config.js`.
 */

export type { Brand } from './brand';

export * from './units';

/* — expresiones y motor paramétrico — */
export * from './expression';
export * from './parametric';

/* — numérico — */
export * from './numeric/quadrature';
export * from './numeric/roots';
export * from './numeric/solve';

/* — geometría: fundamentos — */
export * from './geometry/epsilon';
export * from './geometry/math';
export * from './geometry/vec2';
export * from './geometry/screen';
export * from './geometry/rect';
export * from './geometry/mat3';

/* — geometría: primitivas de segmento — */
export * from './geometry/line';
export * from './geometry/cubic';
export * from './geometry/arc';
export * from './geometry/segment';

/* — geometría: estructuras compuestas — */
export * from './geometry/contour';
export * from './geometry/polygon';
export * from './geometry/spline';
export * from './geometry/intersect';
export * from './geometry/offset';

/* — geometría: soporte del editor — */
export * from './geometry/viewport';
export * from './geometry/grid';
