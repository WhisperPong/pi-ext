import assert from "node:assert/strict";
import test from "node:test";
import codexBar from "../src/index.ts";

const token = `header.${Buffer.from(JSON.stringify({
  "https://api.openai.com/auth": { chatgpt_account_id: "test-account" },
})).toString("base64url")}.signature`;

const quota = (primary = 20, secondary = 45) => ({
  rate_limit: {
    primary_window: { used_percent: primary, limit_window_seconds: 18000 },
    secondary_window: { used_percent: secondary, limit_window_seconds: 604800 },
  },
});

function harness() {
  const handlers = new Map();
  const commands = new Map();
  const widgets = [];
  const notifications = [];
  let authCalls = 0;
  const ctx = {
    hasUI: true,
    model: { provider: "openai-codex", api: "openai-codex-responses", id: "test-model" },
    thinkingLevel: "high",
    modelRegistry: {
      async getApiKeyAndHeaders() {
        authCalls++;
        return { ok: true, apiKey: token };
      },
    },
    ui: {
      setWidget(key, content, options) {
        assert.equal(key, "codex-bar");
        widgets.push({ content, options });
      },
      notify(message, level) { notifications.push({ message, level }); },
    },
  };
  codexBar({
    on: (event, handler) => handlers.set(event, handler),
    registerCommand: (name, command) => commands.set(name, command),
  });
  return {
    ctx,
    widgets,
    commands,
    notifications,
    get text() { return widgets.at(-1)?.content?.[0]; },
    get authCalls() { return authCalls; },
    emit: (type, event = {}) => handlers.get(type)({ type, ...event }, ctx),
    command: (args = "") => commands.get("fast").handler(args, ctx),
  };
}

test("shows current account quota below the editor and refreshes after a turn", async (t) => {
  const app = harness();
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://chatgpt.com/backend-api/wham/usage");
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(options.headers["ChatGPT-Account-Id"], "test-account");
    assert.equal(options.redirect, "error");
    requests++;
    return Response.json(quota(requests * 20));
  });
  await app.emit("session_start");
  assert.equal(app.widgets.at(-1).options.placement, "belowEditor");
  assert.equal(app.text, "Codex | 5h: 80% left | 7d: 55% left | Effort: high | Fast: unknown");
  await app.emit("agent_end");
  assert.match(app.text, /5h: 60% left/);
  assert.equal(requests, 2);
});

test("updates effort and fast state without modifying the request", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(quota()));
  const app = harness();
  await app.emit("session_start");
  app.ctx.thinkingLevel = "low";
  await app.emit("thinking_level_select", { level: "low" });
  assert.match(app.text, /Effort: low/);
  const payload = Object.freeze({ service_tier: "priority" });
  assert.equal(await app.emit("before_provider_request", { payload }), undefined);
  assert.match(app.text, /Fast: on/);
  await app.emit("provider_stream_event", {
    provider: "openai-codex", model: "previous-model",
    data: { type: "response.created", response: { service_tier: "default" } },
  });
  assert.match(app.text, /Fast: on/);
  await app.emit("provider_stream_event", {
    provider: "openai-codex", model: "test-model",
    data: { type: "response.created", response: { service_tier: "default" } },
  });
  assert.match(app.text, /Fast: on \(server: off\)/);
  await app.emit("before_provider_request", { payload: {} });
  assert.match(app.text, /Fast: unknown/);
});

test("/fast on and off override only service_tier on subsequent Codex requests", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(quota()));
  const app = harness();
  await app.emit("session_start");
  const payload = Object.freeze({
    model: "test-model", service_tier: "flex", reasoning: { effort: "high" }, input: [],
  });
  assert.equal(await app.emit("before_provider_request", { payload }), undefined);
  await app.command("on");
  assert.match(app.text, /Fast: on \(next request\)/);
  const fastRequest = await app.emit("before_provider_request", { payload });
  assert.deepEqual(fastRequest, { ...payload, service_tier: "priority" });
  assert.equal(payload.service_tier, "flex");
  assert.equal(fastRequest.reasoning, payload.reasoning);
  assert.match(app.text, /Fast: on \(requested\)/);
  await app.command("off");
  assert.match(app.text, /Fast: off \(next request\)/);
  assert.deepEqual(await app.emit("before_provider_request", { payload }), {
    ...payload, service_tier: "default",
  });
});

