import { host } from "#core/hosts/host.ts"

export default host({ name: "my host", target: "bad-name.lan" }, async () => {
  /* empty */
})
