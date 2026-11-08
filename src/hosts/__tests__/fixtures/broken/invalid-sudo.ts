import { castInvalid } from "#__tests__/session.ts"
import { host } from "#index.ts"

export default host(
  "invalid-sudo.lan",
  async () => {
    /* empty */
  },
  { sudo: castInvalid("yes") },
)
