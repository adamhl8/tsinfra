import { formatWarningLabel, formatWarningValue } from "#report/format/elements/elements.ts"
import type { StepWarning } from "#report/host-block/host-block.ts"

// Point each warning's words at the value it's about, which follows them.
const WARNING_WORDS: Record<StepWarning["kind"], string> = {
  missingTarget: "nothing exists at target ->",
}

/**
 * Formats a warning, like `warning: nothing exists at target -> /x`, with the value it's about after its words. Leaves
 * the words unstyled, so they read like the rest of the details.
 */
export const formatWarning = (warning: StepWarning): string =>
  `${formatWarningLabel("warning")} ${WARNING_WORDS[warning.kind]} ${formatWarningValue(warning.target)}`
