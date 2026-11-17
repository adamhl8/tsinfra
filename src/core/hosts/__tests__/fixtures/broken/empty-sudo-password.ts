import { host } from "#core/hosts/host.ts"

export default host(
  { name: "empty-sudo-password", target: "empty-sudo-password.lan", sudo: { password: "" } },
  async () => {
    /* empty */
  },
)
