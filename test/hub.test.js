import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`../test-fixtures/${name}`, import.meta.url));

function runCli(args, { env, cwd, timeout = 15000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: cwd ?? process.cwd(),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function createHub(routes) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    const request = {
      method: req.method,
      path: req.url.split("?")[0],
      authorization: req.headers.authorization ?? null,
      body: raw ? JSON.parse(raw) : null,
    };
    requests.push(request);
    const route = routes.find((r) => r.method === request.method && r.path === request.path);
    const reply =
      typeof route?.reply === "function"
        ? route.reply(request)
        : (route?.reply ?? { status: 404, body: { title: "Not Found" } });
    res.writeHead(reply.status, { "content-type": "application/json" });
    res.end(JSON.stringify(reply.body));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        requests,
        close: () => new Promise((res) => server.close(res)),
      });
    });
  });
}

const termsProblem = {
  status: 403,
  body: { detail: "The current Terms of Service have not been accepted yet." },
};

function tmpHome() {
  const dir = mkdtempSync(join(tmpdir(), "twext-home-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("login stores credentials and publish auto-accepts terms with a session token", async () => {
  const { dir, cleanup } = tmpHome();
  let publishAttempts = 0;
  const hub = await createHub([
    {
      method: "POST",
      path: "/auth/login",
      reply: { status: 200, body: { token: "sess-1", user: { namespace: "acme", role: "user" } } },
    },
    { method: "POST", path: "/terms/accept", reply: { status: 200, body: { status: "accepted" } } },
    {
      method: "POST",
      path: "/@acme/superutilities/versions",
      reply: (request) => {
        if (request.authorization !== "Bearer sess-1") return termsProblem;
        if (++publishAttempts === 1) return termsProblem;
        return {
          status: 200,
          body: {
            id: "superutilities",
            version: "1.0.0",
            status: "published",
            dist: { downloadUrl: "https://hub.test/x.js" },
          },
        };
      },
    },
  ]);
  try {
    const login = await runCli(
      ["login", "--url", hub.url, "--namespace", "acme", "--password", "pw"],
      { env: { HOME: dir } },
    );
    assert.equal(login.code, 0, login.stderr);
    assert.match(login.stdout, /Logged in as acme/);

    const config = JSON.parse(readFileSync(join(dir, ".twext", "config.json"), "utf8"));
    assert.deepEqual(config, { hub: hub.url, namespace: "acme", token: "sess-1" });

    const loginRequestsBeforePublish = hub.requests.filter((r) => r.path === "/auth/login").length;

    const publish = await runCli(
      ["publish", "--config", fixture("basic/twext.yml"), "--url", hub.url],
      { env: { HOME: dir } },
    );
    assert.equal(publish.code, 0, publish.stderr);
    assert.match(publish.stdout, /Published superutilities@1\.0\.0/);
    assert.equal(
      hub.requests.filter((r) => r.path === "/auth/login").length,
      loginRequestsBeforePublish,
      "no new login on publish",
    );
    assert.equal(
      hub.requests.filter((r) => r.path === "/terms/accept").length,
      1,
      "terms accepted once",
    );
    const publishes = hub.requests.filter((r) => r.path === "/@acme/superutilities/versions");
    assert.equal(publishes.length, 2, "re-published after accepting terms");
    assert.equal(publishes[0].authorization, "Bearer sess-1");
    assert.equal(publishes[1].authorization, "Bearer sess-1");
    assert.equal(publishes[1].body.code, undefined, "the hub compiles; no prebuilt code is sent");
    const manifest = parseYaml(publishes[1].body.manifest);
    assert.equal(manifest.extension.id, "superutilities");
    assert.equal(manifest.version, "1.0.0");
    assert.equal(manifest.entryPoint, "src/index.js");
    assert.ok(!("outputPath" in manifest), "the local build path is stripped");
    assert.ok(publishes[1].body.sources["src/index.js"], "project sources are uploaded");
    assert.match(publishes[1].body.sources["src/index.js"], /Super Utilities|logMessage|import/);
    assert.equal(typeof publishes[1].body.twext, "string", "CLI version is reported");
  } finally {
    cleanup();
    await hub.close();
  }
});

test("login reports rejected credentials without signing up", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "POST",
      path: "/auth/login",
      reply: { status: 401, body: { detail: "Invalid namespace or password" } },
    },
  ]);
  try {
    const result = await runCli(
      ["login", "--url", hub.url, "--namespace", "newbie", "--password", "pw"],
      { env: { HOME: dir } },
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Invalid namespace or password/);
    assert.match(result.stdout, /Run twext signup/);
    assert.equal(
      hub.requests.filter((r) => r.path === "/auth/signup").length,
      0,
      "never signs up implicitly",
    );
    assert.ok(!existsSync(join(dir, ".twext", "config.json")));
  } finally {
    cleanup();
    await hub.close();
  }
});

