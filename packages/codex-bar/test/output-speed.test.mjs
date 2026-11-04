import assert from "node:assert/strict";
import test from "node:test";
import { OutputSpeed } from "../src/output-speed.ts";

function tracker() {
  let now = 0;
  const speed = new OutputSpeed(() => now);
  return { speed, advance: (milliseconds) => { now += milliseconds; } };
}

test("shows no data initially and measures actual output tokens over request time", () => {
  const { speed, advance } = tracker();
  assert.equal(speed.label, "--");
  speed.start();
  assert.equal(speed.label, "...");
  advance(2000);
  speed.finish(123);
  assert.equal(speed.label, "61.5 tok/s");
  advance(1000);
  assert.equal(speed.label, "61.5 tok/s");
});

test("each request starts a fresh measurement and reset clears the result", () => {
  const { speed, advance } = tracker();
  speed.start();
  advance(1000);
  speed.finish(100);
  speed.start();
  assert.equal(speed.label, "...");
  advance(2000);
  speed.finish(50);
  assert.equal(speed.label, "25.0 tok/s");
  speed.reset();
  assert.equal(speed.label, "--");
});

test("ignores completions without a matching request start", () => {
  const { speed, advance } = tracker();
  advance(1000);
  speed.finish(100);
  assert.equal(speed.label, "--");
  speed.start();
  advance(1000);
  speed.finish(50);
  advance(1000);
  speed.finish(1000);
  assert.equal(speed.label, "50.0 tok/s");
});

test("does not fabricate speeds for missing or invalid usage and elapsed time", () => {
  const { speed, advance } = tracker();
  for (const tokens of [undefined, NaN, Infinity, -1]) {
    speed.start();
    advance(1000);
    speed.finish(tokens);
    assert.equal(speed.label, "--");
  }
  speed.start();
  speed.finish(100);
  assert.equal(speed.label, "--");
  speed.start();
  advance(-1);
  speed.finish(100);
  assert.equal(speed.label, "--");
});

test("supports valid zero-token replies", () => {
  const { speed, advance } = tracker();
  speed.start();
  advance(1000);
  speed.finish(0);
  assert.equal(speed.label, "0.0 tok/s");
});
