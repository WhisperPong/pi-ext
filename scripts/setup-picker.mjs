import { emitKeypressEvents } from "node:readline";
import { stripVTControlCharacters } from "node:util";

// Conservatively count non-ASCII characters as two cells to avoid line wrapping
// without requiring a terminal-width dependency before setup installs packages.
function fitLine(value, columns) {
  const text = stripVTControlCharacters(String(value)).replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
  let result = "";
  let width = 0;
  for (const character of text) {
    const size = /\p{Mark}/u.test(character) ? 0 : character.codePointAt(0) < 128 ? 1 : 2;
    if (width + size > columns) break;
    result += character;
    width += size;
  }
  return result;
}

export async function chooseResources(resources, { input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("Setup requires an interactive terminal. Run pnpm run setup in your terminal.");
  }
  const items = resources.extensions.map((item) => ({ ...item }));
  const rows = [{ label: "Extensions" }];
  if (!items.length) rows.push({ label: "  (none available)" });
  for (let index = 0; index < items.length; index++) rows.push({ index });
  const selection = () => ({ extensions: items.filter((item) => item.selected).map((item) => item.id) });
  let cursor = 0;
  let scroll = 0;
  let confirming = false;
  let action = 0;
  const actions = ["Apply selection", "Back to selection", "Cancel"];
  const viewportHeight = () => Math.max(1, (output.rows || 24) - 10);

  function render() {
    const selected = selection();
    const lines = ["PI-Ext setup", ""];
    if (confirming) {
      lines.push("Apply this selection?", "");
      const summary = [
        `Extensions: ${selected.extensions.join(", ") || "none"}`,
        "Unselected extensions from this repository are disabled.",
      ];
      lines.push(...summary, "", ...actions.map((label, i) => `${action === i ? ">" : " "} ${label}`), "", "↑/↓ Move  Enter Confirm  Esc Back  Q Cancel");
    } else {
      lines.push("↑/↓ Move  Space Toggle  A All  N None", "Enter Review  Esc/Q Cancel", "Unselected extensions from this repository are disabled.", "");
      const position = rows.findIndex((row) => row.index === cursor);
      const height = viewportHeight();
      if (position >= 0) scroll = Math.min(Math.max(scroll, position - height + 1), position);
      scroll = Math.max(0, Math.min(scroll, rows.length - height));
      for (const row of rows.slice(scroll, scroll + height)) {
        if (row.index === undefined) {
          lines.push(row.label);
        } else {
          const item = items[row.index];
          const status = item.status === "installed" ? " [installed]" : item.status === "migration" ? " [migrate legacy tasks]" : "";
          lines.push(`${row.index === cursor ? ">" : " "} [${item.selected ? "x" : " "}] ${item.id}${status}`);
        }
      }
      lines.push("", `Selected: ${selected.extensions.length} extension(s) | Rows ${scroll + 1}-${Math.min(rows.length, scroll + height)}/${rows.length}`, items[cursor]?.description || "");
    }
    const height = Math.max(1, (output.rows || 24) - 1);
    const width = Math.max(1, (output.columns || 80) - 1);
    // Keep controls accessible in short terminals by retaining the menu body.
    const visible = lines.length > height ? lines.slice(-height) : lines;
    output.write(`\x1b[H\x1b[2J${visible.map((line) => fitLine(line, width)).join("\r\n")}`);
  }

  const wasRaw = input.isRaw === true;
  const wasFlowing = input.readableFlowing === true;
  let enteredScreen = false;
  emitKeypressEvents(input);
  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        input.off("keypress", onKey);
        input.off("end", cancel);
        input.off("close", cancel);
        input.off("error", fail);
        output.off("error", fail);
        output.off("resize", redraw);
        process.off("SIGINT", cancel);
        process.off("SIGTERM", cancel);
        if (error) reject(error);
        else resolve(value);
      };
      const cancel = () => finish(undefined, undefined);
      const fail = (error) => finish(error);
      const redraw = () => {
        try { render(); } catch (error) { fail(error); }
      };
      const onKey = (text, key = {}) => {
        if ((key.ctrl && ["c", "d"].includes(key.name)) || text?.toLowerCase() === "q") return cancel();
        // Node marks a standalone Escape as meta, too.
        if (key.ctrl || (key.meta && key.name !== "escape")) return;
        const name = key.name || text;
        const lower = text?.toLowerCase();
        if (confirming) {
          if (name === "escape" || lower === "b") confirming = false;
          else if (lower === "y") return finish(undefined, selection());
          else if (lower === "n") return cancel();
          else if (name === "up" || name === "left" || (name === "tab" && key.shift)) action = (action + actions.length - 1) % actions.length;
          else if (["down", "right", "tab"].includes(name)) action = (action + 1) % actions.length;
          else if (name === "return" || name === "enter") {
            if (action === 0) return finish(undefined, selection());
            if (action === 2) return cancel();
            confirming = false;
          }
        } else {
          if (name === "escape") return cancel();
          if (name === "return" || name === "enter") { confirming = true; action = 0; }
          else if (lower === "a" || lower === "n") {
            for (const item of items) item.selected = lower === "a";
          } else if ((name === "space" || text === " ") && items.length) items[cursor].selected = !items[cursor].selected;
          else if (items.length) {
            if (name === "up" || (name === "tab" && key.shift)) cursor = (cursor + items.length - 1) % items.length;
            else if (name === "down" || name === "tab") cursor = (cursor + 1) % items.length;
            else if (name === "home") cursor = 0;
            else if (name === "end") cursor = items.length - 1;
            else if (name === "pageup") cursor = Math.max(0, cursor - viewportHeight());
            else if (name === "pagedown") cursor = Math.min(items.length - 1, cursor + viewportHeight());
          }
        }
        redraw();
      };
      input.on("keypress", onKey);
      input.on("end", cancel);
      input.on("close", cancel);
      input.on("error", fail);
      output.on("error", fail);
      output.on("resize", redraw);
      process.on("SIGINT", cancel);
      process.on("SIGTERM", cancel);
      try {
        input.setRawMode(true);
        enteredScreen = true;
        output.write("\x1b[?1049h\x1b[?25l");
        input.resume();
        render();
      } catch (error) { fail(error); }
    });
  } finally {
    try {
      input.setRawMode(wasRaw);
    } finally {
      if (!wasFlowing) input.pause();
      if (enteredScreen) output.write("\x1b[?25h\x1b[?1049l");
    }
  }
}
