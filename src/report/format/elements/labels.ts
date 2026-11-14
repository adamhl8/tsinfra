import { styleItalic, styleMuted, styleValue } from "#styles.ts"

/** Formats a row's label with its colon, like `got:`, muted so the value after it stands out. */
export const labelElement = (name: string): string => styleMuted(`${name}:`)

/** Formats a heading over the rows under it, like `commands:`, muted and italic so it reads as tsinfra's, not a row's. */
export const headingElement = (name: "options" | "commands" | "output"): string => styleItalic(styleMuted(`${name}:`))

/** Formats a key of an object with its colon, like an option's `env:` or a record's `pnpm:`, muted like a row's label. */
export const keyElement = (name: string): string => styleMuted(`${name}:`)

/** Formats an option's name on the options line, like `env`. */
export const optionNameElement = (name: string): string => styleMuted(name)

/**
 * Formats the keys of an option that takes an object, in braces, like `{ URL, PORT }`. Uses braces, because a colon
 * would nest under `options:`, and the braces keep one option's keys apart from the next option's.
 */
export const optionEntriesElement = (keys: string[]): string =>
  `${styleMuted("{")} ${keys.map((key) => styleValue(key)).join(", ")} ${styleMuted("}")}`
