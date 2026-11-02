/** Quotes `text` for a POSIX shell, so a space or a quote in it can't break the command. */
export const quoteShellArg = (text: string) => `'${text.replaceAll("'", String.raw`'\''`)}'`
