#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { loadProduct } from "./config.js";
import { createLogger } from "./log.js";
import { initCommand } from "./commands/init.js";
import { validateCommand } from "./commands/validate.js";
import { buildCommand } from "./commands/build.js";
import { loginCommand } from "./commands/login.js";
import { signupCommand } from "./commands/signup.js";
import { logoutCommand } from "./commands/logout.js";
import { publishCommand } from "./commands/publish.js";
import { yankCommand } from "./commands/yank.js";
import { tokenCommand } from "./commands/token.js";

const OPTIONS = {
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
  config: { type: "string", short: "c" },
  out: { type: "string", short: "o" },
  force: { type: "boolean", short: "f" },
  url: { type: "string", short: "u" },
  namespace: { type: "string", short: "n" },
  password: { type: "string" },
  "display-name": { type: "string" },
  token: { type: "string" },
  name: { type: "string" },
  scope: { type: "string", multiple: true },
  "expires-in-days": { type: "string" },
  visibility: { type: "string" },
};

function helpText(product) {
  return `${product.name} ${product.version} — ${product.tagline}

Usage: ${product.command} <command> [options]

Commands:
  build        Validate and compile the extension (default)
  validate     Check blocks against the entryPoint handlers
  init         Scaffold a new project in a directory
  login        Sign in to a TwextHub hub
  signup       Create a new account on a TwextHub hub
  logout       Forget the stored hub credentials
  publish      Validate, build, and publish to the hub
  yank         Remove a published version from the hub (e.g. twext yank 1.0.0)
  token        Create an automation token for CI (e.g. twext token create)
  help         Show this help

Options:
  -c, --config <file>      Path to ${product.defaults.configFilename} (default: ${product.defaults.configFilename})
  -o, --out <file>         Override the output path (build only)
  -f, --force              Overwrite existing files (init only)
  -u, --url <base>         Hub API base URL (default: https://twexts.sdisk.us/api/v1)
  -n, --namespace <name>   Account namespace (login/signup/publish/yank; login default: stored)
  --password <password>    Account password (login/signup; prompts when omitted)
  --display-name <name>    Account display name (signup only)
  --token <token>          Bearer token override (default: \\$TWEXTHUB_TOKEN, then stored)
  --name <name>            Token name (token create only)
  --scope <scope>          Token scope, repeatable (token create only; default: publish)
  --expires-in-days <days> Token lifetime (token create only)
  --visibility <level>    Registry visibility on publish (public, unlisted, private; default: public)
  -h, --help               Show this help
  -v, --version            Print the version`;
}

async function main(args) {
  const product = loadProduct();
  const log = createLogger(product);
  const { values, positionals } = parseArgs({ args, options: OPTIONS, allowPositionals: true });

  if (values.version) {
    console.log(`${product.name} ${product.version}`);
    return 0;
  }
  if (values.help) {
    console.log(helpText(product));
    return 0;
  }

  const command = positionals[0] ?? "build";
  const configPath = resolve(values.config ?? product.defaults.configFilename);
  switch (command) {
    case "help":
      console.log(helpText(product));
      return 0;
    case "init":
      return initCommand(product, positionals[1], values.force, log) ? 0 : 1;
    case "validate":
      return (await validateCommand(product, configPath, log)) ? 0 : 1;
    case "build":
      return (await buildCommand(product, configPath, values.out ? resolve(values.out) : null, log))
        ? 0
        : 1;
    case "login":
      return (await loginCommand(product, values, log)) ? 0 : 1;
    case "signup":
      return (await signupCommand(product, values, log)) ? 0 : 1;
    case "logout":
      return logoutCommand(product, log) ? 0 : 1;
    case "publish":
      return (await publishCommand(product, configPath, values, log)) ? 0 : 1;
    case "yank":
      return (await yankCommand(product, positionals[1], configPath, values, log)) ? 0 : 1;
    case "token":
      return (await tokenCommand(product, positionals[1], values, log)) ? 0 : 1;
    default:
      log.error(`Unknown command "${command}"`);
      console.log(helpText(product));
      return 1;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    const log = createLogger(loadProduct());
    log.error(err.message ?? String(err));
    process.exitCode = 1;
  });
