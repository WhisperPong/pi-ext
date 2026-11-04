# PI-Ext

[English](README.md) | [简体中文](README.zh-CN.md)

A collection of Pi extensions.

## Installation

Run the following command in this repository:

```sh
pnpm run setup
```

The setup wizard provides a keyboard-driven multiselect for extensions, with installed items preselected. Use ↑/↓ to move, Space to toggle, `a` to select all, and `n` to clear the selection. Press Enter to review, then choose **Apply selection** and press Enter to install. Esc returns from confirmation or cancels from the list; `q` or Ctrl+C cancels without making changes. Long lists scroll automatically.

Run setup again to change which extensions from this repository are enabled. Unselected extensions will be disabled. Keep this repository in place after setup.

Start Pi, or run `/reload` in an existing session to load your selection.

## Extensions

### skill-manager

A general-purpose manager for packaged task instructions. Tasks are grouped by series and shipped inside the extension, not installed as separate native Skills or prompt templates. Select `skill-manager` during setup to enable its commands.

| Command | Description |
| --- | --- |
| `/tasks` | Open the task picker |
| `/tasks <command> [instructions]` | Run a named task with optional instructions |
| `/review:fix [instructions]` | Check and directly fix current code changes |

```text
/review:fix
/review:fix Focus on state encapsulation and error handling
/tasks review:fix Focus on project conventions
```

`review:fix` checks encapsulation, responsibility boundaries, conventions, correctness, and tests. It performs minimal fixes and verification, preserving existing working-tree edits and staging state. It does not stage or commit automatically, and asks before ambiguous business decisions, breaking changes, or large refactors.

Commands send the task instructions to the current agent; they do not create a separate agent or enforce a workflow state machine. Tasks are explicitly invoked rather than automatically matched. If the agent is busy, the task is queued as a follow-up. Responses follow the user's language.

#### Add a task

```text
packages/skill-manager/tasks/
└── review/
    └── fix/
        ├── TASK.md
        └── references/
            └── checklist.md
```

A task directory contains `TASK.md` with a description and instructions:

```markdown
---
description: Check and directly fix current code changes.
---

Follow the project's conventions. Read references/checklist.md when needed.
```

The directory path defines the command: `review/fix/TASK.md` becomes `/review:fix`. Add other series the same way; no registration code is needed. References and scripts remain local to their task. The agent receives the task directory to resolve relative paths. Use lowercase letters, numbers, and single hyphens for directory names, beginning with a letter. Run `/reload` after changes.

#### Migration from standalone Skills

The old `/skill:review-fix` entry is replaced by `/review:fix`. Setup preselects `skill-manager` when it finds this repository's old `~/.agents/skills/review-fix` link, and removes that exact link only after the extension is successfully enabled. It never removes real skill directories or links to other sources. There is no separate Skill installation or synchronization step.

### codex-bar

Displays remaining Codex quota, reasoning effort (Effort), and Fast mode below the editor when using a Codex model.

| Command | Description |
| --- | --- |
| `/fast on` | Enable Fast mode for subsequent requests |
| `/fast off` | Disable Fast mode for subsequent requests |
| `/fast` | Toggle Fast mode |
| `/fast status` | Show the current Fast status |

Fast mode defaults to off whenever a session starts or reloads. Settings apply only to the current session and do not change reasoning effort. Fast mode availability depends on the model and account, and it may consume more quota.
