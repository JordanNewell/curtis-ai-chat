// Inline the empty-state logo variants into src/styles.css as data URIs:
//   assets/logo-square.jpg        -> dark theme  (.ai-chat-empty-icon)
//   assets/logo-square-light.jpg  -> light theme (.theme-light override)
// Idempotent per variant: each is inserted via its __CURTIS_LOGO_DATA_URI__*
// placeholder, or by replacing the URI inside its OWN CSS rule (scoped by
// selector — never "first match", which can clobber the other slot).
// Run after scripts/logo-crop.ps1.
import { readFileSync, writeFileSync } from 'fs';

const dark = 'data:image/jpeg;base64,' + readFileSync('assets/logo-square.jpg').toString('base64');
const light = 'data:image/jpeg;base64,' + readFileSync('assets/logo-square-light.jpg').toString('base64');
let css = readFileSync('src/styles.css', 'utf8');

// Replace the data URI inside the rule opened by `selector`.
function inlineVariant(uri, placeholder, selector) {
  if (css.includes(placeholder)) {
    css = css.replace(placeholder, uri);
    return 'placeholder';
  }
  // Find the selector as an actual rule opener: preceded by a newline (rules
  // live at column 0) and followed by `{`. The name otherwise also matches
  // inside comments, the media query, and the .theme-light selector itself.
  let braceOpen = -1;
  let pos = 0;
  for (;;) {
    const idx = css.indexOf(selector, pos);
    if (idx === -1) break;
    const atLineStart = idx === 0 || css[idx - 1] === '\n';
    if (atLineStart && /^\s*\{/.test(css.slice(idx + selector.length))) {
      braceOpen = css.indexOf('{', idx + selector.length);
      break;
    }
    pos = idx + selector.length;
  }
  if (braceOpen === -1) return null;
  const braceClose = css.indexOf('}', braceOpen);
  const chunk = css.slice(braceOpen, braceClose);
  if (!chunk.includes("url('data:image/jpeg;base64,")) return null;
  const updated = chunk.replace(/url\('data:image\/jpeg;base64,[^']+'\)/, `url('${uri}')`);
  css = css.slice(0, braceOpen) + updated + css.slice(braceClose);
  return 'replaced';
}

const howDark = inlineVariant(dark, '__CURTIS_LOGO_DATA_URI__', '.ai-chat-empty-icon');
const howLight = inlineVariant(light, '__CURTIS_LOGO_DATA_URI_LIGHT__', '.theme-light .ai-chat-empty-icon');
if (!howDark || !howLight) {
  console.error(`could not inline dark=${howDark} light=${howLight} — check src/styles.css`);
  process.exit(1);
}
writeFileSync('src/styles.css', css);
console.log(`inlined dark (${howDark}) + light (${howLight}); styles.css now ${css.length} bytes`);
