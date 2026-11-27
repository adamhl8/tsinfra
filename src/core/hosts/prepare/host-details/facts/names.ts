import type { FactContext, NamedFact } from "#core/hosts/prepare/host-details/facts.ts"
import { getOwnValue } from "#utils.ts"

/**
 * Returns tsinfra's name in `names` for what the host printed for `fact`, or what it printed when `names` has none, and
 * records a warning about that value.
 */
export const toNamedFact = <T extends string>(
  ctx: FactContext,
  fact: NamedFact,
  names: Readonly<Record<string, T>>,
  printed: string,
): T => {
  const value = getOwnValue(names, printed)
  if (value !== undefined) return value

  ctx.recorder.recordWarning({ kind: "unknownFact", fact, value: printed })
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion - pass through a value tsinfra has no name for, which the host's warning reports
  return printed as T
}
