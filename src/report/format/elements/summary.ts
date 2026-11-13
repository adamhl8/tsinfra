import type { EntryStatus } from "#report/host-block/host-block.ts"
import { STATUS_COLORS, styleWarning } from "#styles.ts"

/**
 * Formats a host's status in the summary, like `2 changes` or `failed`, in the status's color, so it matches its
 * symbol.
 */
export const formatStatusText = (status: EntryStatus, text: string): string => STATUS_COLORS[status](text)

/** Formats a count of warnings, like `1 warning`, in the warning color, so one isn't lost once the blocks scroll away. */
export const formatWarningCount = (text: string): string => styleWarning(text)
