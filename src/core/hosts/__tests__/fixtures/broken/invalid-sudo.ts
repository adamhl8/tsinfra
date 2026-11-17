import { castInvalid } from "#core/__tests__/session.ts"
import { host } from "#core/hosts/host.ts"

export default host({ name: "invalid-sudo", target: "invalid-sudo.lan", sudo: castInvalid("yes") }, async () => {
  /* empty */
})
