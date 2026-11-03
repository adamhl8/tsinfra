import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { FileContent } from "#session/handlers/file/comparison.ts"
import { compareContent, findAttributeChanges } from "#session/handlers/file/comparison.ts"
import type { FileMode, OctalMode, SymbolicMode } from "#session/handlers/file/mode.ts"
import { OCTAL_MODE_PATTERN, SYMBOLIC_MODE_PATTERN } from "#session/handlers/file/mode.ts"
import { toAbsolutePath } from "#session/handlers/file/path.ts"
import { buildStateCommand, parseStateOutput } from "#session/handlers/file/state-command.ts"
import type { WantedFile } from "#session/handlers/file/wanted-file.ts"
import { toWantedFile } from "#session/handlers/file/wanted-file.ts"
import type { Comparison } from "#session/handlers/shared/converge.ts"
import { converge } from "#session/handlers/shared/converge.ts"
import type { Shell } from "#session/shell.ts"
import type { NeededSteps, StepContext, StepOutcome } from "#session/step.ts"
import { neededStepsSchema, nonEmptyStringSchema } from "#session/step.ts"

export interface FileOptions {
  /** What the file should hold, computed on the control machine. */
  content: string | Uint8Array
  /**
   * The file's mode, in octal like `"644"`, symbolic like `"rw-r--r--"`, or a constant like `PUBLIC_FILE_MODE`. An
   * existing file keeps its own when this is left out.
   */
  mode?: FileMode
  /** The owner: a name is compared with the file owner's name, and a number with its uid. */
  owner?: string | number
  /** The group: a name is compared with the file group's name, and a number with its gid. */
  group?: string | number
  /** Never fetches or shows the old content, because it may hold a secret. */
  secret?: boolean
  /**
   * Earlier steps this step depends on. In `plan`, the step waits instead of reading the file when one of them would
   * change or is waiting.
   */
  needs?: NeededSteps
}

// Validate the options at runtime too, because a script can get past the types, like with `as` or `@ts-ignore`.
// Widen `Uint8Array` with `as`, because ArkType infers `Uint8Array<ArrayBuffer>` and `FileOptions` takes any buffer.
// Type each mode pattern with `as`, because ArkType infers a regex as a plain `string`.
const fileOptionsSchema = type.declare<FileOptions>().type({
  content: type("string").or(type.instanceOf(Uint8Array).as<Uint8Array>()),
  "mode?": type(OCTAL_MODE_PATTERN).as<OctalMode>().or(type(SYMBOLIC_MODE_PATTERN).as<SymbolicMode>()),
  "owner?": "string | number",
  "group?": "string | number",
  "secret?": "boolean",
  "needs?": neededStepsSchema,
})

interface CompareFileInput {
  shell: Shell
  path: string
  wantedFile: WantedFile
  secret: boolean
}

/** Reads the file's state on the host and compares it with what the script wants. */
const compareFile = async (input: CompareFileInput): Promise<Result<Comparison>> => {
  const { shell, path, wantedFile } = input

  const commandOutput = await shell.inspect(buildStateCommand(path))
  if (isErr(commandOutput)) return commandOutput

  const findings = parseStateOutput(commandOutput.stdout)
  if (isErr(findings)) return findings

  if (findings.kind === "link") return err(`'${path}' is a symlink, so file won't replace it`, undefined)
  if (findings.kind === "other") return err(`'${path}' isn't a regular file, so file won't replace it`, undefined)
  if (findings.kind === "unreadable")
    return err(`can't read '${path}' as the SSH user, so it needs sudo: true`, undefined)

  if (findings.kind === "absent") {
    const content: FileContent = { kind: "new", wantSize: wantedFile.size }
    return { inSync: false, values: { kind: "file", content, attributes: [] } }
  }

  const { hostFile } = findings
  const content = await compareContent({ ...input, hostFile })
  if (isErr(content)) return content

  const attributes = findAttributeChanges(hostFile, wantedFile)
  const inSync = content.kind === "same" && attributes.length === 0
  return { inSync, values: { kind: "file", content, attributes } }
}

export const handleFile = async (ctx: StepContext, path: unknown, options: unknown): Promise<Result<StepOutcome>> => {
  const { stepName, shell, home } = ctx

  const validPath = nonEmptyStringSchema(path)
  if (validPath instanceof type.errors)
    return err("failed to validate the path given to 'file'", err(validPath.summary, undefined))

  const validOptions = fileOptionsSchema(options)
  if (validOptions instanceof type.errors)
    return err(`failed to validate the options given to step '${stepName}'`, err(validOptions.summary, undefined))

  const { secret = false, needs = [] } = validOptions

  const absolutePath = toAbsolutePath(validPath, home)
  if (isErr(absolutePath)) return absolutePath

  const wantedFile = toWantedFile(validOptions)
  const outcome = await converge(ctx, {
    needs,
    compare: async () => compareFile({ shell, path: absolutePath, wantedFile, secret }),
    // oxlint-disable-next-line typescript/require-await - the write comes with part 2 of `file`, and this stands in for it
    fix: async () => err("writing files comes with part 2 of file", undefined),
    verify: true,
  })

  return outcome
}
