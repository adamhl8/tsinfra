import { host } from "tsinfra"

export default host("@local", () => {
  throw new Error("boom")
})
