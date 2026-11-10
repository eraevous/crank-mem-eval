# Scope: TypeScript support in Telosmith code linking

**Status:** scoping only. No Telosmith code was changed.
**Prepared by:** ABI builder lane (Claude Opus 5.5), 2026-11-10.
**Read:** `eraevous/Telosmith` at `f4f16d3`.

## Where things stand

- **The language-neutral half already exists [read].**
  - Snapshots are JSON lines: a header, then edges `{kind, src, dst, resolved, file, line}`.
  - Kinds are `defines`, `imports`, `inherits`, `calls` and `references`.
  - `defines` carries `body_sha`, and the header holds a `modules` map.
  - `edges.diff`, `code_impact`, `reach`, `fan` and `check --edges` work only on that format
    and on dotted symbol names.
- **The Python-specific half is one function [read].**
  - `edges.extract()` drives `_Extractor` (`src/aec/edges.py`, about 470 lines of `ast` code).
  - It walks `*.py`, resolves imports and calls, and hashes each definition's AST.
  - `snapshots.py` records the extraction `method` in the header, and `diff` refuses to compare
    snapshots whose methods differ.
- **So for crank-mem today:**
  - Records, `check` and `impact` work.
  - `implemented_by → code:<symbol>` can be written, but no snapshot will contain TypeScript
    symbols. Edits are therefore never flagged, and `check --edges` reports those references
    as dangling.

## The design question (Telosmith's owner decides)

Telosmith is **standard-library Python with no dependencies**, which rules out bundling a
TypeScript parser. Three options:

| Option | How | Keeps stdlib-only | Accuracy | Effort |
|---|---|---|---|---|
| **A. External extractor protocol** (recommended) | `aec edges --extractor "<cmd>"` runs a program that prints a snapshot in the existing format. Telosmith validates and stores it, and the method header records the extractor and its version. Ship a reference TypeScript extractor, written in TypeScript on the compiler API, run by bun or node | Yes; the parser lives in the target's own toolchain | High: the real TS compiler, including type-aware call resolution where wanted | Medium |
| B. Optional `tree-sitter` dependency | `pip install telosmith[ts]` | No (optional extra) | Syntax-level; no type resolution | Medium |
| C. Lexical extractor in Python | Regexes for `function`, `class`, `export` and arrow constants | Yes | Low: brittle on generics and overloads; no calls | Small, but a dead end |

**Why A:** it fits the existing extension-point style (Telosmith already reads snapshots it
didn't produce, such as git revisions). Every future language is then an extractor, not a
change to Telosmith's core. crank-mem already pins `typescript` as a dev dependency, so the
reference extractor costs it nothing.

## Specification for option A

1. **Protocol**
   - The extractor gets the repo root and the ignore list as arguments.
   - It prints the header line (`aec_edges: 1`, `tool_version`, `files`, `files_sha`,
     `modules`, `skipped`), then one edge per line.
   - Telosmith adds `method.extractor = {name, version, command_sha}`.
   - A schema violation is an error, never a partial import.
2. **Symbol names**
   - Dotted module paths, matching Python's convention:
     `src/hooks/lib/scanner.ts → src.hooks.lib.scanner`, with symbols such as
     `src.hooks.lib.scanner.indexFile`.
   - Class members become `Class.method`.
   - A default export becomes `<module>.default`.
   - `index.ts` acts like `__init__`.
3. **`body_sha`**
   - Hash the printer output of the declaration node (`ts.createPrinter({removeComments: true})`),
     so formatting and comments don't count as changes, matching Python's
     `ast.dump(include_attributes=False)`.
4. **Edges, in two phases**
   - **Phase 1:** `defines` and `imports` only, resolving ES module specifiers relative to the
     file. Re-exports become `imports`.
     - This is already enough for the main use: "the function a requirement is
       `implemented_by` changed, so flag the requirement".
   - **Phase 2:**
     - `calls` resolved through import bindings and `this.`
     - `inherits` from `extends` and `implements`
     - anything else as an unresolved `?expr`, with a reason, never guessed

     Dynamic `import("./x.ts")` with a literal resolves. Computed specifiers stay unresolved
     (crank-mem's command table in `src/cli/main.ts` is the test case).
5. **Ignore defaults:** `node_modules`, `dist` and `build`, plus `.d.ts` files unless asked.

## Effort and testing (estimates)

| Piece | Rough size |
|---|---|
| Protocol + validation + method header in Telosmith | small (1–2 days) |
| Reference extractor, phase 1 | small (1–2 days) |
| Phase 2 call resolution | about a week |
| Tests | golden snapshots for a fixture project; crank-mem at `2d72f6c` as a real corpus, kept out of the Telosmith repo because it has no license |

## Ramifications

- **What changes:** TypeScript projects, crank-mem among them, gain Telosmith's main feature.
  An edit to a function a requirement names flags that requirement and the claims resting on
  it. The Claude Code hook would also start catching those edits.
- **What doesn't:** Telosmith's Python core, record format, impact rules and stdlib-only
  install all stay as they are. Python extraction is untouched.
- **Counterfactual:** without this, the crank-mem copy keeps records only, and the
  requirements' code links are prose rather than checked references.
- **Can it wait?** Yes. The crank-mem fixes don't depend on it, and the records are already
  useful for review.
- **What depends on it:** any future non-Python Kairos package that wants checked code links,
  and the protocol decision, which belongs to the Telosmith lane or to Zach.
