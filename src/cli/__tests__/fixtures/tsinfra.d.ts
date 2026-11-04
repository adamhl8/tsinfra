// Let the fixtures import `tsinfra`, which only gets installed in their temp copy.
declare module "tsinfra" {
  // oxlint-disable-next-line clean-modules/require-direct-exports - this mirrors the package's real exports
  export * from "#index.ts"
}
