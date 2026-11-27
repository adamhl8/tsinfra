import type { HostMessageRecord } from "#core/session/recorder/records/message.ts"
import type { HostMessageEntry } from "#report/host-block.ts"
import { MESSAGE_LEVELS } from "#report/host-block/details/step-messages.ts"

/** Returns the entry of a host message. */
export const toHostMessageEntry = (hostMessageRecord: HostMessageRecord): HostMessageEntry => {
  const { kind, messageKind, text } = hostMessageRecord
  return { kind, messageKind, text, from: MESSAGE_LEVELS[messageKind] }
}
