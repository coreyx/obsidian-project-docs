# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The Project Docs plugin for Obsidian, desktop only, for Obsidian 1.8.7 and later:
  - **Private notes:** notes created in, moved into or copied into a project's private folder are marked `project-docs: private`, and keep the marker wherever they're moved.
  - **Private attachments:** where attachment sync is on, attachments in the private folder are recorded by path and content hash in `.project-docs/private-files.json`, and followed through renames and edits.
  - **Sync rules with the mouse:** from the file menu, the status bar or the note's header. Making a private note syncable asks first, and records the answer so VS Code doesn't ask again.
  - **Sync status:** in the status bar, with a banner on any note the sync has a problem with.
  - **Decoded view:** a note shown with its real values from the repo's PRIVATE.md, read-only, in the same tab, including footnotes, properties and embedded notes. Nothing partly decoded is ever shown.
