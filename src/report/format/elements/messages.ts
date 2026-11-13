import { styleError, styleItalic, styleMuted, styleWarning } from "#styles.ts"

/** Formats tsinfra's own aside, like "no steps" or a note in place of a diff, muted and italic. */
export const formatNote = (text: string): string => styleItalic(styleMuted(text))

/** Formats how to fix a failure in the warning color, italic because it has no label to set it apart. */
export const formatHint = (text: string): string => styleItalic(styleWarning(text))

/** Formats the label that starts a warning with its colon, like `warning:`, in the warning color. */
export const formatWarningLabel = (name: string): string => styleWarning(`${name}:`)

/** Formats one line of an error. */
export const formatErrorLine = (line: string): string => styleError(line)

/** Formats words that describe a change, like `new file`, in italics, because they don't show a value. */
export const formatChangeDescription = (words: string): string => styleItalic(words)

/** Formats the reminder that `plan` checked steps after a change without it, muted so the host lines stay the focus. */
export const formatPlanReminder = (text: string): string => styleMuted(text)
