# Export / Import Cards ZIP

SillyTavern extension for bulk export and import of character cards via ZIP.

## Installation

Extensions → Install extension → paste this repository URL.

## Usage

### Export
1. Choose duplicate policy: **Auto-rename** or **Skip**
2. Click **Export All as ZIP** — all characters are packed into a single ZIP and downloaded

### Import
1. Choose duplicate policy: **Auto-rename**, **Skip**, or **Import anyway**
2. Click **Import from ZIP** and select your `.zip` file
3. Confirm the dialog — cards are imported one by one with a live progress bar

Both operations can be cancelled mid-way. If any cards fail, a **Download log** button appears with details.

## Duplicate policies

| | Auto-rename | Skip | Import anyway |
|---|---|---|---|
| **Export** | Adds ` (2)`, ` (3)` … | Skips the card | — |
| **Import** | Renames incoming card | Skips if name exists | Always imports |

## Changelog

### v1.3.1
- Fix: cards now actually save — missing `file_type` field was causing all imports to fail with HTTP 400
- Fix: character list now refreshes correctly after import

### v1.3.0
- Added Import from ZIP
- Added cancellation and error logs

## Credits

Original extension by **aceenvw**
