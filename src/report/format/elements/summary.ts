import { STATUS_COLORS, styleWarning } from "#styles.ts"

type CountedStatus = "changed" | "waiting"

// Give each counted status its words, singular and plural.
const COUNT_WORDS: Record<CountedStatus, [one: string, many: string]> = {
  changed: ["change", "changes"],
  waiting: ["waiting", "waiting"],
}

/** Formats a count of steps with one status, like `2 changes`, in that status's color, so it matches its symbol. */
export const formatStatusCount = (status: CountedStatus, count: number): string => {
  const [one, many] = COUNT_WORDS[status]
  return STATUS_COLORS[status](`${count} ${count === 1 ? one : many}`)
}

/** Formats a host whose steps all left it as it was, as `unchanged` in that status's color. */
export const formatUnchanged = (): string => STATUS_COLORS.unchanged("unchanged")

/** Formats a host that failed, as `failed` in that status's color. */
export const formatFailed = (): string => STATUS_COLORS.failed("failed")

/** Formats a count of warnings, like `1 warning`, in the warning color, so one isn't lost once the blocks scroll away. */
export const formatWarningCount = (count: number): string =>
  styleWarning(`${count} ${count === 1 ? "warning" : "warnings"}`)
