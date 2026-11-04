import { host } from "tsinfra"

export default host("@local", async (h) => {
  await h.ensure("Pending", { check: "false", want: true, fix: "true" })
})
