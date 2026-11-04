# PI-Ext

[English](README.md) | [简体中文](README.zh-CN.md)

A collection of Pi extensions.

## Installation

Run the following command in this repository:

```sh
pnpm run setup
```

Start Pi, or run `/reload` in an existing session to load the extensions.

## Extensions

### codex-bar

Displays remaining Codex quota, reasoning effort (Effort), and Fast mode below the editor when using a Codex model.

| Command | Description |
| --- | --- |
| `/fast on` | Enable Fast mode for subsequent requests |
| `/fast off` | Disable Fast mode for subsequent requests |
| `/fast` | Toggle Fast mode |
| `/fast status` | Show the current Fast status |

Fast mode defaults to off whenever a session starts or reloads. Settings apply only to the current session and do not change reasoning effort. Fast mode availability depends on the model and account, and it may consume more quota.