test("stored credentials are only used for the hub they were saved for", () => {
  const { dir, cleanup } = tmpHome();
  try {
    const cfgDir = join(dir, ".twext");
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({ hub: "https://a.test/v0", namespace: "acme", token: "tok-a" }),
    );
    const hubModule = fileURLToPath(new URL("../src/hub.js", import.meta.url));
    const script = `import { resolveToken, resolveNamespace } from ${JSON.stringify(hubModule)};
      console.log([
        resolveToken(undefined, "https://a.test/v0", {}),
        resolveNamespace(undefined, "https://a.test/v0", {}),
        resolveToken(undefined, "https://b.test/v0", {}),
        resolveNamespace(undefined, "https://b.test/v0", {}),
      ].join("|"));`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, HOME: dir },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "tok-a|acme||");
  } finally {
    cleanup();
  }
});

test("hub URLs are canonicalized before they are stored or compared", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "POST",
      path: "/auth/login",
      reply: { status: 200, body: { token: "sess-1", user: { namespace: "acme", role: "user" } } },
    },
  ]);
  try {
    const login = await runCli(
      ["login", "--url", `${hub.url}/`, "--namespace", "acme", "--password", "pw"],
      { env: { HOME: dir } },
    );
    assert.equal(login.code, 0, login.stderr);
    const config = JSON.parse(readFileSync(join(dir, ".twext", "config.json"), "utf8"));
    assert.equal(config.hub, hub.url, "trailing slash is stripped before storing");
    const hubModule = fileURLToPath(new URL("../src/hub.js", import.meta.url));
    const script = `import { resolveHubUrl, resolveToken, resolveNamespace } from ${JSON.stringify(hubModule)};
      console.log([
        resolveHubUrl("${hub.url}/", {}),
        resolveToken(undefined, "${hub.url}", {}),
        resolveNamespace(undefined, "${hub.url}", {}),
      ].join("|"));`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, HOME: dir },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), `${hub.url}|sess-1|acme`);
  } finally {
    cleanup();
    await hub.close();
  }
});

test("stored hub URLs with trailing slashes still match canonical lookups", () => {
  const { dir, cleanup } = tmpHome();
  try {
    const cfgDir = join(dir, ".twext");
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(
      join(cfgDir, "config.json"),
      JSON.stringify({ hub: "https://a.test/v0/", namespace: "acme", token: "tok-a" }),
    );
    const hubModule = fileURLToPath(new URL("../src/hub.js", import.meta.url));
    const script = `import { resolveToken, resolveNamespace } from ${JSON.stringify(hubModule)};
      console.log([
        resolveToken(undefined, "https://a.test/v0", {}),
        resolveNamespace(undefined, "https://a.test/v0", {}),
      ].join("|"));`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, HOME: dir },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "tok-a|acme");
  } finally {
    cleanup();
  }
});

test("hub URLs must be HTTPS or loopback", async () => {
  const { dir, cleanup } = tmpHome();
  try {
    const result = await runCli(
      ["login", "--url", "http://example.com", "--namespace", "acme", "--password", "pw"],
      { env: { HOME: dir } },
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Refusing to send credentials/);
  } finally {
    cleanup();
  }
});

test("hub requests reject redirects so password bodies are never replayed", async () => {
  const { dir, cleanup } = tmpHome();
  let replayed = false;
  const target = createServer((req, res) => {
    replayed = true;
    res.writeHead(404, { "content-type": "application/json" });
    res.end("{}");
  });
  let targetPort;
  const source = createServer((req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${targetPort}/auth/login` });
    res.end();
  });
  await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
  targetPort = target.address().port;
  await new Promise((resolve) => source.listen(0, "127.0.0.1", resolve));
  try {
    const result = await runCli(
      [
        "login",
        "--url",
        `http://127.0.0.1:${source.address().port}`,
        "--namespace",
        "acme",
        "--password",
        "pw",
      ],
      { env: { HOME: dir } },
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Could not reach the hub/);
    assert.equal(replayed, false, "redirect target must never receive the request");
    assert.ok(!existsSync(join(dir, ".twext", "config.json")));
  } finally {
    cleanup();
    await new Promise((resolve) => target.close(resolve));
    await new Promise((resolve) => source.close(resolve));
  }
});

