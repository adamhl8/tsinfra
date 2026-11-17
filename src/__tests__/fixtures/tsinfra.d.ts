// Let the fixtures import `tsinfra`, which only gets installed in their temp copy.
declare module "tsinfra" {
  export * from "#index.ts"
}
