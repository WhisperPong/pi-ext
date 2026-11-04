import assert from "node:assert/strict";
import test from "node:test";
import codexBar from "../index.ts";

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
      theme: { fg: (_color, text) => text },
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
  assert.equal(app.text, "Codex | 5h: 80% left | 7d: 55% left | Effort: high | Fast: off | Speed: --");
  await app.emit("agent_end");
  assert.match(app.text, /5h: 60% left/);
  assert.equal(requests, 2);
});

test("uses the same dim theme color as the built-in footer", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(quota()));
  const app = harness();
  app.ctx.ui.theme.fg = (color, text) => {
    assert.equal(color, "dim");
    return `\u001b[90m${text}\u001b[39m`;
  };
  await app.emit("session_start");
  assert.equal(app.text, "\u001b[90mCodex | 5h: 80% left | 7d: 55% left | Effort: high | Fast: off | Speed: --\u001b[39m");
});

test("shows per-request output speed after completion and resets it on model or session changes", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(quota()));
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const app = harness();
  const message = {
    role: "assistant", provider: "openai-codex", model: "test-model",
    stopReason: "stop", usage: { output: 120 },
  };
  await app.emit("session_start");
  assert.match(app.text, /Speed: --$/);
  await app.emit("message_end", { message });
  assert.match(app.text, /Speed: --$/);
  await app.emit("before_provider_request", { payload: {} });
  assert.match(app.text, /Speed: \.\.\.$/);
  now = 1000;
  await app.emit("message_end", { message: { role: "toolResult" } });
  await app.emit("message_end", { message: { ...message, model: "previous-model" } });
  assert.match(app.text, /Speed: \.\.\.$/);
  now = 2000;
  await app.emit("message_end", { message });
  assert.match(app.text, /Speed: 60\.0 tok\/s$/);
  now = 5000;
  await app.emit("agent_end");
  assert.match(app.text, /Speed: 60\.0 tok\/s$/);
  await app.emit("model_select");
  assert.match(app.text, /Speed: --$/);
  await app.emit("before_provider_request", { payload: {} });
  now = 6000;
  await app.emit("message_end", { message });
  assert.match(app.text, /Speed: 120\.0 tok\/s$/);
  await app.emit("session_start");
  assert.match(app.text, /Speed: --$/);
});

test("failed and aborted replies do not leave the speed measurement running", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(quota()));
  const app = harness();
  await app.emit("session_start");
  for (const stopReason of ["error", "aborted"]) {
    await app.emit("before_provider_request", { payload: {} });
    await app.emit("message_end", { message: {
      role: "assistant", provider: "openai-codex", model: "test-model",
      stopReason, usage: { output: 100 },
    } });
    assert.match(app.text, /Speed: --$/);
  }
});

test("defaults Fast to off and observes server state without mutating the request", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(quota()));
  const app = harness();
  await app.emit("session_start");
  app.ctx.thinkingLevel = "low";
  await app.emit("thinking_level_select", { level: "low" });
  assert.match(app.text, /Effort: low/);
  const payload = Object.freeze({ service_tier: "priority" });
  assert.deepEqual(await app.emit("before_provider_request", { payload }), { service_tier: "default" });
  assert.equal(payload.service_tier, "priority");
  assert.match(app.text, /Fast: off/);
  await app.emit("provider_stream_event", {
    provider: "openai-codex", model: "previous-model",
    data: { type: "response.created", response: { service_tier: "default" } },
  });
  assert.match(app.text, /Fast: off/);
  await app.emit("provider_stream_event", {
    provider: "openai-codex", model: "test-model",
    data: { type: "response.created", response: { service_tier: "priority" } },
  });
  assert.match(app.text, /Fast: off \(server: on\)/);
  assert.deepEqual(await app.emit("before_provider_request", { payload: {} }), { service_tier: "default" });
  assert.match(app.text, /Fast: off \(requested\)/);
});

test("/fast on and off override only service_tier on subsequent Codex requests", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(quota()));
  const app = harness();
  await app.emit("session_start");
  const payload = Object.freeze({
    model: "test-model", service_tier: "flex", reasoning: { effort: "high" }, input: [],
  });
  assert.deepEqual(await app.emit("before_provider_request", { payload }), { ...payload, service_tier: "default" });
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

test("Codex default responses do not falsely confirm or reject priority requests", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(quota()));
  const app = harness();
  await app.emit("session_start");
  await app.command("on");
  await app.emit("before_provider_request", { payload: {} });
  const observe = (tier, type = "response.completed") => app.emit("provider_stream_event", {
    provider: "openai-codex", model: "test-model",
    data: { type, response: { service_tier: tier } },
  });
  await observe("default", "response.created");
  assert.match(app.text, /Fast: on \(requested\) \| Speed:/);
  await observe("default");
  assert.match(app.text, /Fast: on \(requested\) \| Speed:/);
  await observe("priority");
  assert.match(app.text, /Fast: on \| Speed:/);
  await observe("default");
  assert.match(app.text, /Fast: on \| Speed:/);
  await app.emit("before_provider_request", { payload: {} });
  await observe("flex");
  assert.match(app.text, /Fast: on \(server: off\) \| Speed:/);
  await app.command("off");
  await app.emit("before_provider_request", { payload: {} });
  await observe("default");
  assert.match(app.text, /Fast: off \| Speed:/);
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
  assert.deepEqual(await app.emit("before_provider_request", { payload: {} }), { service_tier: "default" });
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
