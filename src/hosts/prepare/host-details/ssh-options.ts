import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Shell } from "#transport/transport.ts"
import { quoteShellArg, splitNonEmptyLines } from "#utils.ts"

/** An option tsinfra passes only when `ssh -G` shows the setting at ssh's own default. */
interface ConfigDefault {
  /** The setting's name as `ssh -G` prints it. */
  setting: string
  sshDefault: string
  option: string
}

// Fill in only where the user's config says nothing, because a command-line option beats the config file.
// `ssh -G` can't tell an explicit setting from the default, so an explicit `ask` or `INFO` gets filled in too.
const CONFIG_DEFAULTS: ConfigDefault[] = [
  { setting: "stricthostkeychecking", sshDefault: "ask", option: "StrictHostKeyChecking=accept-new" },
  { setting: "connecttimeout", sshDefault: "none", option: "ConnectTimeout=10" },
  { setting: "loglevel", sshDefault: "INFO", option: "LogLevel=ERROR" },
]

/**
 * Reads the settings ssh would use for `target` with `ssh -G`, which reads the config without connecting, and returns
 * the options for each one the config leaves at ssh's default. Pass `-T`, because `-G` warns on stderr that it won't
 * allocate a terminal when stdin isn't one.
 */
export const readSshDefaultOptions = async (localShell: Shell, target: string): Promise<Result<string[]>> => {
  const stdout = await localShell.exec(`ssh -G -T -- ${quoteShellArg(target)}`, { label: "ssh config" })
  if (isErr(stdout)) return err(`failed to read the ssh config for '${target}'`, stdout)

  // Join the rest of each line back up, because a value can hold spaces too.
  const settingEntries = splitNonEmptyLines(stdout).map((line): [string, string] => {
    const [setting = "", ...valueWords] = line.split(" ")
    return [setting, valueWords.join(" ")]
  })
  const settings = new Map(settingEntries)

  return CONFIG_DEFAULTS.filter(({ setting, sshDefault }) => settings.get(setting) === sshDefault).flatMap(
    ({ option }) => ["-o", option],
  )
}
