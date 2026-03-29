# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning as a working convention.

## [0.2.1] - 2026-03-29

### Changed
- Clarified that `dataDir` is application-owned and that `message.downloadMedia(destination)` resolves relative paths inside that directory.
- Expanded the README examples to show explicit `dataDir` configuration for applications that want stable media storage behavior.

### Fixed
- Added test coverage for relative media download destinations resolved against the configured root directory.

## [0.2.0] - 2026-03-29

### Added
- Added `demo:echo-bot` and expanded the runnable demo set for common WeChat integration scenarios.

### Changed
- Refined the README and package metadata to better position the SDK for AI Agent, automation, and business workflow integration in WeChat.

### Fixed
- Improved built-in help guidance in the multi-account and OpenAI doc assistant demos.

## [0.1.0] - 2026-03-28

### Added
- Initial public release of the AgentLink WeChat TypeScript SDK.
- Added QR login, session persistence, long polling, text replies, media transfer, and multi-account support.
- Added runnable demos covering echo replies and an OpenAI-powered local documentation assistant.

