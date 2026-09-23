<a href="https://github.com/twext/twext">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/whiteLogo.svg" />
    <img src="./assets/regularLogo.svg" height="40" alt="Twext project logo" />
  </picture>
</a>

# Twext

> A modular, zero-config Node.js toolchain for authoring, validating, and compiling multi-file TurboWarp extensions with YAML manifests

## Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [Highlights](#highlights)
- [Overview](#overview)
  - [Authors](#authors)
- [Usage](#usage)
- [Installation](#installation)
- [Editor setup](#editor-setup)
- [Feedback and Contributing](#feedback-and-contributing)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## Highlights

- Turn several JavaScript files into a TurboWarp extension. Made for larger projects that would need a multi-file structure.
- Declare your extension's metadata, block signatures, and arguments in a single `twext.yml` manifest
- Keep every block handler in its own ES module; `twext build` compiles them into one self-contained extension script
- Static analysis catches problems before you even run the extension — missing exports, unknown block types and argument types, and references to names that won't exist at runtime
- Zero config: `init` scaffolds a working project, `build` validates then compiles, `validate` checks blocks against your handlers
- Follow review decisions from TwextHub with `twext notifications`; `publish` and `yank` print an unread count if the hub has news for you

## Overview

TurboWarp extensions are written as a single JavaScript file: one script that registers a class with `getInfo()` block definitions and a method per opcode. Kept in one file, that gets hard to read once an extension has more than a few blocks.

Twext takes the other path. You keep the block definitions and metadata in a YAML manifest, and each block's logic in its own ES module.

Validation is not just schema checking. Twext parses each handler and the `setup` function and walks their free variables, so a handler that references an undeclared helper or a typo'd argument name is a build error, not a runtime mystery inside the extension.

### Authors

Twext is maintained by the [Twext Team](https://github.com/twext).

## Usage

Scaffold a new project:

```bash
twext init
```

This writes a minimal `twext.yml`, `src/index.js`, and a sample `src/blocks/hello.js`. From there, `build` validates and compiles:

```bash
twext build
# writes dist/extension.js
```

Check a project without building:

```bash
twext validate
```

Publish and manage a TwextHub hub from the CLI:

```bash
twext signup
twext login
twext whoami
twext publish
twext yank 1.0.0
twext token list
twext sessions list
twext logout
```

`signup` creates a new account. `login` signs in with your `@namespace` and password. Credentials live in `~/.twext/config.json` (mode `0600`) with `TWEXTHUB_URL`, `TWEXTHUB_TOKEN`, and `TWEXTHUB_NAMESPACE` as environment overrides for automation. The default hub is `https://twexts.sdisk.us/api/v1`; pass `-u` to point at another one. Hubs must be served over HTTPS, except loopback URLs (such as `http://localhost`) used in local development.

`publish` validates the project, then uploads the `twext.yml` document (minus the local `outputPath`) and the project's source files; the hub parses the manifest, compiles the extension itself, and stores everything for review. When the hub has Terms of Service that have not been accepted yet, `publish` accepts them automatically only when using a stored session token — mapping this command into CI with an automation token is deliberately left to you, so the terms gate can't be silently clicked through. `yank` removes a version. `logout` discards the stored credentials.

For CI, create a scoped token once:

```bash
twext token create --name ci --scope publish --scope yank
TWEXTHUB_TOKEN=twext_... twext publish
```

Review decisions on a `pending` publish land in the hub's notification mailbox. Check it with:

```bash
twext notifications              # unread only
twext notifications --all        # everything, read included
twext notifications --read       # mark the listed ones read
twext notifications --wait       # poll until this project's pending version is approved or rejected
```

`--wait` matches decisions against the local `twext.yml` (`extension.id` and `version`), exits `0` on approval, `1` on rejection, and `2` when `--wait-timeout` seconds (default 900) elapse without a decision. `publish` and `yank` print a one-line unread count when the hub has notifications for you; the line is suppressed for automation tokens and never fails the command.

Admins review the queue with `twext review list`, then approve or reject a pending version:

```bash
twext review list
twext review approve @acme/hello@1.2.0
twext review reject @acme/hello@1.2.0 --reason "Blocks are broken."
```

`reject` prompts for a reason when `--reason` is omitted. `search`, `info`, and `download` read from the registry without authentication; `download` fetches the compiled blob and defaults to the latest version:

```bash
twext search hello
twext info @acme/hello
twext download @acme/hello -o hello.js
twext stats
```

Automation tokens and sessions are managed with `twext token list|create|revoke` and `twext sessions list|revoke`; `logout` revokes the current session on the hub before forgetting the stored credentials. Most read commands (`whoami`, `search`, `info`, `download`, `stats`, `review`, `token`, `sessions`) print machine-readable output with `--json`, and `twext logout` still works when the hub is unreachable.

Point either command at a different manifest with `-c`; override the build output with `-o`.

## Installation

Install globally to use the `twext` command anywhere:

```bash
npm install -g @twext/twext
```

Or add it to a single project's dev dependencies:

```bash
npm install --save-dev @twext/twext
```

Then run it with `npx`:

```bash
npx twext init
```

Requires Node.js 24 or newer.

## Editor setup

VS Code autocompletes and validates `twext.yml` once you register its JSON schema. Install the [YAML extension](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml) (by Red Hat) and add this to your workspace:

```jsonc
// .vscode/settings.json
{
  "yaml.schemas": {
    "./node_modules/@twext/twext/schema/twext.json": ["twext.yml"],
  },
}
```

For extension files, use `import("@twext/twext/types/extension")` in a JSDoc comment and enable JavaScript checking:

```jsonc
// jsconfig.json
{
  "compilerOptions": {
    "checkJs": true,
    "noEmit": true,
  },
}
```

```js
// src/index.js
/** @type {import("@twext/twext/types/extension").Blocks} */
const hello = (args, util) => "Hello, world!";
export const blocks = { hello };
```

## Feedback and Contributing

Bug reports and feature requests go in [issues](https://github.com/twext/twext/issues); questions and ideas for the project are welcome in [discussions](https://github.com/twext/twext/discussions).

Contributions are welcome — open an issue first if the change is bigger than a typo fix.
