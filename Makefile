# Cachelog: everyday commands. Run `make` to list them.
#
#   make update              build and install on the iPhone plugged in by USB (unlocked)
#   make update DEVICE=<id>  a particular phone when several are connected (see `make devices`)
#   make sim SIM="iPhone 17" a simulator instead
#
# The ios/ folder is generated (Expo prebuild). `make update` regenerates it by itself when
# app.json or the packages changed, so you never edit it by hand.

DEVICE ?=
SIM    ?= iPhone 17

# CocoaPods needs a UTF-8 locale; CI=1 keeps Expo from asking questions.
export LANG := en_US.UTF-8
export LC_ALL := en_US.UTF-8
export CI := 1

EXPO := npx expo
PREBUILD_STAMP := ios/.cachelog-prebuild
# The phone to install on: DEVICE, else the first connected physical iPhone. Sets $$d.
FIND_PHONE = d="$(DEVICE)"; \
	if [ -z "$$d" ]; then \
	  d=$$(xcrun devicectl list devices 2>/dev/null | grep physical | grep -v unavailable | grep -oE '[0-9A-F]{8}-[0-9A-F]{16}|[0-9a-f]{40}' | head -1); \
	fi; \
	if [ -z "$$d" ]; then echo "No iPhone connected. Plug it in by USB, unlock it, and run make again ('make devices' lists what's visible)."; exit 1; fi; \
	case "$$(xcrun devicectl list devices 2>/dev/null | grep "$$d")" in *unavailable*|"") echo "Phone $$d isn't reachable. Plug it in by USB and unlock it."; exit 1;; esac

# Anything that changes the native project: when one is newer than the stamp, prebuild again.
NATIVE_INPUTS := app.json package.json package-lock.json $(wildcard modules/*/expo-module.config.json modules/*/ios/*.podspec)

.DEFAULT_GOAL := help
.PHONY: help setup update phone-dev sim dev check test typecheck bundle doctor devices prebuild clean reset-native push

help: ## List the commands
	@echo "Cachelog commands:"
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  make %-13s %s\n", $$1, $$2}'

setup: ## Install packages (after cloning or pulling new ones)
	npm install

# ---------------------------------------------------------------- on a phone or simulator

update: $(PREBUILD_STAMP) ## Build the app and install it on your iPhone (Release, no laptop needed afterwards)
	@$(FIND_PHONE); echo "Installing on $$d"; \
	$(EXPO) run:ios --device "$$d" --configuration Release --no-bundler \
	|| { echo "If the error says the device is locked, the install still worked: unlock the phone and open Cachelog."; exit 1; }

phone-dev: $(PREBUILD_STAMP) ## Debug build on your iPhone, live-reloading from this Mac (same Wi-Fi)
	@$(FIND_PHONE); $(EXPO) run:ios --device "$$d"

sim: $(PREBUILD_STAMP) ## Build and open the app in the iOS simulator (SIM="iPhone 17")
	$(EXPO) run:ios --device "$(SIM)" --configuration Release --no-bundler

dev: ## Start the dev server for a debug build already on the phone
	$(EXPO) start

devices: ## List phones and simulators with their IDs
	@xcrun devicectl list devices

# ---------------------------------------------------------------- checks

check: typecheck test bundle ## Everything below: typecheck, tests, and the app bundles

test: ## Unit tests
	npx jest

typecheck: ## TypeScript errors
	npx tsc --noEmit

bundle: ## Confirm the iPhone app bundles (catches import errors tests miss)
	@rm -rf "$${TMPDIR:-/tmp}/cachelog-export"
	$(EXPO) export --platform ios --output-dir "$${TMPDIR:-/tmp}/cachelog-export" > /dev/null
	@rm -rf "$${TMPDIR:-/tmp}/cachelog-export"
	@echo "Bundle OK"

doctor: ## Expo's check for package and config problems
	npx expo-doctor

# ---------------------------------------------------------------- native project

$(PREBUILD_STAMP): $(NATIVE_INPUTS)
	$(EXPO) prebuild --platform ios
	@touch $(PREBUILD_STAMP)

prebuild: ## Regenerate ios/ from app.json now (normally automatic)
	$(EXPO) prebuild --platform ios
	@touch $(PREBUILD_STAMP)

clean: ## Delete Xcode's build cache for Cachelog (next build is slower)
	rm -rf ~/Library/Developer/Xcode/DerivedData/Cachelog-*

reset-native: ## Throw away ios/ and generate it fresh (when a build is stuck)
	rm -rf ios
	$(MAKE) prebuild

# ---------------------------------------------------------------- GitHub

push: check ## Run the checks, then push your committed work to GitHub (not from main)
	@branch=$$(git rev-parse --abbrev-ref HEAD); \
	if [ "$$branch" = "main" ]; then echo "You're on main. Make a branch first: git switch -c my-change"; exit 1; fi; \
	if [ -n "$$(git status --porcelain --untracked-files=no)" ]; then echo "Note: uncommitted changes are not pushed (git status shows them)."; fi; \
	git push -u origin "$$branch"
