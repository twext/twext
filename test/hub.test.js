import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
    assert.ok(publishes[1].body.code.includes("class SuperUtilitiesExtension"));
    assert.equal(publishes[1].body.manifest.id, "superutilities");
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
      "https://twexts.sdisk.us/api/v0 https://example.com/v0 https://custom.test",
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
