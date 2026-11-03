# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

- Require challenge-bound Tempo payments and a shared atomic Durable Object replay
  store, including protection across isolates and runtime restarts.
- Update runtime and development dependencies and regenerate Worker bindings.
- Add local regression coverage for memo validation and concurrent payment replay.
- Initial standalone release preparation for `@cloudflare/mpp-proxy`