test("/fast toggles, status does not toggle, and invalid arguments leave the setting unchanged", async () => {
  const app = harness();
  app.ctx.hasUI = false;
  await app.command();
  await app.command("status");
  assert.equal((await app.emit("before_provider_request", { payload: {} })).service_tier, "priority");
  await app.command("invalid");
  assert.deepEqual(app.notifications.at(-1), { message: "Usage: /fast [on|off|status]", level: "warning" });
  assert.equal((await app.emit("before_provider_request", { payload: {} })).service_tier, "priority");
  await app.command();
  assert.equal((await app.emit("before_provider_request", { payload: {} })).service_tier, "default");
  assert.deepEqual(app.commands.get("fast").getArgumentCompletions("o"), [
    { value: "on", label: "on" }, { value: "off", label: "off" },
  ]);
});

test("Fast setting survives model changes and resets for a new session", async () => {
  const app = harness();
  app.ctx.hasUI = false;
  await app.command("on");
  app.ctx.model.id = "next-model";
  await app.emit("model_select");
  assert.equal((await app.emit("before_provider_request", { payload: {} })).service_tier, "priority");
  await app.emit("session_start");
  assert.equal(await app.emit("before_provider_request", { payload: {} }), undefined);
});

test("/fast supports Codex-compatible providers and rejects unrelated providers", async () => {
  const app = harness();
  app.ctx.hasUI = false;
  app.ctx.model.provider = "custom-codex";
  await app.command("on");
  assert.equal((await app.emit("before_provider_request", { payload: {} })).service_tier, "priority");
  app.ctx.model = { provider: "anthropic", api: "anthropic-messages", id: "other-model" };
  await app.command("on");
  assert.deepEqual(app.notifications.at(-1), {
    message: "Fast mode requires a Codex provider.", level: "warning",
  });
  assert.equal(await app.emit("before_provider_request", { payload: {} }), undefined);
});

test("clears the widget for other providers and skips non-UI sessions", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json(quota()));
  const app = harness();
  await app.emit("session_start");
  app.ctx.model = { provider: "anthropic", id: "other-model" };
  await app.emit("model_select");
  assert.equal(app.text, undefined);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(app.authCalls, 1);
  app.ctx.hasUI = false;
  app.ctx.model = { provider: "openai-codex", id: "test-model" };
  await app.emit("model_select");
  assert.equal(app.authCalls, 1);
});

test("shows unavailable for failed, missing, or malformed quota data", async (t) => {
  for (const result of [
    () => new Response(null, { status: 401 }),
    () => { throw new Error("Network error"); },
    () => Response.json({}),
    () => Response.json({ rate_limit: { primary_window: { used_percent: "20", limit_window_seconds: 18000 } } }),
  ]) {
    t.mock.method(globalThis, "fetch", result);
    const app = harness();
    await app.emit("session_start");
    assert.match(app.text, /Usage: unavailable/);
    t.mock.restoreAll();
  }
  const fetch = t.mock.method(globalThis, "fetch", () => assert.fail("No request without account auth"));
  const app = harness();
  app.ctx.modelRegistry.getApiKeyAndHeaders = async () => ({ ok: false });
  await app.emit("session_start");
  assert.match(app.text, /Usage: unavailable/);
  app.ctx.modelRegistry.getApiKeyAndHeaders = async () => ({ ok: true, apiKey: "api-key" });
  await app.emit("agent_end");
  assert.match(app.text, /Usage: unavailable/);
  assert.equal(fetch.mock.callCount(), 0);
});

test("late quota responses cannot restore a widget after switching provider or shutdown", async (t) => {
  for (const event of ["model_select", "session_shutdown"]) {
    let resolve;
    let signal;
    const started = new Promise((ready) => {
      t.mock.method(globalThis, "fetch", (_url, options) => {
        signal = options.signal;
        ready();
        return new Promise((done) => { resolve = done; });
      });
    });
    const app = harness();
    const loading = app.emit("session_start");
    await started;
    if (event === "model_select") app.ctx.model = { provider: "anthropic", id: "other-model" };
    await app.emit(event);
    assert.equal(signal.aborted, true);
    resolve(Response.json(quota()));
    await loading;
    assert.equal(app.text, undefined);
    t.mock.restoreAll();
  }
});
