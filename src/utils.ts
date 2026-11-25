/** Splits `text` into its lines, leaving out the ones that are empty or only whitespace. */
export const splitNonEmptyLines = (text: string): string[] => text.split("\n").filter((line) => line.trim() !== "")

/** Returns `count` with its noun, like `1 change` or `2 changes`. */
export const countOf = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

/**
 * Returns the value `record` has at `key`, or nothing when it doesn't have the key itself, like an inherited
 * `toString`.
 */
export const getOwnValue = <V>(record: Readonly<Record<string, V>> | undefined, key: string): V | undefined =>
  record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined

/** Wraps each name in single quotes and joins them into a list, like `'a', 'b'`. */
export const quoteNames = (names: Iterable<string>): string => Array.from(names, (name) => `'${name}'`).join(", ")
