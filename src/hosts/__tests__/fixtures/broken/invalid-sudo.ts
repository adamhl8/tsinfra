import { castInvalid } from "#__tests__/session.ts"
import { host } from "#index.ts"

export default host({ name: "invalid-sudo", target: "invalid-sudo.lan", sudo: castInvalid("yes") }, async () => {
  /* empty */
})
