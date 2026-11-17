import { host } from "#core/hosts/host.ts"

const getTarget = (): string => {
  throw new Error("boom")
}

export default host({ name: "throws", target: getTarget() }, async () => {
  /* empty */
})
