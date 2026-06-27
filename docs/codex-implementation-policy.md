# Codex Implementation Policy

This document is the shared working agreement for Codex agents developing KunoChat on Windows and macOS.

## Purpose

- Keep Windows and macOS work coordinated.
- Make OS-specific changes visible before they are merged.
- Preserve shared application behavior unless a platform difference is intentional.
- Leave enough context for the other Codex agent to continue safely.

## Branches

- `main`: stable shared code and project documentation.
- `codex/windows`: Windows implementation and verification work.
- `codex/macos`: macOS implementation and verification work.

Platform-specific branches should regularly pull or merge from `main`.

## Shared Implementation Rules

- Prefer shared code for behavior that should be identical on Windows and macOS.
- Isolate OS-specific behavior behind clearly named modules, helpers, or configuration.
- Do not change shared behavior for one OS without noting the reason in this document or the sync log.
- Keep changes small enough that the other platform can review and test them.
- Avoid broad refactors while working on platform-specific fixes unless the refactor is required.

## Required Notes Before Finishing Work

Before ending a work session, each Codex agent should update the sync log below.

Each entry should include:

- Date and timezone.
- Branch name.
- What changed.
- What was verified on the actual OS.
- Known issues or follow-up work.
- Files or areas likely to affect the other platform.

## Sync Log

### Template

```md
### YYYY-MM-DD HH:mm TZ - Windows|macOS

- Branch:
- Summary:
- Verified:
- Possible impact on other OS:
- Follow-up:
```

### 2026-06-27 12:21 JST - macOS

- Branch: `main`
- Summary: Installed the published `v0.3.1` macOS release from `KunoChat_0.3.1_universal.dmg` into `/Applications/KunoChat.app`.
- Verified: `/Applications/KunoChat.app` launches, `Info.plist` reports `0.3.1`, the app window renders with the native macOS title bar, and native services listen on TCP `8787` and `8790`.
- Possible impact on other OS: None from this doc-only note. Windows should install `KunoChat_0.3.1_x64-setup.exe` and verify pairing against the same release.
- Follow-up: If pairing remains stuck, use Settings -> Pairing -> Forget paired peer on both machines, then pair again so regenerated device keys are trusted.

## Current Work

### Windows Codex

- Branch: `codex/windows`
- Current task:
- Status:
- Blockers:

### macOS Codex

- Branch: `codex/macos`
- Current task:
- Status:
- Blockers:

## Merge Expectations

- Merge platform branches into `main` only after the relevant OS has been tested.
- If a change affects shared code, the other OS should review or test it before final merge when practical.
- If Windows and macOS need different behavior, document the difference and keep it explicit in code.

## Conflict Resolution

- Prefer preserving shared behavior and adding small OS-specific handling.
- If both branches changed the same area, compare intent before choosing either version.
- When uncertain, write the open question in the sync log instead of guessing silently.
