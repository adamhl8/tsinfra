import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { FileAttributeOptions } from "#session/handlers/file.ts"
import type { HostFileDetails } from "#session/handlers/file/host-file-details.ts"
import type { Shell } from "#session/shell.ts"
import type { StepContext } from "#session/step.ts"

/** Who runs the step's commands, which is root under `sudo`. `user` is empty for a uid with no name. */
interface CommandUser {
  uid: number
  user: string
}

const ROOT_UID = 0
// Allow `id -un` to fail, because a uid can have no name in a container.
const COMMAND_USER_COMMAND = "id -u && { id -un 2>/dev/null || true; }"
const commandUidSchema = type("string.integer.parse")

const getCommandUser = async (shell: Shell): Promise<Result<CommandUser>> => {
  const stdout = await shell.exec(COMMAND_USER_COMMAND, { label: "file user command" })
  if (isErr(stdout)) return err("failed to read who runs the step's commands", stdout)

  const [uidLine = "", user = ""] = stdout.split("\n")
  const uid = commandUidSchema(uidLine)
  if (uid instanceof type.errors)
    return err(`the file user command printed '${uidLine}' instead of the id of the user running it`, undefined)

  return { uid, user }
}

/**
 * Fails a write that can only fail at its `chown`, so the mistake shows in `plan` too. A write always ends with the
 * file owned by `user`, or by its current owner, and only root can make that anyone but itself.
 */
export const checkWriteOwner = async (
  ctx: StepContext,
  hostFileDetails: HostFileDetails,
  options: FileAttributeOptions,
): Promise<Result> => {
  const { shell } = ctx
  const { user } = options

  // Skip a new file with no `user`, because whoever writes it owns it.
  if (user === undefined && hostFileDetails.kind === "new") return

  const commandUser = await getCommandUser(shell)
  if (isErr(commandUser)) return commandUser

  if (commandUser.uid === ROOT_UID) return

  if (user === undefined) {
    if (hostFileDetails.kind === "existing" && hostFileDetails.attributes.uid !== commandUser.uid) {
      return err(
        `'${hostFileDetails.path}' is owned by '${hostFileDetails.attributes.user}', so writing it needs sudo: true`,
        undefined,
      )
    }

    return
  }

  const isCommandUser = user === (typeof user === "number" ? commandUser.uid : commandUser.user)
  if (!isCommandUser) {
    return err(
      `user '${user}' needs sudo: true, because only root can change a file's owner to another user`,
      undefined,
    )
  }

  return
}
