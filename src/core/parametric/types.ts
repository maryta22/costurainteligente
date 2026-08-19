import type { ExpressionIssue } from '../expression/parser';

/** Unidad de un parámetro. Sólo afecta a cómo se muestra, no al cálculo. */
export type ParameterUnit = 'mm' | 'deg' | 'ratio' | 'count';

export interface ParameterDefinition {
  readonly name: string;
  /** Fórmula, en el lenguaje de expresiones. */
  readonly expression: string;
  readonly label?: string;
  readonly unit?: ParameterUnit;
  readonly description?: string;
}

/**
 * Problemas detectados al evaluar el conjunto de parámetros.
 *
 * Se acumulan en lugar de abortar al primero: quien edita una fórmula quiere
 * ver TODO lo que está roto, no descubrirlo de uno en uno.
 */
export type ParametricIssue =
  | {
      readonly kind: 'syntax';
      readonly parameter: string;
      readonly issue: ExpressionIssue;
      readonly source: string;
    }
  | {
      readonly kind: 'evaluation';
      readonly parameter: string;
      readonly issue: ExpressionIssue;
      readonly source: string;
    }
  | {
      readonly kind: 'unknown-reference';
      readonly parameter: string;
      readonly reference: string;
      readonly issue: ExpressionIssue;
      readonly source: string;
    }
  | {
      readonly kind: 'cycle';
      /** Camino del ciclo, con el primer nombre repetido al final. */
      readonly path: readonly string[];
    }
  | { readonly kind: 'duplicate'; readonly parameter: string }
  | { readonly kind: 'shadows-input'; readonly parameter: string };

export interface ParameterEvaluation {
  /** Valores obtenidos, incluidas las entradas. */
  readonly values: ReadonlyMap<string, number>;
  /** Orden en que se evaluaron los parámetros derivados. */
  readonly order: readonly string[];
  readonly issues: readonly ParametricIssue[];
  readonly ok: boolean;
}
