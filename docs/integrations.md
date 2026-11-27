# Integrations

An integration is a set of functions that take `h` and call steps to set up one specific program, service, or piece of config. tsinfra ships them as imports, one export path for each, so a script imports only the integrations it uses:

```ts
import { fileHandlers } from "tsinfra/integrations/macos/file-handlers"
```

<!-- toc -->

- [How integrations work](#how-integrations-work)
- [macOS file handlers](#macos-file-handlers)
  - [Extensions and types](#extensions-and-types)
  - [Choosing extensions from an app](#choosing-extensions-from-an-app)

<!-- tocstop -->

## How integrations work

- **An integration is ordinary script code.** It takes `h` and calls steps on it, the same steps a script calls, so it shows in the report as those steps. A script can write its own the same way (see [Steps](./steps.md#run)).
- **Each one has its own export path** under `tsinfra/integrations/`, named for what it sets up, like `tsinfra/integrations/macos/file-handlers`. An export path can hold helpers that go with its integration, like a function that reads what an app supports.
- **An integration that works on one platform checks the host first,** with [`h.facts.platform`](./steps.md#facts), and throws when the host is on another, like `The 'fileHandlers' integration needs a 'darwin' host, but this host is 'linux'`. So `plan` and `apply` both stop the host script there, before the integration's steps.
- **A mistake in what a script passes throws,** like an extension listed under two apps. It fails the host the way any error in a host script does (see [Steps](./steps.md#failure)).
- **An integration with a fixed step name can be called once per host,** because a change step's name must be unique in a host script (see [Steps](./steps.md#steps)).

The integrations that might ship next are in [the roadmap](./roadmap.md#integration-ideas).

## macOS file handlers

`tsinfra/integrations/macos/file-handlers` sets which app opens each file extension on a Mac. It checks that the host is a Mac, then runs one `ensure` step, named `File handlers`.

```ts
import { fileHandlers } from "tsinfra/integrations/macos/file-handlers"

await fileHandlers(
  h,
  {
    "/Applications/Keka.app": ["zip", "7z", "rar"],
    "/System/Applications/Preview.app": ["pdf"],
  },
  { needs: [brew] },
)
```

- **Give the path to the app**, then its extensions without dots.
- **Pass the step that installs the apps as `needs`.** On a fresh Mac the plan then waits for it (see [Waiting on earlier steps](./needs.md)). Without `needs`, the plan fails on an app that isn't installed yet.
- **List only what another app would open.** An app usually gets a type by itself when no other app claims it.
- **macOS asks before each change.** Apply sends every change at once, then waits up to 5 minutes for you to agree in macOS's prompts. Nothing can agree for you. One prompt can cover more than one extension. The step fails and lists what's left when time runs out, and also when you choose to keep the current app.
- **The plan fails** when an app isn't installed, an extension is listed under two apps, or macOS doesn't know the extension.
- **It goes through the Launch Services API, not the `LSHandlers` plist.** macOS keeps handlers in memory and overwrites edits to the plist, so an edit there looks set until macOS next saves, then vanishes.

### Extensions and types

macOS gives each extension one content type, and an app opens types. So listing an extension sets the app for its type.

- **Extensions that share a type move together.** `jpg` and `jpeg` are the same type, so they can't be listed under different apps.
- **macOS goes by the extension, not by what's inside the file.** A TypeScript file and an MPEG video can both end in `ts`, and both open in the app you list `ts` under.
- **An app can define an extension's type**, so the type can change when you install another app. That shows as drift, and the next apply sets the new type.
- **An extension no app or macOS defines can't be set**, like `tsx`.
- **Folders can't be set**, because macOS only lets Finder handle them. Setting the `NSFileViewer` default sends Reveal in Finder to another app, but folders opened from the Desktop or the Dock still open in Finder.
- **An app set for a single file in Finder's Get Info still wins** for that file.

### Choosing extensions from an app

An app lists what it opens in its `Info.plist`. Two helpers read it, for a script that sets an app for everything of one kind instead of listing extensions by hand:

```ts
import { fileHandlers, readInfoPlist, readKnownExtensions } from "tsinfra/integrations/macos/file-handlers"

const documentTypes = await readInfoPlist(h, "/Applications/Keka.app", "CFBundleDocumentTypes")
const listed = documentTypes === undefined ? [] : toKekaExtensions(documentTypes)

await fileHandlers(h, { "/Applications/Keka.app": await readKnownExtensions(h, listed) }, { needs: [brew] })
```

- **`readInfoPlist(h, appPath, key)`** returns a key of the app's `Info.plist`, or `undefined` when there's no app at the path, like before the step that installs it. It throws when the app doesn't have the key. The value is `unknown`, so validate it before you use it.
- **`readKnownExtensions(h, extensions)`** returns the ones macOS has a content type for. An app can list an extension that nothing defines, and `fileHandlers` refuses those.
- **No one rule finds what an app opens.** Some apps rank types they only view as their default, so read the key that fits the app, like `UTImportedTypeDeclarations` or `CFBundleDocumentTypes`, and filter it in your own function, like `toKekaExtensions` here.
- **Both read the host straight away,** like `h.read`. So on a fresh Mac, an app that isn't installed yet gives no extensions in `plan`, and the step installs nothing for it until the next apply.
