import { host } from "tsinfra"

export default host("@local", async (h) => {
  await h.ensure("Pending", { want: true, check: "false", fix: "true" })
})
