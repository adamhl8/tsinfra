import { host } from "tsinfra"

export default host("@local", async (h) => {
  await h.read("true")
  await h.ensure("Install git", { check: "true", want: true, fix: "true" })
})
