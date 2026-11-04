import assert from "node:assert/strict";
import test from "node:test";
import { OutputSpeed } from "../src/output-speed.ts";

function tracker() {
  let now = 0;
  const speed = new OutputSpeed(() => now);
  const advance = (milliseconds) => { now += milliseconds; };
  const text = (milliseconds = 1000, index = 0) => {
    speed.recordTextDelta(index, "first");
    advance(milliseconds);
    speed.recordTextDelta(index, "last");
  };
  return { speed, advance, text };
}

test("measures visible text streaming, excluding first-token wait, reasoning tokens, and completion delay", () => {
  const { speed, advance, text } = tracker();
  assert.equal(speed.label, "--");
  speed.start();
  advance(10000);
  assert.equal(speed.label, "--");
  text(2000);
  advance(5000);
  speed.finish(500, 400);
  assert.equal(speed.label, "50.0 tok/s");
});

test("keeps the previous result throughout the next request and only changes on a valid completion", () => {
  const { speed, text, advance } = tracker();
  speed.start();
  text();
  speed.finish(100);
  speed.start();
  assert.equal(speed.label, "100.0 tok/s");
  advance(10000);
  text(2000);
  assert.equal(speed.label, "100.0 tok/s");
  speed.finish(50);
  assert.equal(speed.label, "25.0 tok/s");
  speed.reset();
  assert.equal(speed.label, "--");
});

test("ignores incomplete, failed, empty, single-chunk, and very short measurements", () => {
  const { speed, text, advance } = tracker();
  speed.start();
  text();
  speed.finish(100);
  for (const tokens of [undefined, NaN, Infinity, -1, 0]) {
    speed.start();
    text();
    speed.finish(tokens);
    assert.equal(speed.label, "100.0 tok/s");
  }
  speed.start();
  speed.recordTextDelta(0, "buffered reply");
  advance(5000);
  speed.finish(100);
  assert.equal(speed.label, "100.0 tok/s");
  speed.start();
  text(100);
  speed.finish(100);
  assert.equal(speed.label, "100.0 tok/s");
  speed.start();
  speed.finish(100);
  assert.equal(speed.label, "100.0 tok/s");
});

test("sums text-block durations without counting gaps between them", () => {
  const { speed, text, advance } = tracker();
  speed.start();
  text(1000, 0);
  advance(10000);
  text(2000, 2);
  speed.finish(450, 300);
  assert.equal(speed.label, "50.0 tok/s");
});

test("rejects invalid reasoning usage and buffered blocks rather than overestimating", () => {
  const { speed, text } = tracker();
  for (const reasoning of [NaN, Infinity, -1, 100, 101]) {
    speed.start();
    text();
    speed.finish(100, reasoning);
    assert.equal(speed.label, "--");
  }
  speed.start();
  text();
  speed.recordTextDelta(1, "second block delivered all at once");
  speed.finish(100);
  assert.equal(speed.label, "--");
});

test("ignores deltas and duplicate completions without an active request", () => {
  const { speed, text } = tracker();
  text();
  speed.finish(100);
  assert.equal(speed.label, "--");
  speed.start();
  text();
  speed.finish(50);
  text();
  speed.finish(1000);
  assert.equal(speed.label, "50.0 tok/s");
});

test("empty deltas and nonpositive intervals do not produce a speed", () => {
  const { speed, advance, text } = tracker();
  speed.start();
  speed.recordTextDelta(0, "");
  advance(1000);
  speed.recordTextDelta(0, "only actual chunk");
  speed.finish(100);
  assert.equal(speed.label, "--");
  for (const duration of [0, -1000]) {
    speed.start();
    text(duration);
    speed.finish(100);
    assert.equal(speed.label, "--");
  }
});
