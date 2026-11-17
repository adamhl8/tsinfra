import { host } from "tsinfra"

export default host({ name: "b", target: "@local" }, () => {
  throw new Error("boom")
})
