# Add a package

Use this checklist when adding another independently shipped Logseq package.

## Identity and runtime

- [ ] Create `packages/<workspace>/` with a unique package name, Logseq id,
      title, version, entry path, repository URL, description, and keywords.
- [ ] Decide whether the runtime truly needs `effect: true`; document any
      host-origin constraint and keep `package.json` and `manifest.json` equal.
- [ ] Keep the shipped runtime self-contained: no production dependencies,
      compilation, remote imports, network access, or sibling-workspace reads.
- [ ] Namespace host attributes, element ids, style keys, settings, and global
      symbols so install, repaint, and teardown cannot collide with another
      package.

## Package-owned files

- [ ] Add package scripts for `test`, `build`, `verify:release`, and `check`
      using the shared root release scripts.
- [ ] Add focused tests in the workspace. Put only genuinely reusable host or
      archive fixtures under root `test/support/`.
- [ ] Add a package README, changelog, icon, and `THIRD_PARTY_NOTICES.md`; add
      screenshots or other documentation only when they are part of the
      package.
- [ ] Declare the exact package-owned archive allowlist in
      `package.json#release.files`. Do not list root `LICENSE` or
      `lib/lsplugin.user.js`; release tooling adds both.
- [ ] If local-only files help unpacked testing, list only safe paths under
      `release.unpackedLocalFiles`, ignore them, copy them after archiving, and
      add an explicit archive exclusion test.

## Repository integration

- [ ] Confirm workspace discovery, aggregate scripts, and a targeted
      `npm run check --workspace packages/<workspace>` all find the package.
- [ ] Extend infrastructure and archive verification when the package adds a
      new invariant; never weaken exact-member or byte-parity checks.
- [ ] Update the root package table, repository map, contributor documentation,
      architecture notes, and any shared versioned contract.
- [ ] Add package-scoped CI/tag handling using the repository's tag namespace.
      CI may create GitHub release assets; do not describe it as Marketplace
      submission unless a separate audited workflow really performs that step.
- [ ] Decide who owns Marketplace listing creation/update and record the manual
      maintainer step.

## Manual acceptance and validation

- [ ] Run `npm run check` and `git diff --check`.
- [ ] Inspect the ZIP's exact contents and confirm the vendored SDK is present.
- [ ] Load the extracted package into Logseq 0.10.15 with no sibling package,
      then alongside every package with which it shares host surfaces or a
      content contract.
- [ ] Exercise first paint, interactive states, settings changes, repaint,
      reload, and teardown as applicable.
- [ ] Install the ZIP without `npm install`, compilation, or network access and
      complete the repository's issue/linked-branch approval workflow.
