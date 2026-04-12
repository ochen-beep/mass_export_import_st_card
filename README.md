# ZIP Character Backup

SillyTavern extension for bulk export and import of character cards via ZIP.

## Installation

Extensions → Install extension → paste this repository URL:
```
https://github.com/ochen-beep/ZIP-character-backup
```

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

## Credits

Original extension by **aceenvw**, reworked by **ochen-beep**
