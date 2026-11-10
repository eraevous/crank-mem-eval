# aegis/ — review material for this evaluation copy

Not part of crank-mem; see `../ATTRIBUTION.md`.

- `PROPOSAL.md` — the static review this branch implements (F1–F3) plus the installer, doctor
  and rollback design (section 2, not yet built). Written before the fixes; the commits on this
  branch carry the implementation and test results.
- `TELOSMITH-TS-SCOPE.md` — what it would take for Telosmith to link records to TypeScript code.
- `probes/` — the original synthetic probes the review ran (Node fs primitives, git in a
  monorepo subdirectory).

Built so far: F2 (`3aeb6e0`), F3 (`3b776c0`), F1 option A (`8b537c1`). Not built: the guided
installer, `doctor` and transactional `init` (proposal section 2).
