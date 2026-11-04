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

Skills are shared with Pi and Codex through `~/.agents/skills/`. Keep this repository in place after setup. No skills are bundled yet.

Start Pi, or run `/reload` in an existing session to load your selection.

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