test("login tightens permissions on an existing config file", async () => {
  const { dir, cleanup } = tmpHome();
  const cfgDir = join(dir, ".twext");
  const cfgFile = join(cfgDir, "config.json");
  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(cfgFile, "{}\n");
  chmodSync(cfgFile, 0o644);
  const hub = await createHub([
    {
      method: "POST",
      path: "/auth/login",
      reply: {
        status: 200,
        body: { token: "sess-1", user: { namespace: "acme", role: "normal" } },
      },
    },
  ]);
  try {
    const result = await runCli(
      ["login", "--url", hub.url, "--namespace", "acme", "--password", "pw"],
      { env: { HOME: dir } },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(statSync(cfgFile).mode & 0o777, 0o600);
  } finally {
    cleanup();
    await hub.close();
  }
});

test("signup creates an account and stores the session", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "POST",
      path: "/auth/signup",
      reply: {
        status: 201,
        body: { token: "sess-3", user: { namespace: "alice", role: "normal" } },
      },
    },
  ]);
  try {
    const result = await runCli(
      [
        "signup",
        "--url",
        hub.url,
        "--namespace",
        "alice",
        "--password",
        "longpass",
        "--display-name",
        "Alice",
      ],
      { env: { HOME: dir } },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Signed up as alice/);
    const config = JSON.parse(readFileSync(join(dir, ".twext", "config.json"), "utf8"));
    assert.deepEqual(config, { hub: hub.url, namespace: "alice", token: "sess-3" });
    const request = hub.requests.find((r) => r.path === "/auth/signup");
    assert.deepEqual(request.body, {
      namespace: "alice",
      password: "longpass",
      displayName: "Alice",
    });
  } finally {
    cleanup();
    await hub.close();
  }
});

test("signup omits displayName and flags admin accounts", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "POST",
      path: "/auth/signup",
      reply: {
        status: 201,
        body: { token: "sess-4", user: { namespace: "root", role: "admin" } },
      },
    },
  ]);
  try {
    const result = await runCli(
      ["signup", "--url", hub.url, "--namespace", "root", "--password", "longpass"],
      { env: { HOME: dir } },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /admin/);
    const request = hub.requests.find((r) => r.path === "/auth/signup");
    assert.deepEqual(request.body, { namespace: "root", password: "longpass" });
  } finally {
    cleanup();
    await hub.close();
  }
});

test("signup reports a taken namespace without storing credentials", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "POST",
      path: "/auth/signup",
      reply: { status: 409, body: { detail: "That namespace is already taken." } },
    },
  ]);
  try {
    const result = await runCli(
      ["signup", "--url", hub.url, "--namespace", "taken", "--password", "longpass"],
      { env: { HOME: dir } },
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /already taken/);
    assert.ok(!existsSync(join(dir, ".twext", "config.json")));
  } finally {
    cleanup();
    await hub.close();
  }
});

test("login fails on a malformed response without storing credentials", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "POST",
      path: "/auth/login",
      reply: { status: 200, body: { ok: true } },
    },
  ]);
  try {
    const result = await runCli(
      ["login", "--url", hub.url, "--namespace", "acme", "--password", "pw"],
      { env: { HOME: dir } },
    );
    assert.equal(result.code, 1, result.stderr);
    assert.match(result.stderr, /invalid login response/i);
    assert.ok(!existsSync(join(dir, ".twext", "config.json")));
  } finally {
    cleanup();
    await hub.close();
  }
});

test("signup fails on a malformed response without storing credentials", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "POST",
      path: "/auth/signup",
      reply: { status: 201, body: { token: "sess-4" } },
    },
  ]);
  try {
    const result = await runCli(
      ["signup", "--url", hub.url, "--namespace", "alice", "--password", "longpass"],
      { env: { HOME: dir } },
    );
    assert.equal(result.code, 1, result.stderr);
    assert.match(result.stderr, /invalid signup response/i);
    assert.ok(!existsSync(join(dir, ".twext", "config.json")));
  } finally {
    cleanup();
    await hub.close();
  }
});

