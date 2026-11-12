/** What a secret shows as wherever it would show, as GitLab CI shows it. */
export const MASKED_VALUE = "[MASKED]"

/**
 * Adds `value` to `secrets`, and each of its lines on its own, because a diff or a stderr line can show one line of a
 * multi-line secret. Skips empty values and blank lines, because masking an empty string would mask between every
 * character.
 */
export const addSecret = (secrets: Set<string>, value: string): void => {
  const lines = value.split("\n")
  const valueAndLines = [value, ...lines]
  for (const secret of valueAndLines) if (secret.trim() !== "") secrets.add(secret)
}

/** Returns a pattern that matches any of `secrets`, longest first, so a secret holding another masks as one. */
const toSecretsPattern = (secrets: ReadonlySet<string>): RegExp => {
  const longestFirst = [...secrets].toSorted((a, b) => b.length - a.length)
  return new RegExp(longestFirst.map((secret) => RegExp.escape(secret)).join("|"), "gv")
}

/**
 * Replaces every match of `pattern` in `text` in one pass, so a secret can't match inside a mask it just added. Skip
 * each existing mask, so masking the same text twice changes nothing.
 */
const maskText = (text: string, pattern: RegExp): string =>
  text
    .split(MASKED_VALUE)
    .map((part) => part.replace(pattern, MASKED_VALUE))
    .join(MASKED_VALUE)

/**
 * Masks each error's message and stack in place, along its cause chain. Mask in place, because the recorder compares
 * errors by identity. Mask the stack too, because it keeps the message the error was created with.
 */
const maskErrorChain = (error: Error, pattern: RegExp): void => {
  let current: unknown = error
  while (current instanceof Error) {
    current.message = maskText(current.message, pattern)
    if (current.stack !== undefined) current.stack = maskText(current.stack, pattern)
    current = current.cause
  }
}

/** Returns `value` with each string in it masked, copying arrays and plain objects, and masking errors in place. */
const maskUnknown = (value: unknown, pattern: RegExp): unknown => {
  if (typeof value === "string") return maskText(value, pattern)
  if (value instanceof Error) {
    maskErrorChain(value, pattern)
    return value
  }
  if (Array.isArray(value)) return value.map((item: unknown) => maskUnknown(item, pattern))
  if (typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, maskUnknown(item, pattern)]))

  return value
}

/**
 * Returns `value` with every one of `secrets` in it as `MASKED_VALUE`, ready to go into the record. Never changes
 * `value`, except an error, which it masks in place along its cause chain, so it stays the same object. Keep errors the
 * same object, because the recorder compares them by identity. A caller that still holds the error, like the script,
 * sees it masked too.
 */
export const maskSecrets = <T>(value: T, secrets: ReadonlySet<string>): T => {
  if (secrets.size === 0) return value

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion - `maskUnknown` keeps each value's shape, and only changes strings
  return maskUnknown(value, toSecretsPattern(secrets)) as T
}
