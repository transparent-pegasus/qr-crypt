# Verification and local-preview targets. Every node execution goes through
# `aube run <script>` — npm is forbidden in this repo.
#
# The check targets are the commands declared in CLAUDE.local.md's
# `Herdrpowers Configuration`; keep the two in step when either changes.

.DEFAULT_GOAL := check

# BASELINE_VERIFICATION_COMMAND
.PHONY: check
check:
	aube run typecheck
	aube run lint
	aube run test

# FULL_TEST_SUITE_COMMAND
.PHONY: test-all
test-all:
	aube run test
	aube run test:e2e

# TARGETED_TEST_COMMAND: make test-one FILE=tests/ui/keys-settings.test.tsx
.PHONY: test-one
test-one:
	@test -n '$(FILE)' || { echo 'usage: make test-one FILE=tests/ui/keys-settings.test.tsx'; exit 1; }
	aube run test -- $(FILE)

# What a UI change owes: baseline plus the e2e suite.
.PHONY: check-ui
check-ui: check e2e

# SUPPLEMENTAL_VERIFICATION_COMMANDS — run the ones the change actually touches.
.PHONY: e2e
e2e: # UI changes
	aube run test:e2e

.PHONY: build
build: # vite / env changes
	aube run build

.PHONY: build-prod
build-prod: # .env.prod changes
	aube run build:prod

# Narrow subsets for fast feedback during protocol work; `check` covers them too.
.PHONY: pq
pq:
	aube run test:pq
	aube run test:pq-vectors
	aube run test:qr-multipart

# The pair playwright.config.ts boots for e2e: the production bundle behind the
# header-aware static server, so `_headers` / `_redirects` behave as the deployed
# origin does. Serves on :4173 until interrupted.
.PHONY: serve-prod
serve-prod:
	aube run build:prod
	aube run serve:dist

# Vite dev server on this checkout (hot reload); the served preview at
# qr-crypt.local is a different thing — see fresh-local below.
.PHONY: dev
dev:
	aube run dev

# Refresh the preview worktree that caddy-server serves at qr-crypt.local
# (see /mnt/ssd1/repos/caddy-server/sites.yaml: working_dir .worktrees/local,
# build_command `aube run build`). Detached checkout, so REF may be checked out
# in another worktree at the same time.
#
#   make fresh-local                                  # origin/dev
#   make fresh-local REF=feat/scanner-and-decrypt-icons

REF ?= dev
LOCAL := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))/.worktrees/local

.PHONY: fresh-local
fresh-local:
	@test -z "$$(git -C '$(LOCAL)' status --porcelain --untracked-files=no)" \
		|| { echo 'refusing: $(LOCAL) has uncommitted changes - commit or discard them first'; exit 1; }
	git fetch origin $(REF)
	git -C '$(LOCAL)' checkout --detach origin/$(REF)
	cd '$(LOCAL)' && aube run build
