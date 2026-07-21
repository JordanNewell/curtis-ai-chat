# Image attachments

ObsiBuddi supports vision — drag a screenshot in, paste a photo, or pick from a file. The model reads it and responds.

## Three ways to attach

| Method | How |
|---|---|
| **Drag-and-drop** | Drag any image file onto the chat panel. A dashed accent outline confirms the drop target. |
| **Paste** | `Ctrl+V` while focused in the input box. The image on your clipboard attaches directly. |
| **Paperclip** | Click the paperclip icon to the left of the input box. Opens the OS file picker, multi-select supported. |

Attached images appear as 64×64 thumbnails in a strip above the input. Click the `×` on any thumbnail to remove it before sending.

## Storage

Images are **saved as real files** in your vault's `attachments/` folder (created if missing). Filenames are timestamped (`Pasted image 2026-07-20-15-01-23.png`) and unique.

The conversation stores the **vault path** of each attachment, not the base64 bytes. This keeps `localStorage` small (no quota issues) and makes the images visible, auditable, and reusable in other notes.

At send time, ObsiBuddi reads the bytes back from the vault and encodes them as a base64 data URL for the provider's API.

## Vision-capable models

Look for the **👁 vision** pill in the model picker — that model can read images. Models without it will reject image content.

If you send an image to a non-vision model:
- ObsiBuddi detects the rejection automatically
- Shows a Notice: *"This endpoint rejected the image — retrying as text only"*
- Retries the message with images stripped, so you still get a response

For fully local vision, use **`minicpm-v`** via Ollama.

## Size limits

- **8 MB per image** — larger files are skipped with a Notice
- **Auto-resize cap** — the input textarea grows up to 320px before scrolling internally

For huge images, downscale before attaching. Most providers reject images above ~20 MB anyway.

## Images in transcripts

When you `/save-all` or save a single message as a note, attached images are embedded as Obsidian wikilinks:

```markdown
## 🧑 You

What's in this screenshot?

![[Pasted image 2026-07-20-15-01-23.png]]
```

The saved note renders them inline — same as if you'd pasted them directly into the note.

## Click-to-zoom

In the chat, attached images render at max 180×180 in the user's message bubble. Click to open full-size in Obsidian's native image viewer.
