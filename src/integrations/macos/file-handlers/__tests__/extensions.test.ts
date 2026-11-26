import { describe, expect, it } from "bun:test"

import { toCheckRecord, toExtensionApps } from "#integrations/macos/file-handlers/extensions.ts"

const PREVIEW = "/System/Applications/Preview.app"
const ACROBAT = "/Applications/Acrobat.app"

const previewPdf = {
  contentType: "com.adobe.pdf",
  app: { bundleId: "com.apple.Preview" },
  handler: { bundleId: "com.apple.Preview", path: PREVIEW },
}

describe("toExtensionApps", () => {
  it("should key each app by extension", () => {
    expect(toExtensionApps({ [PREVIEW]: ["jpg", "PNG"], [ACROBAT]: ["pdf"] })).toStrictEqual({
      jpg: PREVIEW,
      png: PREVIEW,
      pdf: ACROBAT,
    })
  })

  it("should refuse an extension listed under two apps", () => {
    expect(() => toExtensionApps({ [PREVIEW]: ["pdf"], [ACROBAT]: ["PDF"] })).toThrow(
      `Extension 'pdf' is listed under both '${PREVIEW}' and '${ACROBAT}'`,
    )
  })

  it("should allow an extension listed twice under one app", () => {
    expect(toExtensionApps({ [PREVIEW]: ["pdf", "PDF"] })).toStrictEqual({ pdf: PREVIEW })
  })

  it("should refuse a path that isn't an app's", () => {
    expect(() => toExtensionApps({ "/Applications/Preview": ["pdf"] })).toThrow(
      "'/Applications/Preview' isn't a path to an app, because it doesn't end in '.app'",
    )
  })

  it("should refuse an extension with a dot", () => {
    expect(() => toExtensionApps({ [PREVIEW]: [".pdf"] })).toThrow(
      "Extension '.pdf' has a dot, so write it without one",
    )
  })
})

describe("toCheckRecord", () => {
  it("should report the wanted app when it's the handler, whatever the bundle ID's case", () => {
    const handler = { bundleId: "com.apple.preview", path: "/Other/Preview.app" }

    expect(toCheckRecord({ pdf: PREVIEW }, { pdf: { ...previewPdf, handler } })).toStrictEqual({ pdf: PREVIEW })
  })

  it("should report another handler's path", () => {
    const app = { bundleId: "com.adobe.Acrobat.Pro" }

    expect(toCheckRecord({ pdf: ACROBAT }, { pdf: { ...previewPdf, app } })).toStrictEqual({ pdf: PREVIEW })
  })

  it("should report a handler that isn't installed by its bundle ID", () => {
    const handler = { bundleId: "com.example.gone", path: undefined }

    expect(toCheckRecord({ pdf: PREVIEW }, { pdf: { ...previewPdf, handler } })).toStrictEqual({
      pdf: "com.example.gone",
    })
  })

  it("should leave out an extension nothing opens", () => {
    expect(toCheckRecord({ pdf: PREVIEW }, { pdf: { ...previewPdf, handler: undefined } })).toStrictEqual({})
  })

  it("should refuse an app that isn't installed", () => {
    const lookup = { ...previewPdf, app: undefined }

    expect(() => toCheckRecord({ pdf: ACROBAT }, { pdf: lookup })).toThrow(`'${ACROBAT}' isn't an installed app`)
  })

  it("should refuse an extension macOS has no type for", () => {
    const lookup = { ...previewPdf, contentType: "dyn.age81k652" }

    expect(() => toCheckRecord({ tsx: PREVIEW }, { tsx: lookup })).toThrow(
      "macOS has no content type for extension 'tsx', so nothing can be set for it",
    )
  })

  it("should refuse two apps for extensions that share a type", () => {
    const lookups = {
      jpg: { ...previewPdf, contentType: "public.jpeg" },
      jpeg: { ...previewPdf, contentType: "public.jpeg" },
    }

    expect(() => toCheckRecord({ jpg: PREVIEW, jpeg: ACROBAT }, lookups)).toThrow(
      `Extensions 'jpg' and 'jpeg' are the same type to macOS, 'public.jpeg', but are listed under different apps`,
    )
  })

  it("should allow one app for extensions that share a type", () => {
    const lookups = {
      jpg: { ...previewPdf, contentType: "public.jpeg" },
      jpeg: { ...previewPdf, contentType: "public.jpeg" },
    }

    expect(toCheckRecord({ jpg: PREVIEW, jpeg: PREVIEW }, lookups)).toStrictEqual({ jpg: PREVIEW, jpeg: PREVIEW })
  })
})
