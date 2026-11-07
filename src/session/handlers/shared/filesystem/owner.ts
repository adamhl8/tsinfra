import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { HostOwner, OwnerChange, OwnerOptions } from "#session/handlers/shared/filesystem/attributes.ts"
import type { Shell } from "#session/shell.ts"

/** Who runs the step's commands, which is root under `sudo`. `user` is empty for a uid with no name. */
interface CommandUser {
  uid: number
  user: string
}

const ROOT_UID = 0
// Allow `id -un` to fail, because a uid can have no name in a container.
const COMMAND_USER_COMMAND = "id -u && { id -un 2>/dev/null || true; }"
const commandUidSchema = type("string.integer.parse")

/** Lists the given owners that differ on the host, comparing a name with a name and a number with an id. */
export const findOwnerChanges = (hostOwner: HostOwner, options: OwnerOptions): OwnerChange[] => {
  const { user, group } = options

  const changes: OwnerChange[] = []

  const gotUser = typeof user === "number" ? hostOwner.uid : hostOwner.user
  if (user !== undefined && gotUser !== user) changes.push({ name: "user", got: gotUser, want: user })

  const gotGroup = typeof group === "number" ? hostOwner.gid : hostOwner.group
  if (group !== undefined && gotGroup !== group) changes.push({ name: "group", got: gotGroup, want: group })

  return changes
}

const getCommandUser = async (shell: Shell): Promise<Result<CommandUser>> => {
  const stdout = await shell.exec(COMMAND_USER_COMMAND, { label: "user command" })
  if (isErr(stdout)) return err("failed to read who runs the step's commands", stdout)

  const [uidLine = "", user = ""] = stdout.split("\n")
  const uid = commandUidSchema(uidLine)
  if (uid instanceof type.errors)
    return err(`the user command printed '${uidLine}' instead of the id of the user running it`, undefined)

  return { uid, user }
}

/**
 * Fails a write that can only fail at its `chown`, so the mistake shows in `plan` too. A write always ends with `path`
 * owned by `user`, or by its current owner, and only root can make that anyone but itself.
 */
export const checkWriteOwner = async (
  shell: Shell,
  path: string,
  hostOwner: HostOwner | undefined,
  options: OwnerOptions,
): Promise<Result> => {
  const { user } = options

  // Skip something new with no `user`, because whoever writes it owns it.
  if (user === undefined && hostOwner === undefined) return

  const commandUser = await getCommandUser(shell)
  if (isErr(commandUser)) return commandUser

  if (commandUser.uid === ROOT_UID) return

  if (user !== undefined) {
    const isCommandUser = user === (typeof user === "number" ? commandUser.uid : commandUser.user)
    if (!isCommandUser) {
      return err(
        `user '${user}' needs sudo: true, because only root can change a file's owner to another user`,
        undefined,
      )
    }

    return
  }

  if (hostOwner !== undefined && hostOwner.uid !== commandUser.uid)
    return err(`'${path}' is owned by '${hostOwner.user}', so writing it needs sudo: true`, undefined)
}
