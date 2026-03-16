# Split PR plan (from reviewer feedback)

Work from **current main** (you already merged upstream/main). Restore the old branch only as a **source of files**; each new PR is a **new branch from main** with a small set of changes.

---

## Step 0: Restore the old branch (source of changes)

```bash
cd ~/Desktop/Dreamserver/DreamServer
git fetch origin
git branch old-big-pr origin/installer-docs-tests-compatibility
```

You now have `old-big-pr` with all the previous changes. Do **not** push it or open a PR for it. Use it only to copy files into the new branches.

---

## Step 1: PR 1 — New test suites + CI

**Branch:** `pr1-tests-and-ci`  
**Scope:** The 4 new test scripts + the 4 new CI steps (no docs, no installer, no .env).

```bash
git checkout main
git pull upstream main   # if needed
git checkout -b pr1-tests-and-ci

# Copy only test files and CI workflow changes from old branch
git checkout old-big-pr -- \
  dream-server/tests/test-validate-manifests.sh \
  dream-server/tests/test-health-check.sh \
  dream-server/tests/test-validate-env.sh \
  dream-server/tests/test-cpu-only-path.sh \
  .github/workflows/test-linux.yml

# Commit and push
git add -A
git status   # confirm only those 5 paths
git commit -m "Add test suites (validate-manifests, health-check, validate-env, cpu-only-path) and CI steps"
git push -u origin pr1-tests-and-ci
```

Open PR from `pr1-tests-and-ci` to `upstream/main`. Title: **Add test suites and CI steps for validate-manifests, health-check, validate-env, cpu-only-path**.

---

## Step 2: PR 2 — .env.example + integration test

**Branch:** `pr2-env-and-integration-test`  
**Scope:** .env.example ports + integration-test.sh workflow skip.

```bash
git checkout main
git checkout -b pr2-env-and-integration-test

git checkout old-big-pr -- \
  dream-server/.env.example \
  dream-server/tests/integration-test.sh

git add -A
git commit -m "Add WEBUI_PORT and OLLAMA_PORT to .env.example; skip workflow step when dirs missing"
git push -u origin pr2-env-and-integration-test
```

Open PR. Title: **.env.example ports and integration test workflow skip**.

---

## Step 3: PR 3 — Compatibility matrix (docs)

**Branch:** `pr3-compatibility-docs`  
**Scope:** COMPATIBILITY-MATRIX.md, SUPPORT-MATRIX, PLATFORM-TRUTH-TABLE, check-release-claims wording.

```bash
git checkout main
git checkout -b pr3-compatibility-docs

git checkout old-big-pr -- \
  dream-server/docs/COMPATIBILITY-MATRIX.md \
  dream-server/docs/SUPPORT-MATRIX.md \
  dream-server/docs/PLATFORM-TRUTH-TABLE.md

git add -A
git commit -m "Docs: compatibility matrix and wording for check-release-claims (Windows Tier B, macOS Tier C)"
git push -u origin pr3-compatibility-docs
```

Open PR. Title: **Docs: compatibility matrix and release-claims wording**.

---

## Step 4: PR 4 — Extension catalog + schema docs

**Branch:** `pr4-extension-catalog`  
**Scope:** CATALOG.md, schema/README.md, and optionally the 13 manifest `dream_min` additions.

```bash
git checkout main
git checkout -b pr4-extension-catalog

git checkout old-big-pr -- \
  dream-server/extensions/CATALOG.md \
  dream-server/extensions/schema/README.md

# Optional: include manifest dream_min for all 13 extensions
git checkout old-big-pr -- dream-server/extensions/services/

git add -A
git status
git commit -m "Add extension catalog, schema README, and dream_min for all bundled manifests"
git push -u origin pr4-extension-catalog
```

Open PR. Title: **Extension catalog, schema docs, and compatibility dream_min for manifests**.

---

## Step 5: PR 5 — Installer robustness + scripts + CI fixes

**Branch:** `pr5-installer-and-scripts`  
**Scope:** Phase 04/05/08/01, health-check.sh, preflight jq message, config/n8n/catalog.json, simulate-installers, validate-sim-summary, dream-doctor, script --help, test-tier-map and test-service-registry fixes, INSTALL.md, other docs, TESTING.md, INSTALL-TROUBLESHOOTING.

This is the “everything else” PR. Still one PR, but focused on installer + scripts + “make CI pass” fixes.

```bash
git checkout main
git checkout -b pr5-installer-and-scripts

# Installer phases
git checkout old-big-pr -- \
  dream-server/installers/phases/01-preflight.sh \
  dream-server/installers/phases/04-requirements.sh \
  dream-server/installers/phases/05-docker.sh \
  dream-server/installers/phases/08-images.sh

# Scripts
git checkout old-big-pr -- \
  dream-server/scripts/health-check.sh \
  dream-server/scripts/dream-doctor.sh \
  dream-server/scripts/validate-manifests.sh \
  dream-server/scripts/validate-env.sh \
  dream-server/scripts/simulate-installers.sh \
  dream-server/scripts/validate-sim-summary.py \
  dream-server/scripts/check-compatibility.sh \
  dream-server/scripts/check-release-claims.sh

# Config and test fixes
git checkout old-big-pr -- \
  dream-server/config/n8n/catalog.json \
  dream-server/tests/test-tier-map.sh \
  dream-server/tests/test-service-registry.sh

# Docs (install, testing, troubleshooting, expanded)
git checkout old-big-pr -- \
  dream-server/docs/INSTALL.md \
  dream-server/docs/DREAM-DOCTOR.md \
  dream-server/docs/POST-INSTALL-CHECKLIST.md \
  dream-server/docs/PREFLIGHT-ENGINE.md \
  dream-server/docs/INSTALL-TROUBLESHOOTING.md \
  dream-server/docs/TESTING.md

git add -A
git status
git commit -m "Installer robustness (phase 04/05/08/01), script fixes, config/n8n catalog, test fixes, docs"
git push -u origin pr5-installer-and-scripts
```

Open PR. Title: **Installer robustness, script fixes, config catalog, test fixes, and docs**.

---

## Order to open PRs

1. Open **PR 1** (tests + CI) first — no dependency on others.
2. Then **PR 2** (.env + integration test).
3. Then **PR 3** (compatibility docs).
4. Then **PR 4** (extension catalog).
5. Then **PR 5** (installer + scripts + remaining docs).

If the reviewer wants PR 5 split further (e.g. “installer only” vs “docs only”), you can split again from the same `old-big-pr` source.

---

## Summary

- **Yes:** Work from the **updated repo** (main = upstream/main). You did the right thing merging and deleting the big branch.
- **Yes:** Split into **several small PRs** as requested.
- Use **origin/installer-docs-tests-compatibility** (restored as `old-big-pr`) only to **copy files** into new branches. Each new branch starts from **main** and gets only the files for that PR.
