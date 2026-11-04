import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { chooseResources } from "../setup-picker.mjs";

const menu = {
  extensions: [
    { id: "codex-bar", description: "Codex status", selected: false, status: "new" },
    { id: "skill-manager", description: "Packaged tasks", selected: true, status: "installed" },
  ],
};

function startPicker(t, resources = menu, { rows = 24, columns = 100, raw = false } = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = output.isTTY = true;
  input.isRaw = raw;
  output.rows = rows;
  output.columns = columns;
  const modes = [];
  input.setRawMode = (enabled) => { modes.push(enabled); input.isRaw = enabled; };
  let transcript = "";
  const frames = [];
  output.on("data", (chunk) => {
    const text = chunk.toString();
    transcript += text;
    if (text.startsWith("\x1b[H\x1b[2J")) frames.push(text);
  });
  const result = chooseResources(resources, { input, output });
  t.after(async () => {
    input.emit("keypress", undefined, { name: "c", ctrl: true });
    await result.catch(() => {});
    input.destroy();
    output.destroy();
  });
  return {
    input, output, result, modes, frames,
    send: (text) => input.write(text),
    escape: () => input.emit("keypress", undefined, { name: "escape", meta: true }),
    get transcript() { return transcript; },
  };
}

function assertRestored(app, raw = false) {
  assert.deepEqual(app.modes, [true, raw]);
  if (!app.input.destroyed) assert.equal(app.input.isPaused(), true);
  assert.equal(app.input.listenerCount("keypress"), 0);
  assert.equal(app.input.listenerCount("end"), 0);
  assert.equal(app.output.listenerCount("resize"), 0);
  assert.ok(app.transcript.endsWith("\x1b[?25h\x1b[?1049l"));
}

test("arrow keys and Space select resources, followed by a separate confirmation", async (t) => {
  const app = startPicker(t);
  assert.match(app.transcript, /> \[ \] codex-bar/);
  assert.match(app.transcript, /\[x\] skill-manager \[installed\]/);
  app.send(" \x1b[B \r");
  assert.match(app.frames.at(-1), /Apply this selection\?/);
  assert.match(app.frames.at(-1), /Extensions: codex-bar/);
  assert.doesNotMatch(app.frames.at(-1), /Skills:/);
  assert.equal(app.modes.length, 1, "Reviewing the summary must not apply it");
  app.send("\r");
  assert.deepEqual(await app.result, { extensions: ["codex-bar"] });
  assert.equal(menu.extensions[0].selected, false);
  assert.equal(menu.extensions[1].selected, true);
  assertRestored(app);
});

test("all/none shortcuts and returning to selection preserve edits", async (t) => {
  const app = startPicker(t);
  app.send("a\r");
  app.escape();
  assert.match(app.frames.at(-1), /\[x\] codex-bar/);
  app.send("n\r\x1b[B\r"); // Choose Back to selection.
  assert.match(app.frames.at(-1), /\[ \] skill-manager/);
  app.send("a\ry");
  assert.deepEqual(await app.result, { extensions: ["codex-bar", "skill-manager"] });
  assertRestored(app);
});

test("standalone Escape bytes return from confirmation and cancel the list", async (t) => {
  const app = startPicker(t);
  app.send("\r\x1b");
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.match(app.frames.at(-1), /Space Toggle/);
  app.send("\x1b");
  assert.equal(await app.result, undefined);
  assertRestored(app);
});

test("navigation wraps and supports Tab, Shift+Tab, Home, and End", async (t) => {
  const app = startPicker(t);
  app.send("\x1b[A");
  assert.match(app.frames.at(-1), /> \[x\] skill-manager/);
  app.send("\t");
  assert.match(app.frames.at(-1), /> \[ \] codex-bar/);
  app.send("\x1b[Z");
  assert.match(app.frames.at(-1), /> \[x\] skill-manager/);
  app.send("\x1b[H");
  assert.match(app.frames.at(-1), /> \[ \] codex-bar/);
  app.send("\x1b[F");
  assert.match(app.frames.at(-1), /> \[x\] skill-manager/);
  app.send("q");
  assert.equal(await app.result, undefined);
});

