import type { AlignedRow } from "#report/format/details/aligned-row.ts"
import { formatAlignedRow } from "#report/format/details/aligned-row.ts"
import type { Want, EnsureComparisonValues } from "#session/session.ts"
import { styleGot, styleGotExitCode, styleGotString, styleWant, styleWantExitCode, styleWantString } from "#styles.ts"

interface ValueKindRules {
  formatGot: (got: EnsureComparisonValues["got"]) => string
  formatWant: (want: Want) => string
}

const VALUE_KIND_RULES: Record<EnsureComparisonValues["kind"], ValueKindRules> = {
  string: {
    formatGot: (got) => styleGotString(String(got)),
    formatWant: (want) => styleWantString(String(want)),
  },
  boolean: {
    formatGot: (got) => styleGot(String(got)),
    formatWant: (want) => styleWant(String(want)),
  },
  exit: {
    formatGot: (got) => styleGotExitCode(`exit code ${String(got)}`),
    formatWant: (want) => styleWantExitCode(want === true ? "exit code 0" : "a non-zero exit code"),
  },
}

/** Formats what an `ensure` compared as its `got` and `want` rows. */
export const formatEnsureValues = (values: EnsureComparisonValues): AlignedRow[] => {
  const { formatGot, formatWant } = VALUE_KIND_RULES[values.kind]
  return [formatAlignedRow("got", [formatGot(values.got)]), formatAlignedRow("want", [formatWant(values.want)])]
}
