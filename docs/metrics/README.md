# Download metrics

Growth tracking for Curtis AI Chat on the Obsidian community plugin directory.
`downloads.csv` in this folder is the append-only record; the north-star metric
is **weekly downloads** (the delta between consecutive snapshots).

## What is tracked

One CSV row per UTC day, appended by [`scripts/fetch-plugin-stats.mjs`](../../../scripts/fetch-plugin-stats.mjs):

| Column               | Meaning                                                        |
| -------------------- | -------------------------------------------------------------- |
| `date`               | Snapshot date (UTC)                                            |
| `downloads`          | **Cumulative** marketplace downloads (all versions)            |
| `version_downloads`  | Downloads attributable to the current `manifest.json` version  |
| `plugin_version`     | `manifest.json` version at snapshot time                       |
| `plugin_updated_utc` | When Obsidian last refreshed the plugin's stats entry          |

Weekly downloads for a given snapshot = `downloads` that day minus `downloads`
on the previous row. Total downloads are cumulative, so the weekly delta — not
the raw number — is what the growth plan is measured against.

## Where the data comes from

Obsidian's official plugin stats, published by the plugin directory itself:

- [`obsidianmd/obsidian-releases` → `community-plugin-stats.json`](https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json)
  — keyed by plugin id; each entry carries the cumulative `downloads` total, an
  `updated` timestamp, and per-version download counts.

Note: `community-plugins.json` in the same repo is metadata only (no download
counts), and `obsidian.md/plugins` is an SPA without a JSON API. The numbers
here match what Obsidian shows on the plugin's directory page.

## How it updates

[`.github/workflows/track-downloads.yml`](../../../.github/workflows/track-downloads.yml)
runs every **Monday at 06:00 UTC** (plus manual `workflow_dispatch` runs),
fetches the stats, appends a row, and commits the CSV back to `master` as
`chore(metrics): weekly download snapshot`. Runs are idempotent per day and
skip the commit when there is no new data.

## Baseline and target

- **Baseline:** 284 total downloads on 2026-10-08.
- **North-star metric:** weekly downloads.
- **Target:** 2,500+ total downloads by the end of Week 6 of the growth plan
  (~9x the baseline, roughly +370/week sustained).
