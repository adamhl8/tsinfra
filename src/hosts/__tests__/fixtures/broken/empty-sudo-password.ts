import { host } from "#index.ts"

export default host(
  "empty-sudo-password.lan",
  async () => {
    /* empty */
  },
  { sudo: { password: "" } },
)
