import { host } from "tsinfra"

export default host({ name: "a", target: "@local" }, async (h) => {
  await h.ensure("Pending", { want: true, check: "false", fix: "true" })
})