test("login and signup treat an empty successful body as an invalid response", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    { method: "POST", path: "/auth/login", reply: { status: 200 } },
    { method: "POST", path: "/auth/signup", reply: { status: 201 } },
  ]);
  try {
    const login = await runCli(
      ["login", "--url", hub.url, "--namespace", "acme", "--password", "pw"],
      { env: { HOME: dir } },
    );
    assert.equal(login.code, 1, login.stderr);
    assert.match(login.stderr, /invalid login response/i);

    const signup = await runCli(
      ["signup", "--url", hub.url, "--namespace", "alice", "--password", "longpass"],
      { env: { HOME: dir } },
    );
    assert.equal(signup.code, 1, signup.stderr);
    assert.match(signup.stderr, /invalid signup response/i);
    assert.ok(!existsSync(join(dir, ".twext", "config.json")));
  } finally {
    cleanup();
    await hub.close();
  }
});

test("resolveHubUrl falls back to the public hub", () => {
  const { dir, cleanup } = tmpHome();
  try {
    const hubModule = fileURLToPath(new URL("../src/hub.js", import.meta.url));
    const script = `import { resolveHubUrl } from ${JSON.stringify(hubModule)};
      console.log([
        resolveHubUrl(undefined, {}),
        resolveHubUrl(undefined, { TWEXTHUB_URL: "https://example.com/v0" }),
        resolveHubUrl("https://custom.test", {}),
      ].join(" "));`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, HOME: dir },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout.trim(),
      "https://twexts.sdisk.us/api/v1 https://example.com/v0 https://custom.test",
    );
  } finally {
    cleanup();
  }
});

test("logout forgets the stored credentials", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "POST",
      path: "/auth/login",
      reply: { status: 200, body: { token: "sess-1", user: { namespace: "acme", role: "user" } } },
    },
  ]);
  try {
    await runCli(["login", "--url", hub.url, "--namespace", "acme", "--password", "pw"], {
      env: { HOME: dir },
    });
    assert.ok(existsSync(join(dir, ".twext", "config.json")));
    const logout = await runCli(["logout"], { env: { HOME: dir } });
    assert.equal(logout.code, 0, logout.stderr);
    assert.match(logout.stdout, /Logged out/);
    assert.ok(!existsSync(join(dir, ".twext", "config.json")));
  } finally {
    cleanup();
    await hub.close();
  }
});

test("publish fails when terms gate blocks an automation token", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "POST",
      path: "/@acme/superutilities/versions",
      reply: {
        status: 403,
        body: {
          detail: "The current Terms of Service have not been accepted yet.",
          title: "Terms of Service not accepted",
        },
      },
    },
  ]);
  try {
    const result = await runCli(
      ["publish", "--config", fixture("basic/twext.yml"), "--url", hub.url],
      {
        env: { HOME: dir, TWEXTHUB_NAMESPACE: "acme", TWEXTHUB_TOKEN: "auto-tok" },
      },
    );
    assert.equal(result.code, 1);
    assert.match(
      result.stderr,
      /Accept the terms with a session \(twext login\) before publishing again/,
    );
    assert.equal(
      hub.requests.filter((r) => r.path === "/terms/accept").length,
      0,
      "never accepts terms with an automation token",
    );
  } finally {
    cleanup();
    await hub.close();
  }
});

test("yank sends a DELETE for the published version", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "DELETE",
      path: "/@acme/superutilities/versions/1.0.0",
      reply: { status: 200, body: { ok: true } },
    },
  ]);
  try {
    const result = await runCli(
      ["yank", "1.0.0", "--config", fixture("basic/twext.yml"), "--url", hub.url],
      {
        env: { HOME: dir, TWEXTHUB_NAMESPACE: "acme", TWEXTHUB_TOKEN: "auto-tok" },
      },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Yanked superutilities@1\.0\.0/);
    const yank = hub.requests.find((r) => r.method === "DELETE");
    assert.ok(yank, "DELETE request sent");
    assert.equal(yank.authorization, "Bearer auto-tok");
  } finally {
    cleanup();
    await hub.close();
  }
});

