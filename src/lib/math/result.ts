export type DomainError =
  | { code: 'invalid_input'; message: string }
  | { code: 'expired'; message: string }
  | { code: 'below_intrinsic'; message: string }
  | { code: 'above_upper_bound'; message: string }
  | { code: 'no_bracket'; message: string }
  | { code: 'non_convergent'; message: string }
  | { code: 'indeterminate'; message: string };

export type MathResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DomainError };

export function ok<T>(value: T): MathResult<T> { return { ok: true, value }; }
export function err<T>(error: DomainError): MathResult<T> { return { ok: false, error }; }
