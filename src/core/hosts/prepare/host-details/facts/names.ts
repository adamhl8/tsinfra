import type { FactResult, NamedFact } from "#core/hosts/prepare/host-details/facts.ts"
import { getOwnValue } from "#utils.ts"

/**
 * Returns tsinfra's name in `names` for what the host printed for `fact`, or what it printed with a warning when
 * `names` has none.
 */
export const toNamedFact = <T extends string>(
  fact: NamedFact,
  names: Readonly<Record<string, T>>,
  printed: string,
): FactResult<T> => {
  const value = getOwnValue(names, printed)
  if (value !== undefined) return { value, warning: undefined }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion - pass through a value tsinfra has no name for, which the host's warning reports
  return { value: printed as T, warning: { kind: "unknownFact", fact, value: printed } }
}
