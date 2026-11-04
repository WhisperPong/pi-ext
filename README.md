# PI-Ext

[English](README.md) | [简体中文](README.zh-CN.md)

A collection of Pi extensions and skills.

## Installation

Run the following command in this repository:

```sh
pnpm run setup
```

The setup wizard lets you choose extensions and skills by number. Press Enter to review your selection, then confirm to install. Enter `q` or press Ctrl+C to cancel without making changes.

Run setup again to change which extensions from this repository are enabled. Unselected extensions will be disabled; existing skills will not be removed or overwritten.

Skills are shared with Pi and Codex through `~/.agents/skills/`. Keep this repository in place after setup.

Start Pi, or run `/reload` in an existing session to load your selection.

## Skills

### review-fix

Checks and directly fixes current changes for encapsulation, responsibility boundaries, project conventions, correctness, and test coverage. Performs minimal edits and verification rather than only reporting findings, avoiding unnecessary abstractions and never staging or committing automatically. Asks before resolving business ambiguities, making breaking changes, or undertaking large refactors.

Select `review-fix` during setup, then invoke it in Pi:

```text
/skill:review-fix
/skill:review-fix Focus on state encapsulation and error handling
```

By default, checks staged, unstaged, and relevant untracked files; you can also specify a scope. Fixes are written to the current working tree while preserving existing edits and staging state. A `/review:fix` shortcut is not currently provided.

## Extensions

### codex-bar

Displays remaining Codex quota, reasoning effort (Effort), Fast mode, and output speed below the editor when using a Codex model.

`Speed` estimates the latest completed reply's text output tokens per second, excluding waiting and reasoning. The last valid result stays visible during new requests and tool calls. Very short or buffered replies do not update it; `--` means no measurement is available.

| Command | Description |
| --- | --- |
| `/fast on` | Enable Fast mode for subsequent requests |
| `/fast off` | Disable Fast mode for subsequent requests |
| `/fast` | Toggle Fast mode |
| `/fast status` | Show the current Fast status |

Fast mode defaults to off whenever a session starts or reloads. Settings apply only to the current session and do not change reasoning effort. Fast mode availability depends on the model and account, and it may consume more quota.
