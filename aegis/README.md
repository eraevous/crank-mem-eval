# aegis/ — review material for this evaluation copy

Not part of crank-mem; see `../ATTRIBUTION.md`.

- `PROPOSAL.md` — the static review this branch implements (F1–F3) plus the installer, doctor
  and rollback design (section 2, since built; see below). Written before the fixes; the commits on this
  branch carry the implementation and test results.
- `TELOSMITH-TS-SCOPE.md` — what it would take for Telosmith (Zach's requirements traceability
  tool) to link records to TypeScript code.
- `TICKETS.md` — the follow-up tickets (more agents, more operating systems), filed as issues
  #1–#6.
- `probes/` — the original synthetic probes the review ran (Node fs primitives, git in a
  monorepo subdirectory).

Built, all on `main`: F2 (`3aeb6e0`), F3 (`3b776c0`), F1 option A (`8b537c1`); proposal section 2
as `doctor` and a re-runnable, journalled `init` (`6aec30f`) and the one-command, versioned
installer with rollback (`ae95a60`); and ticket A1, the agent adapter interface (PR #14, ADR 0016).
Not built: tickets A2, A3 and B1–B3 (issues #2–#6).
