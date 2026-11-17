import { host } from "tsinfra"

export default host({ name: "caddy", target: "@local" }, async (h) => {
  await h.read("true")
})