test("yank refuses an extension.id that is not a safe path segment", async () => {
  const { dir, cleanup } = tmpHome();
  const configPath = join(dir, "twext.yml");
  writeFileSync(configPath, "extension:\n  id: foo/bar\n", "utf8");
  try {
    const result = await runCli(
      ["yank", "1.0.0", "--config", configPath, "--url", "https://hub.test"],
      {
        env: { HOME: dir, TWEXTHUB_NAMESPACE: "acme", TWEXTHUB_TOKEN: "auto-tok" },
      },
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /extension\.id "foo\/bar" is invalid/);
  } finally {
    cleanup();
  }
});

test("token create sends scopes and prints the token once", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "POST",
      path: "/tokens",
      reply: { status: 200, body: { name: "CI", scopes: ["publish", "yank"], token: "at-456" } },
    },
  ]);
  try {
    const result = await runCli(
      [
        "token",
        "create",
        "--name",
        "CI",
        "--scope",
        "publish",
        "--scope",
        "yank",
        "--expires-in-days",
        "30",
        "--url",
        hub.url,
      ],
      {
        env: { HOME: dir, TWEXTHUB_TOKEN: "sess-1" },
      },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Created token "CI" with scope publish, yank/);
    assert.match(result.stdout, /at-456/);
    const request = hub.requests.find((r) => r.path === "/tokens");
    assert.deepEqual(request.body, { name: "CI", scopes: ["publish", "yank"], expiresInDays: 30 });
  } finally {
    cleanup();
    await hub.close();
  }
});

test("whoami prints the signed-in account and honors --json", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "GET",
      path: "/auth/me",
      reply: {
        status: 200,
        body: {
          namespace: "acme",
          displayName: "Acme Co",
          role: "admin",
          hasPublished: true,
          createdAt: "2025-01-02T00:00:00.000Z",
        },
      },
    },
  ]);
  try {
    const text = await runCli(["whoami", "--url", hub.url], {
      env: { HOME: dir, TWEXTHUB_TOKEN: "sess-1" },
    });
    assert.equal(text.code, 0, text.stderr);
    assert.match(text.stdout, /@acme \(Acme Co\)/);
    assert.match(text.stdout, /admin/);

    const json = await runCli(["whoami", "--url", hub.url, "--json"], {
      env: { HOME: dir, TWEXTHUB_TOKEN: "sess-1" },
    });
    assert.equal(JSON.parse(json.stdout).namespace, "acme");

    const denied = await runCli(["whoami", "--url", hub.url], { env: { HOME: dir } });
    assert.equal(denied.code, 1);
    assert.match(denied.stderr, /Not logged in/);
  } finally {
    cleanup();
    await hub.close();
  }
});

test("logout revokes the session on the hub before forgetting credentials", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "POST",
      path: "/auth/logout",
      reply: { status: 204, body: null },
    },
  ]);
  try {
    mkdirSync(join(dir, ".twext"), { recursive: true });
    writeFileSync(
      join(dir, ".twext", "config.json"),
      JSON.stringify({ hub: hub.url, namespace: "acme", token: "sess-1" }),
      { mode: 0o600 },
    );
    const logout = await runCli(["logout"], { env: { HOME: dir } });
    assert.equal(logout.code, 0, logout.stderr);
    assert.match(logout.stdout, /revoked the session/);
    assert.ok(!existsSync(join(dir, ".twext", "config.json")));
    const revoke = hub.requests.find((r) => r.path === "/auth/logout");
    assert.ok(revoke, "logout endpoint hit");
    assert.equal(revoke.authorization, "Bearer sess-1");
  } finally {
    cleanup();
    await hub.close();
  }
});

test("logout still succeeds when the hub cannot be reached", async () => {
  const { dir, cleanup } = tmpHome();
  mkdirSync(join(dir, ".twext"), { recursive: true });
  writeFileSync(
    join(dir, ".twext", "config.json"),
    JSON.stringify({ hub: "https://hub.missing.test", namespace: "acme", token: "sess-1" }),
    { mode: 0o600 },
  );
  try {
    const logout = await runCli(["logout"], { env: { HOME: dir } });
    assert.equal(logout.code, 0, logout.stderr);
    assert.ok(!existsSync(join(dir, ".twext", "config.json")));
  } finally {
    cleanup();
  }
});

