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
| `/project:touch [instructions]` | Concisely map project structure, architecture, business, and key data flows |
| `/language:practice [preferences]` | Start a voice language lesson with corrections and learning memory |

```text
/review:fix
/review:fix Focus on state encapsulation and error handling
/tasks review:fix Focus on project conventions
/project:touch
/project:touch Focus on order processing and persistence
```

`review:fix` checks encapsulation, responsibility boundaries, conventions, correctness, and tests. It performs minimal fixes and verification, preserving existing working-tree edits and staging state. It does not stage or commit automatically, and asks before ambiguous business decisions, breaking changes, or large refactors.

`project:touch` provides a read-only overview of the current project, or a specified subdirectory or business scenario. It highlights core module responsibilities, architecture boundaries, one or two key business/data flows, and a few source entry points. The default is roughly one screen, without exhaustive file listings or code changes; unverified behavior is explicitly marked.

#### Voice language lessons

`language:practice` uses [pi-gpt-voice](https://pi.dev/packages/pi-gpt-voice) for realtime audio. Install it once with `pi install npm:pi-gpt-voice`, then run `/reload`. Voice uses its ChatGPT login or an existing `openai-codex` login; use `/voice login` and `/voice setup` if needed. This repository's setup enables `skill-manager`; it does not install the optional voice dependency.

```text
/language:practice English, native Mandarin, 20 minutes, job interviews
```

After the task prepares the lesson, run `/voice realtime` in the same session and trusted project directory. You can omit preferences and settle them through conversation. The teacher reuses memory, develops the topic gradually, speaks the target language, and explains corrections in your native language. Pronunciation feedback requires audible speech. Grammar, vocabulary, usage, and pronunciation review points are saved locally and revisited in later lessons.

Memory lives in `~/.pi/agent/language-practice` (or under `PI_CODING_AGENT_DIR`), with a profile, separate review notes per language, and lesson records. The task temporarily adds a block to `.pi/REALTIME-SYSTEM-PROMPT.md` and removes it on normal completion, preserving other prompt content. A disconnected lesson retains its last saved checkpoint; invoke `/language:practice` again to recover. Say you want to end the call to save and stop, or use `/voice stop` for an immediate stop. Duration is checked during conversation rather than enforced by an exact cutoff. For manual prompt cleanup, run `node packages/skill-manager/tasks/language/practice/scripts/lesson.mjs finish` from the lesson's directory using the script's absolute path if it is outside this repository.

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

### study-mode

An interactive tutor for planning a learning path and working through it in Pi. Select `study-mode` during setup, then run `/study <topic>` or just `/study`. Answer, confirm a plan, ask for the next lesson, or pause in plain language. The tutor uses the same lesson, quiz, gap review, and assessment workflows as the individual modes below.

```text
/study Large language models. I know Python and can study five hours a week.
```

Study checkpoints are saved separately under `~/.study/`, one JSONL journal per topic. They include the confirmed plan, completed work, quiz results, gaps, and the next pending question or activity. Back up this directory to keep the checkpoints. In a fresh Pi session, run `/study` to resume a saved topic, or `/study <new topic>` to start another. With multiple topics, the interactive picker lets you choose. Checkpoints carry learning progress into the new session. The full conversation stays in Pi's own session history.

Use `/study <mode> [details]` when you want to open one activity directly.

| Mode | What it does |
| --- | --- |
| `roadmap` | Assess your starting point and propose a roadmap with practical milestones |
| `plan` | Turn one level into a sequence of lessons and exercises |
| `lesson` | Teach one concept at a time and let you practice |
| `quiz` | Check a lesson, score answers, and identify gaps |
| `feynman` | Work through one gap using a teach-back exercise |
| `sheet` | Create a five-minute reference for a level |
| `project` | Define a deliverable and review your work against the criteria |
| `exam` | Assess a whole level and identify what to review next |

```text
/study roadmap Large language models. I know Python and can study five hours a week.
/study lesson Self-attention
/study quiz The self-attention lesson
```

When your goal is clear, the roadmap starts with a concrete placement question. Pi asks one question at a time and uses your answers to explain where you should start and what you can skip. It fills in any missing scheduling or practice preferences before proposing a two- to six-level roadmap, five ordered resources, and about 20 hours of hands-on lessons for your starting level by default. Your weekly availability determines the calendar estimate. Pi waits for your confirmation before settling the plan.

The prompts are written in English and the tutor replies in your language.