test("cancel keys, EOF, and closing input restore terminal state", async (t) => {
  for (const cancel of [
    (app) => app.send("q"),
    (app) => app.escape(),
    (app) => app.send("\x03"),
    (app) => app.send("\x04"),
    (app) => app.input.end(),
    (app) => app.input.destroy(),
    (app) => app.send("\rn"),
    (app) => app.send("\r\x1b[B\x1b[B\r"),
  ]) {
    const app = startPicker(t);
    cancel(app);
    assert.equal(await app.result, undefined);
    assertRestored(app);
  }
});

test("an empty extension list can be reviewed and confirmed without navigation errors", async (t) => {
  const app = startPicker(t, { extensions: [] });
  assert.match(app.transcript, /Extensions/);
  assert.match(app.transcript, /none available/);
  app.send("\x1b[B a\r\r");
  assert.deepEqual(await app.result, { extensions: [] });
  assertRestored(app);
});

test("long lists scroll, page, and redraw after terminal resizing", async (t) => {
  const resources = {
    extensions: [
      ...Array.from({ length: 30 }, (_, i) => ({ id: `extension-${i}`, selected: false })),
      { id: "skill-manager", status: "migration", description: "Migrate existing tasks", selected: true },
    ],
  };
  const app = startPicker(t, resources, { rows: 16, columns: 80 });
  app.send("\x1b[6~");
  assert.match(app.frames.at(-1), /> \[ \] extension-6/);
  app.send("\x1b[5~");
  assert.match(app.frames.at(-1), /> \[ \] extension-0/);
  app.send("\x1b[F");
  assert.match(app.frames.at(-1), /> \[x\] skill-manager \[migrate legacy tasks\]/);
  assert.doesNotMatch(app.frames.at(-1), /extension-0/);
  app.output.rows = 12;
  app.output.columns = 36;
  app.output.emit("resize");
  const frame = app.frames.at(-1).replace(/^\x1b\[H\x1b\[2J/, "");
  assert.ok(frame.split("\r\n").length <= 11);
  assert.ok(frame.split("\r\n").every((line) => line.length <= 35));
  assert.match(frame, /> \[x\] skill-manager/);
  app.send("q");
  await app.result;
  assertRestored(app);
});

test("resource text cannot inject terminal control sequences or extra lines", async (t) => {
  const app = startPicker(t, {
    extensions: [{ id: "safe\x1b[2J\nname", description: "描述".repeat(100) + "\x1b[?25h", selected: false }],
  }, { columns: 40 });
  assert.match(app.frames[0], /safe name/);
  assert.equal(app.frames[0].split("\x1b[2J").length, 2);
  assert.ok(!app.frames[0].includes("\x1b[?25h"));
  app.send("q");
  await app.result;
});

test("input errors restore the original raw mode and remove signal listeners", async (t) => {
  const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
  const app = startPicker(t, menu, { raw: true });
  const rejected = assert.rejects(app.result, /read failed/);
  app.input.emit("error", new Error("read failed"));
  await rejected;
  assertRestored(app, true);
  assert.deepEqual([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")], before);
});

test("render errors restore the terminal without leaving listeners attached", async (t) => {
  const app = startPicker(t);
  app.output.write = () => { throw new Error("render failed"); };
  const rejected = assert.rejects(app.result, /render failed/);
  app.send(" ");
  await rejected;
  assert.equal(app.input.isRaw, false);
  assert.equal(app.input.listenerCount("keypress"), 0);
  assert.equal(app.output.listenerCount("resize"), 0);
});

test("redirected input is rejected before changing terminal state", async () => {
  await assert.rejects(chooseResources({ extensions: [] }, {
    input: new PassThrough(), output: new PassThrough(),
  }), /interactive terminal/);
});
