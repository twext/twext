import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`../test-fixtures/${name}`, import.meta.url));

function runCli(args, { env, cwd, timeout = 15000 } = {}) {
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
      query: req.url.split("?")[1] ?? "",
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

function tmpHome(credentials) {
  const dir = mkdtempSync(join(tmpdir(), "twext-home-"));
  if (credentials) {
    mkdirSync(join(dir, ".twext"), { recursive: true });
    writeFileSync(join(dir, ".twext", "config.json"), JSON.stringify(credentials));
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const approvedNote = {
  id: "7",
  kind: "review.approved",
  message: "superutilities@1.0.0 was approved and is live.",
  payload: { namespace: "acme", id: "superutilities", version: "1.0.0" },
  read: false,
  createdAt: new Date(Date.now() - 3600_000).toISOString(),
};

test("notifications lists unread rows, --read marks them read", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "GET",
      path: "/notifications",
      reply: {
        status: 200,
        body: {
          data: [{ ...approvedNote, kind: "broadcast", message: "Maintenance tonight." }],
          unreadCount: 2,
          pagination: { nextCursor: null, hasMore: false },
        },
      },
    },
    { method: "POST", path: "/notifications/read", reply: { status: 200, body: { updated: 2 } } },
  ]);
  try {
    const list = await runCli(["notifications", "--url", hub.url, "--token", "sess-1"], {
      env: { HOME: dir },
    });
    assert.equal(list.code, 0, list.stderr);
    assert.match(list.stdout, /Maintenance tonight\./);
    assert.match(list.stdout, /2 unread/);

    const read = await runCli(["notifications", "--url", hub.url, "--token", "sess-1", "--read"], {
      env: { HOME: dir },
    });
    assert.equal(read.code, 0, read.stderr);
    assert.match(read.stdout, /Marked 2 notifications read/);
    const readCall = hub.requests.find((r) => r.path === "/notifications/read");
    assert.deepEqual(readCall.body, { ids: [7] });
  } finally {
    cleanup();
    await hub.close();
  }
});

test("notifications --json prints the raw API response", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "GET",
      path: "/notifications",
      reply: {
        status: 200,
        body: {
          data: [approvedNote],
          unreadCount: 1,
          pagination: { nextCursor: null, hasMore: false },
        },
      },
    },
  ]);
  try {
    const result = await runCli(
      ["notifications", "--url", hub.url, "--token", "sess-1", "--json"],
      { env: { HOME: dir } },
    );
    assert.equal(result.code, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.unreadCount, 1);
    assert.equal(parsed.data[0].kind, "review.approved");
  } finally {
    cleanup();
    await hub.close();
  }
});

test("notifications --wait exits 0 on approval and marks the note read", async () => {
  const hub = await createHub([
    {
      method: "GET",
      path: "/notifications",
      reply: {
        status: 200,
        body: {
          data: [approvedNote],
          unreadCount: 1,
          pagination: { nextCursor: null, hasMore: false },
        },
      },
    },
    { method: "POST", path: "/notifications/read", reply: { status: 200, body: { updated: 1 } } },
  ]);
  const { dir, cleanup } = tmpHome({ hub: hub.url, namespace: "acme", token: "sess-1" });
  try {
    const result = await runCli(
      [
        "notifications",
        "--url",
        hub.url,
        "--token",
        "sess-1",
        "--wait",
        "--wait-timeout",
        "10",
        "--config",
        fixture("basic/twext.yml"),
      ],
      { env: { HOME: dir } },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /was approved and is live/);
    const readCall = hub.requests.find((r) => r.path === "/notifications/read");
    assert.deepEqual(readCall.body, { ids: [7] });
  } finally {
    cleanup();
    await hub.close();
  }
});

test("notifications --wait exits 1 on rejection", async () => {
  const hub = await createHub([
    {
      method: "GET",
      path: "/notifications",
      reply: {
        status: 200,
        body: {
          data: [
            {
              ...approvedNote,
              id: "8",
              kind: "review.rejected",
              message: "superutilities@1.0.0 was rejected: nope.",
            },
          ],
          unreadCount: 1,
          pagination: { nextCursor: null, hasMore: false },
        },
      },
    },
    { method: "POST", path: "/notifications/read", reply: { status: 200, body: { updated: 1 } } },
  ]);
  const { dir, cleanup } = tmpHome({ hub: hub.url, namespace: "acme", token: "sess-1" });
  try {
    const result = await runCli(
      [
        "notifications",
        "--url",
        hub.url,
        "--token",
        "sess-1",
        "--wait",
        "--wait-timeout",
        "10",
        "--config",
        fixture("basic/twext.yml"),
      ],
      { env: { HOME: dir } },
    );
    assert.equal(result.code, 1);
    assert.match(result.stdout, /was rejected/);
  } finally {
    cleanup();
    await hub.close();
  }
});

test("notifications --wait gives up after the timeout", async () => {
  const { dir, cleanup } = tmpHome();
  const hub = await createHub([
    {
      method: "GET",
      path: "/notifications",
      reply: {
        status: 200,
        body: { data: [], unreadCount: 0, pagination: { nextCursor: null, hasMore: false } },
      },
    },
  ]);
  try {
    const started = Date.now();
    const result = await runCli(
      [
        "notifications",
        "--url",
        hub.url,
        "--token",
        "sess-1",
        "--wait",
        "--wait-timeout",
        "1",
        "--config",
        fixture("basic/twext.yml"),
      ],
      { env: { HOME: dir }, timeout: 20000 },
    );
    assert.equal(result.code, 2, "timeout should exit 2, distinct from rejection");
    assert.match(result.stderr, /giving up after 1s/);
    assert.ok(Date.now() - started < 10_000, "timeout should fire at 1s, not the poll interval");
  } finally {
    cleanup();
    await hub.close();
  }
});

test("publish shows the unread banner; an explicit token suppresses it", async () => {
  const hub = await createHub([
    {
      method: "GET",
      path: "/notifications",
      reply: {
        status: 200,
        body: { data: [], unreadCount: 3, pagination: { nextCursor: null, hasMore: false } },
      },
    },
    {
      method: "POST",
      path: "/@acme/superutilities/versions",
      reply: {
        status: 200,
        body: { id: "superutilities", version: "1.0.0", status: "published" },
      },
    },
  ]);
  const { dir, cleanup } = tmpHome({ hub: hub.url, namespace: "acme", token: "sess-1" });
  try {
    const banner = await runCli(
      ["publish", "--config", fixture("basic/twext.yml"), "--url", hub.url],
      { env: { HOME: dir } },
    );
    assert.equal(banner.code, 0, banner.stderr);
    assert.match(banner.stderr, /3 unread notifications/);
    assert.match(banner.stdout, /Published superutilities@1\.0\.0/);

    const explicit = await runCli(
      ["publish", "--config", fixture("basic/twext.yml"), "--url", hub.url, "--token", "ci-token"],
      { env: { HOME: dir } },
    );
    assert.equal(explicit.code, 0, explicit.stderr);
    assert.ok(
      !explicit.stdout.includes("unread notification") &&
        !explicit.stderr.includes("unread notification"),
      "no banner for CI tokens",
    );

    const listCalls = hub.requests.filter((r) => r.path === "/notifications");
    assert.equal(listCalls.length, 1, "only the banner-less run checks the mailbox");
  } finally {
    cleanup();
    await hub.close();
  }
});