test("token list and revoke manage automation tokens", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "GET",
      path: "/tokens",
      reply: {
        status: 200,
        body: {
          data: [
            {
              id: "3",
              name: "ci",
              scopes: ["publish"],
              createdAt: "2025-01-02T00:00:00.000Z",
              lastUsedAt: null,
            },
          ],
          pagination: { nextCursor: null, hasMore: false },
        },
      },
    },
    { method: "DELETE", path: "/tokens/9", reply: { status: 204, body: null } },
  ]);
  try {
    const list = await runCli(["token", "list", "--url", hub.url], {
      env: { HOME: dir, TWEXTHUB_TOKEN: "sess-1" },
    });
    assert.equal(list.code, 0, list.stderr);
    assert.match(list.stdout, /ci/);

    const revoked = await runCli(["token", "revoke", "9", "--url", hub.url], {
      env: { HOME: dir, TWEXTHUB_TOKEN: "sess-1" },
    });
    assert.equal(revoked.code, 0, revoked.stderr);
    assert.match(revoked.stdout, /Revoked token 9/);
    const del = hub.requests.find((r) => r.path === "/tokens/9");
    assert.equal(del.authorization, "Bearer sess-1");
  } finally {
    cleanup();
    await hub.close();
  }
});

test("sessions list and revoke manage sessions", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "GET",
      path: "/sessions",
      reply: {
        status: 200,
        body: {
          data: [
            {
              id: "2",
              createdAt: "2025-01-02T00:00:00.000Z",
              expiresAt: "2026-01-02T00:00:00.000Z",
              lastUsedAt: "2025-01-03T00:00:00.000Z",
            },
          ],
          pagination: { nextCursor: null, hasMore: false },
        },
      },
    },
    { method: "DELETE", path: "/sessions/5", reply: { status: 204, body: null } },
  ]);
  try {
    const list = await runCli(["sessions", "list", "--url", hub.url], {
      env: { HOME: dir, TWEXTHUB_TOKEN: "sess-1" },
    });
    assert.equal(list.code, 0, list.stderr);

    const revoked = await runCli(["sessions", "revoke", "5", "--url", hub.url], {
      env: { HOME: dir, TWEXTHUB_TOKEN: "sess-1" },
    });
    assert.equal(revoked.code, 0, revoked.stderr);
    assert.match(revoked.stdout, /Revoked session 5/);
    assert.ok(
      hub.requests.find((r) => r.path === "/sessions/5"),
      "DELETE /sessions/5 sent",
    );
  } finally {
    cleanup();
    await hub.close();
  }
});

test("search prints results and honors --json", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "GET",
      path: "/search",
      reply: {
        status: 200,
        body: {
          data: [
            {
              namespace: "acme",
              id: "hello",
              name: "Hello",
              version: "1.0.0",
              description: "Greets everyone",
              visibility: "public",
              publishedAt: "2025-01-02T00:00:00.000Z",
            },
          ],
          pagination: { nextCursor: null, hasMore: false },
        },
      },
    },
  ]);
  try {
    const text = await runCli(["search", "hello", "--url", hub.url], { env: { HOME: dir } });
    assert.equal(text.code, 0, text.stderr);
    assert.match(text.stdout, /@acme\/hello@1\.0\.0/);

    const json = await runCli(["search", "hello", "--url", hub.url, "--json"], {
      env: { HOME: dir },
    });
    const parsed = JSON.parse(json.stdout);
    assert.equal(parsed.data[0].id, "hello");
  } finally {
    cleanup();
    await hub.close();
  }
});

test("info shows an extension's registry detail", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "GET",
      path: "/@acme/hello",
      reply: {
        status: 200,
        body: {
          namespace: "acme",
          id: "hello",
          name: "Hello",
          version: "1.0.0",
          description: "Greets everyone",
          license: "MIT",
          author: "Acme",
          color1: "#0094FF",
          visibility: "public",
          publishedAt: "2025-01-02T00:00:00.000Z",
          versions: [
            { version: "1.0.0", status: "published", publishedAt: "2025-01-02T00:00:00.000Z" },
          ],
        },
      },
    },
  ]);
  try {
    const result = await runCli(["info", "@acme/hello", "--url", hub.url], { env: { HOME: dir } });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /@acme\/hello/);
    assert.match(result.stdout, /Greets everyone/);
    assert.match(result.stdout, /MIT/);
  } finally {
    cleanup();
    await hub.close();
  }
});

