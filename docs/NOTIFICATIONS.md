# Desktop notifications

> Curtis pings you when a response lands — even after you've moved on.

Two toggles under **Settings → Curtis AI → Chat UI**, both **off by default**:

| Setting | What it does |
|---|---|
| **Notify when responses complete** | A system notification when a response finishes. |
| **Notify when requests fail** | The same for failed requests — the completions toggle covers successes only. |

## Behavior

- **Only when you're away.** A notification fires only when the chat pane that made the request isn't visible — watching the response stream never triggers one. Aborted runs stay silent.
- **What it says.** The title is `Curtis — <conversation title>`; the body is the first ~120 characters of the response with markdown stripped (failures say the request failed instead). [Arena](ARENA.md) rounds get one notification for the whole round — "Arena round finished (model · model)" — not one per column.
- **Click to jump back.** Clicking the notification focuses the Obsidian window and reveals the exact chat pane it came from — including across popout windows ([MULTIPANE.md](MULTIPANE.md)).
- **Permission.** Turning a toggle on requests notification permission once. If the OS has them blocked, Curtis says so and points at your system notification settings.

## Fallbacks

System notifications need the web Notification API, which desktop Obsidian provides. On mobile — or on a desktop where the permission was denied — the same message surfaces as an in-app Obsidian notice instead, so the toggles never do nothing.

## Privacy

Notification content is rendered locally from the response text. This feature sends nothing anywhere.
