const VERBOSITIES = [0, 1, 2, 3] as const

/** How much of each host's block the report shows: 0 by default, and 1 to 3 for `-v` to `-vvv`. */
export type Verbosity = (typeof VERBOSITIES)[number]

/** Returns the level a count of `-v` flags asks for, capped at the highest. */
export const toVerbosity = (flagCount: number): Verbosity =>
  VERBOSITIES.findLast((verbosity) => verbosity <= flagCount) ?? 0
