import { host } from "#index.ts"

const getTarget = (): string => {
  throw new Error("boom")
}

export default host(getTarget(), async () => {
  /* empty */
})
