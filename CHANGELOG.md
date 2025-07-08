# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Configurable Nostr relay connections via environment variables (`NOSTR_RELAY_MODE`, `NOSTR_LOCAL_RELAYS`, `NOSTR_REMOTE_RELAYS`). This allows switching between local and remote relay sets without code changes.
- Conditional Proof of Work for Nostr events: PoW is now skipped if `NOSTR_RELAY_MODE` is set to `local`, even if `POW_BITS` is configured.
