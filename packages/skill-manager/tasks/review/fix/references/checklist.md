# Change Review Checklist

Select checks according to risk; do not report every item mechanically. Ground each finding in concrete code, a triggering scenario, and an impact.

## Encapsulation and Responsibilities

- Do modules, functions, and types have clear responsibilities? Are business policy, data access, and presentation unnecessarily coupled?
- Do public mutable state, internal data structures, or excessive parameters leak implementation details? Must callers know internal execution order to use an interface correctly?
- Who creates, updates, and cleans up state? Are there multiple sources of truth, implicit shared state, or inconsistent lifecycles?
- Does a new abstraction address real duplication or a concrete point of variation? Does it introduce pass-through layers, combinations of boolean flags, catch-all utility classes, or hard-to-follow indirection?
- Does duplicated code represent the same business rule that must stay synchronized? Do not merge semantically different logic merely because it looks similar.
- Does the change reuse existing project capabilities? Does a new public API have real external callers, or could it remain local?
- Do the refactoring benefits outweigh migration costs? Do not make large refactors unrelated to the current behavior a condition for merging.

## Correctness and Edge Cases

- Are branch conditions, defaults, null and zero values, invalid inputs, and boundary indices handled correctly? Do error paths preserve necessary information?
- Do return values and types match runtime data? Does the code rely on unchecked type assertions?
- Does the change affect existing APIs, configuration, serialization formats, or default behavior? Are callers and existing data still compatible?
- Can asynchronous flows produce races, duplicate handling, stale-response overwrites, ineffective cancellation, or invalid ordering assumptions?
- Are retries, repeated calls, and partial failures safe? Do cleanup, subscriptions, timers, and resource release cover failure and shutdown paths?
- Do new caches have correct keys, expiration, and invalidation? Do they accidentally share state across users or sessions?

## Project Conventions and Maintainability

- Do naming, directory layout, exports, dependency direction, and error handling follow project instructions and stable conventions in nearby code?
- Does the change satisfy existing type-checking, formatting, lint, and build constraints? Distinguish explicit requirements from personal preferences.
- Do comments explain constraints and reasoning? Are any inconsistent with the implementation, outdated, or missing critical assumptions?
- Are new configuration, public behavior, and usage reflected in relevant documentation? Does the change add unnecessary dependencies or edit generated files inappropriately?
- Is critical logic testable, and can failures be diagnosed? Do not introduce a framework without a concrete need merely for testability.

## Security and Performance

- Is external input validated appropriately? Are permission, tenant, and user boundaries preserved?
- Does the change introduce command, path, query, or template injection? Can credentials or sensitive information enter logs, responses, or version control?
- Do hot paths introduce redundant computation, unbounded collections, duplicate network requests, full scans, or blocking operations?
- Raise performance issues only with concrete evidence about scale, call frequency, or complexity. Do not demand speculative optimization.

## Tests and Verification

- Do tests cover the behavior changes, important edge cases, and failure paths rather than merely restating the implementation?
- Can assertions catch real regressions? Do mocks conceal actual protocol, type, or lifecycle constraints?
- Do tests depend on unstable timing, network access, execution order, or shared state?
- Are changed test expectations justified by requirements, or do they accommodate an incorrect implementation?
- When tests are missing, identify the specific risk scenario left uncovered. Do not infer a defect solely from a coverage percentage.
