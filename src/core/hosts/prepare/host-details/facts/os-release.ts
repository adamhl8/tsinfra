import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { FactContext, OsRelease } from "#core/hosts/prepare/host-details/facts.ts"

// Source the file, because its values can be quoted or escaped like shell.
// Print each value after its name, so the lines read the same whichever ones are empty.
// Print nothing when there's no file, like on macOS.
const READ_OS_RELEASE_COMMAND = [
  "for f in /etc/os-release /usr/lib/os-release; do",
  '  [ -r "$f" ] || continue',
  '  . "$f"',
  `  printf 'ID=%s\\nID_LIKE=%s\\nVERSION_ID=%s\\nVERSION_CODENAME=%s\\nPRETTY_NAME=%s\\n' "\${ID-}" "\${ID_LIKE-}" "\${VERSION_ID-}" "\${VERSION_CODENAME-}" "\${PRETTY_NAME-}"`,
  "  break",
  "done",
].join("\n")

// Expect every name, because the command prints all of them when there's a file.
const osReleaseValuesSchema = type({
  ID: "string",
  ID_LIKE: "string",
  VERSION_ID: "string",
  VERSION_CODENAME: "string",
  PRETTY_NAME: "string",
})

const WHITESPACE = /\s+/v

// Treat an empty value as left out, because the command prints every name.
const toValue = (value: string) => (value === "" ? undefined : value)

/**
 * Returns the distribution from what the os-release command printed, or undefined when it printed nothing. Fails when a
 * name it always prints is missing.
 */
export const toOsRelease = (output: string): Result<OsRelease | undefined> => {
  if (output === "") return undefined

  const lineValues = Object.fromEntries(
    output
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => {
        const [name = "", ...valueParts] = line.split("=")
        return [name, valueParts.join("=")]
      }),
  )
  const values = osReleaseValuesSchema(lineValues)
  if (values instanceof type.errors)
    return err("the os-release command printed values tsinfra can't read", err(values.summary, undefined))

  // Default `ID` to `linux`, as the os-release spec does.
  const id = toValue(values.ID) ?? "linux"
  const idLike = toValue(values.ID_LIKE)?.split(WHITESPACE) ?? []
  return Object.freeze({
    id,
    idLike: Object.freeze(idLike),
    versionId: toValue(values.VERSION_ID),
    versionCodename: toValue(values.VERSION_CODENAME),
    prettyName: toValue(values.PRETTY_NAME),
  })
}

/** Reads the host's `/etc/os-release`, or `/usr/lib/os-release`, or undefined when it has neither, like macOS. */
export const readOsRelease = async (ctx: FactContext): Promise<Result<OsRelease | undefined>> => {
  const output = await ctx.shell.exec(READ_OS_RELEASE_COMMAND, { label: "os-release" })
  if (isErr(output)) return err("failed to read the host's os-release file", output)

  return toOsRelease(output)
}