test("download saves the compiled blob and resolves the latest version", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "GET",
      path: "/@acme/hello",
      reply: { status: 200, body: { namespace: "acme", id: "hello", version: "1.0.0" } },
    },
    {
      method: "GET",
      path: "/@acme/hello/versions/1.0.0/download",
      reply: { status: 200, body: { code: "console.log('DOWNLOAD_OK');" } },
    },
  ]);
  try {
    const out = join(dir, "hello.js");
    const result = await runCli(["download", "@acme/hello", "-o", out, "--url", hub.url], {
      env: { HOME: dir },
    });
    assert.equal(result.code, 0, result.stderr);
    const saved = readFileSync(out, "utf8");
    assert.match(saved, /DOWNLOAD_OK/);
    assert.ok(hub.requests.find((r) => r.path === "/@acme/hello/versions/1.0.0/download"));
  } finally {
    cleanup();
    await hub.close();
  }
});

test("stats prints aggregate registry numbers", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "GET",
      path: "/stats",
      reply: { status: 200, body: { published: 42, pending: 3, authors: 9 } },
    },
  ]);
  try {
    const result = await runCli(["stats", "--url", hub.url], { env: { HOME: dir } });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /42 published/);
    assert.match(result.stdout, /3 pending/);
  } finally {
    cleanup();
    await hub.close();
  }
});

test("review lists the queue and approves a pending version", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "GET",
      path: "/versions",
      reply: {
        status: 200,
        body: {
          data: [
            {
              ownerNamespace: "acme",
              id: "hello",
              name: "Hello",
              version: "1.2.0",
              description: "d",
              twextVersion: "1.0.0",
              createdAt: "2025-01-02T00:00:00.000Z",
            },
          ],
          pagination: { nextCursor: null, hasMore: false },
        },
      },
    },
    {
      method: "PATCH",
      path: "/@acme/hello/versions/1.2.0",
      reply: {
        status: 200,
        body: { namespace: "acme", id: "hello", version: "1.2.0", status: "published" },
      },
    },
  ]);
  try {
    const list = await runCli(["review", "list", "--url", hub.url], {
      env: { HOME: dir, TWEXTHUB_TOKEN: "sess-1" },
    });
    assert.equal(list.code, 0, list.stderr);
    assert.match(list.stdout, /@acme\/hello@1\.2\.0/);

    const approved = await runCli(["review", "approve", "@acme/hello@1.2.0", "--url", hub.url], {
      env: { HOME: dir, TWEXTHUB_TOKEN: "sess-1" },
    });
    assert.equal(approved.code, 0, approved.stderr);
    assert.match(approved.stdout, /Approved @acme\/hello@1\.2\.0/);
    const patch = hub.requests.find((r) => r.method === "PATCH");
    assert.deepEqual(patch.body, { status: "approved" });
  } finally {
    cleanup();
    await hub.close();
  }
});

test("review reject requires a reason and sends it to the hub", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "PATCH",
      path: "/@acme/hello/versions/1.2.0",
      reply: {
        status: 200,
        body: { namespace: "acme", id: "hello", version: "1.2.0", status: "rejected" },
      },
    },
  ]);
  try {
    const noReason = await runCli(["review", "reject", "@acme/hello@1.2.0", "--url", hub.url], {
      env: { HOME: dir, TWEXTHUB_TOKEN: "sess-1" },
    });
    assert.equal(noReason.code, 1);
    assert.match(noReason.stderr, /reason is required/i);

    const rejected = await runCli(
      ["review", "reject", "@acme/hello@1.2.0", "--reason", "Broken blocks.", "--url", hub.url],
      {
        env: { HOME: dir, TWEXTHUB_TOKEN: "sess-1" },
      },
    );
    assert.equal(rejected.code, 0, rejected.stderr);
    assert.match(rejected.stdout, /Rejected @acme\/hello@1\.2\.0/);
    const patch = hub.requests.find((r) => r.method === "PATCH");
    assert.deepEqual(patch.body, { status: "rejected", reason: "Broken blocks." });
  } finally {
    cleanup();
    await hub.close();
  }
});
