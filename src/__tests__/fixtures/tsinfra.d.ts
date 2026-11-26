// Let the fixtures import `tsinfra`, which only gets installed in their temp copy.
declare module "tsinfra" {
  export * from "#index.ts"
}

declare module "tsinfra/integrations/macos/file-handlers" {
  export * from "#integrations/macos/file-handlers/index.ts"
}
