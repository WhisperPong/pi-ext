# Learning memory

Use the helper's memory directory, rooted at `$PI_CODING_AGENT_DIR/language-practice` or `~/.pi/agent/language-practice`, shared across projects. Keep each target language in a lowercase BCP 47 directory such as `en`, `en-gb`, or `ja`. Reuse the existing language key rather than accidentally splitting its history. Use Pi's file tools for these small Markdown files.

| File | Keep |
| --- | --- |
| `profile.md` | Confirmed native language, preferred target language, usual duration, interests, goals, pace, and correction preferences |
| `<language>/review.md` | Learning points and retrieval history |
| `<language>/lessons/<lesson-id>.md` | Lesson settings, last checkpoint, demonstrated strengths, corrections, review results, next exercise, and active/completed/interrupted state |

Read the profile and selected language's review file before teaching. Read the previous lesson only when needed for continuation. Update the same lesson file at checkpoints without appending the whole transcript. Preserve unrelated entries and other languages. Store no raw audio, credentials, unrelated personal stories, or inferred biography. Use neutral examples when personal details are unnecessary. Honor requests to inspect, correct, or forget memory.

Each review point contains:

- A stable short ID, category (`grammar`, `vocabulary`, `usage`, or `pronunciation`), and learning target.
- The learner's short original example, corrected/natural version, and native-language explanation.
- Evidence source and uncertainty. Record pronunciation only from the voice teacher's explicit audible observation, never from Pi's transcript alone.
- First/last seen dates, last independently tested date, next review date, stage, and latest result (`missed`, `prompted`, or `independent`).

Merge repetitions of the same learning point. A new or missed point is due next lesson, with tomorrow as a suggested date. After independent retrieval on later lessons/dates, space reviews approximately 3, 7, then 14 days apart. A prompted answer or immediate imitation does not advance the stage. A miss resets the interval to next lesson. After two independent successes on separate dates, mark the point consolidating and revisit later rather than claiming permanent mastery. Adapt intervals to the actual lesson schedule.

Choose up to three review points per lesson, prioritizing overdue items, recurring weaknesses, and relevance to the topic. Test with a fresh question before revealing the answer. Save independent successes as well as mistakes. Finish with a focused next-lesson exercise rather than a growing list of everything discussed.

Use the helper's lesson ID and timestamps. Checkpoint as `active`, record `completed` only after a normal finish, and use `interrupted` after an abrupt end. Read back changed files before confirming a save. If persistence fails, preserve the compact record in chat and report the failure.
