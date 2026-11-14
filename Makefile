.PHONY: release

# make release v0.0.2
# Sets the version in package.json, tauri.conf.json and Cargo.toml (plus
# lockfiles), commits, tags and pushes. The tag starts the Release workflow.
release:
	@node scripts/release.mjs $(word 2,$(MAKECMDGOALS))

# Treat the version after `release` as an argument, not a target.
ifeq (release,$(firstword $(MAKECMDGOALS)))
  RELEASE_VERSION := $(word 2,$(MAKECMDGOALS))
  ifneq ($(RELEASE_VERSION),)
$(RELEASE_VERSION):
	@:
  endif
endif
