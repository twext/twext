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
import { sessionsCommand } from "./commands/sessions.js";
import { whoamiCommand } from "./commands/whoami.js";
import { searchCommand } from "./commands/search.js";
import { infoCommand } from "./commands/info.js";
import { downloadCommand } from "./commands/download.js";
import { statsCommand } from "./commands/stats.js";
import { reviewCommand } from "./commands/review.js";
import { notificationsCommand } from "./commands/notifications.js";

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
  all: { type: "boolean" },
  json: { type: "boolean" },
  read: { type: "boolean" },
  wait: { type: "boolean" },
  "wait-timeout": { type: "string" },
  limit: { type: "string" },
  reason: { type: "string" },
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
  logout       Revoke the session and forget the stored hub credentials
  whoami       Show the signed-in account
  publish      Validate, build, and publish to the hub
  yank         Remove a published version from the hub (e.g. twext yank 1.0.0)
  token        Manage automation tokens (create, list, revoke)
  sessions     List and revoke sessions
  search       Search the registry (e.g. twext search "hello world")
  info         Show an extension's registry detail (e.g. twext info @ns/id)
  download     Download a compiled extension (e.g. twext download @ns/id@1.0.0)
  stats        Show registry statistics
  review       Admin review queue (list, approve, reject)
  notifications  Show hub notifications (e.g. review decisions)
  help         Show this help

Options:
  -c, --config <file>      Path to ${product.defaults.configFilename} (default: ${product.defaults.configFilename})
  -o, --out <file>         Override the output path (build/download)
  -f, --force              Overwrite existing files (init only)
  -u, --url <base>         Hub API base URL (default: https://twexts.sdisk.us/api/v1)
  -n, --namespace <name>   Account namespace (login/signup/publish/yank; login default: stored)
  --password <password>    Account password (login/signup; prompts when omitted)
  --display-name <name>    Account display name (signup only)
  --token <token>          Bearer token override (default: \\$TWEXTHUB_TOKEN, then stored)
  --name <name>            Token name (token create only)
  --scope <scope>          Token scope, repeatable (token create only; default: publish)
  --expires-in-days <days> Token lifetime (token create only)
  --visibility <level>      Registry visibility on publish (public, unlisted, private; default: public)
  --limit <n>               Page size (search/review list only; default: 20)
  --reason <text>           Rejection reason (review reject only)
  --all                     Include read notifications (notifications only)
  --json                    Print raw API JSON (search/info/stats/whoami/token/sessions/review/notifications)
  --read                    Mark the listed notifications read (notifications only)
  --wait                    Poll until the pending version has a review decision (notifications only)
  --wait-timeout <seconds>  --wait timeout (notifications only; default 900)
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
      return (await logoutCommand(product, values, log)) ? 0 : 1;
    case "whoami":
      return (await whoamiCommand(product, values, log)) ? 0 : 1;
    case "publish":
      return (await publishCommand(product, configPath, values, log)) ? 0 : 1;
    case "yank":
      return (await yankCommand(product, positionals[1], configPath, values, log)) ? 0 : 1;
    case "token":
      return (await tokenCommand(product, positionals[1], positionals[2], values, log)) ? 0 : 1;
    case "sessions":
      return (await sessionsCommand(product, positionals[1], positionals[2], values, log)) ? 0 : 1;
    case "search":
      return (await searchCommand(product, positionals[1], values, log)) ? 0 : 1;
    case "info":
      return (await infoCommand(product, positionals[1], values, log)) ? 0 : 1;
    case "download":
      return (await downloadCommand(product, positionals[1], values, log)) ? 0 : 1;
    case "stats":
      return (await statsCommand(product, values, log)) ? 0 : 1;
    case "review":
      return (await reviewCommand(product, positionals[1], positionals[2], values, log)) ? 0 : 1;
    case "notifications": {
      // Returns 0 (listed/approved), 1 (rejected or error), 2 (--wait timeout).
      const code = await notificationsCommand(product, configPath, values, log);
      return typeof code === "number" ? code : code ? 0 : 1;
    }
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
