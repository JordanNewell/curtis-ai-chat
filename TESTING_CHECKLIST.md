# Obsidian Multi-Provider AI Plugin - Testing Checklist

## Build Verification
- [x] TypeScript compilation successful
- [x] esbuild bundling successful
- [x] main.js generated (172K)
- [x] No TypeScript errors
- [x] No esbuild warnings

## Pre-Installation Checks
1. **Backup your vault** before testing
2. Ensure Obsidian version >= 0.15.0
3. Close any other AI plugins to avoid conflicts

## Installation Test
- [ ] Copy `obsidian-glm-plugin` folder to vault plugins
- [ ] Enable plugin in Obsidian Settings > Community Plugins
- [ ] Verify plugin appears in installed plugins list
- [ ] Check for any console errors (Ctrl+Shift+I)

## Basic Feature Tests (Free Features)

### Provider Configuration
- [ ] Open plugin settings
- [ ] Select GLM provider
- [ ] Enter GLM API key
- [ ] Verify model selection dropdown works
- [ ] Test Claude provider (if API key available)
- [ ] Test Gemini OAuth (if credentials available)

### AI Chat
- [ ] Click ribbon icon to open AI Chat
- [ ] Send a test message
- [ ] Verify streaming response works
- [ ] Check token usage notice appears
- [ ] Verify conversation history is maintained
- [ ] Test clear chat button

### Selection Processing
- [ ] Create a test note with some text
- [ ] Select text and use "Generate text from selection" command
- [ ] Select text and use "Summarize selection" command
- [ ] Select text and use "Explain selection" command
- [ ] Select text and use "Improve writing" command
- [ ] Select code and use "Explain code" command
- [ ] Select code and use "Review code" command

### Conversation Management
- [ ] Open conversation history modal
- [ ] Verify search functionality
- [ ] Test filtering by tag
- [ ] Try starring a conversation
- [ ] Try deleting a conversation
- [ ] Export a conversation to Markdown

### Templates
- [ ] Open templates modal
- [ ] Browse through template categories
- [ ] Use a template in AI chat
- [ ] Verify template variables are replaced

### Statistics
- [ ] Open usage statistics modal
- [ ] Verify total cost tracking
- [ ] Check per-provider statistics
- [ ] Test budget limit warning (set a low limit)

## Premium Feature Tests

### Enable Premium Features
- [ ] Go to plugin settings
- [ ] Toggle "Enable Premium Features" to ON
- [ ] Verify new settings sections appear
- [ ] Check for "Indexing vault..." notice
- [ ] Verify vault index completes successfully

### Vault Indexer
- [ ] Create a new test note
- [ ] Verify it gets indexed automatically (check console for log)
- [ ] Modify existing note
- [ ] Verify index updates
- [ ] Delete a note
- [ ] Verify it's removed from index
- [ ] Check that excluded patterns work (create *.excalidraw.md)

### Vault Statistics
- [ ] Run "Show vault statistics" command
- [ ] Verify total notes count matches actual
- [ ] Verify word count is reasonable
- [ ] Check tag count
- [ ] Check link count
- [ ] Verify orphaned notes detection

### Link Intelligence
- [ ] Create two notes with similar content/topics
- [ ] Run "Suggest backlinks" command on one note
- [ ] Verify suggestions appear
- [ ] Check that confidence scores are displayed
- [ ] Click on a suggested note to open it
- [ ] Test with notes that have no connections (should return no suggestions)

### Daily Notes Assistant
- [ ] Create a "Daily Notes" folder (if not exists)
- [ ] Create a note named "2026-02-07.md" in that folder
- [ ] Add some content with tasks (e.g., "- [ ] Task 1")
- [ ] Open the daily note
- [ ] Verify "Daily Note: X words, Y pending tasks" notice appears
- [ ] Run "Analyze current daily note" command
- [ ] Verify summary is generated
- [ ] Check that tasks are extracted with categories
- [ ] Run "Generate journal prompts" command
- [ ] Verify prompts are personalized based on recent notes
- [ ] Run "Extract tasks from daily note" command
- [ ] Verify tasks are listed with priorities

### Vault Intelligence Dashboard
- [ ] Run "Show vault intelligence dashboard" command
- [ ] Wait for "Analyzing vault..." notice
- [ ] Verify dashboard opens with 5 tabs

#### Overview Tab
- [ ] Verify all 6 stats display (Total Notes, Words, Links, Tags, Orphans, Growth)
- [ ] Check "Largest Notes" list
- [ ] Check "Most Linked Notes" list
- [ ] Click on a note name to open it

#### Health Tab
- [ ] Verify health score displays (0-100)
- [ ] Check color coding (red < 50, yellow 50-75, green > 75)
- [ ] Verify "Orphaned Notes" list (if any)
- [ ] Click on orphaned note to open it
- [ ] Check "Weak Connections" list (if any)
- [ ] Check "Outdated Notes" list (if any)

#### Topics Tab
- [ ] Verify topic cloud displays
- [ ] Check that tag sizes vary based on frequency
- [ ] Verify "Knowledge Gaps" section
- [ ] Check "Trending Topics" section
- [ ] Click on a tag to see related notes (if implemented)

#### Activity Tab
- [ ] Verify activity streak displays
- [ ] Check "Most Active Notes" list
- [ ] Verify "Recent Activity" timeline
- [ ] Check that timestamps are reasonable

#### Recommendations Tab
- [ ] Verify recommendations appear
- [ ] Check priority colors (high=red, medium=yellow, low=green)
- [ ] Click on action buttons (e.g., "View First Orphan")
- [ ] Verify actions open the correct notes
- [ ] Check that recommendations are actionable

## Settings Tests

### Premium Settings Persistence
- [ ] Change daily notes folder
- [ ] Change daily notes format
- [ ] Toggle auto-summarize setting
- [ ] Toggle auto-extract tasks setting
- [ ] Change min link strength
- [ ] Change max suggestions
- [ ] Reload Obsidian
- [ ] Verify all settings persist

### Exclusion Patterns
- [ ] Add "*.excalidraw.md" to exclude patterns
- [ ] Create a file matching the pattern
- [ ] Verify it doesn't appear in vault stats
- [ ] Remove the pattern
- [ ] Reindex vault
- [ ] Verify file now appears

## Edge Cases & Error Handling

### Empty Vault
- [ ] Test with empty vault (no notes)
- [ ] Verify dashboard doesn't crash
- [ ] Check that stats show zeros

### Large Vault
- [ ] Test with 1000+ notes (if available)
- [ ] Verify indexing completes in reasonable time (< 30 seconds)
- [ ] Check dashboard load time (< 5 seconds)
- [ ] Verify no performance issues

### Special Characters
- [ ] Create note with special characters in name
- [ ] Create note with emoji in content
- [ ] Create note with code blocks
- [ ] Verify all features work correctly

### Network Errors
- [ ] Test without API key
- [ ] Verify helpful error message
- [ ] Test with invalid API key
- [ ] Verify authentication error appears
- [ ] Test during network outage
- [ ] Verify graceful failure

### Concurrent Operations
- [ ] Open multiple modals at once
- [ ] Verify no crashes
- [ ] Index while using AI chat
- [ ] Verify no interference

## Performance Checks

### Memory Usage
- [ ] Open DevTools > Performance Monitor
- [ ] Check memory usage after opening dashboard
- [ ] Verify no memory leaks (close modal, check memory drops)

### Cache Verification
- [ ] Open dashboard twice
- [ ] Second load should be faster (cached)
- [ ] Modify a note and open dashboard again
- [ ] Verify cache is invalidated

## Known Limitations

### Daily Notes
- Only works with specific date format (YYYY-MM-DD by default)
- Folder name must match "Daily Notes" (unless changed in settings)
- Auto-processing only triggers when note is opened

### Link Intelligence
- Suggestions based on tag/heading similarity only
- Does not analyze actual content (for performance)
- May miss semantic connections

### Vault Intelligence
- Knowledge gaps based on simple heuristics (tag frequency)
- Not true AI-powered gap detection (future enhancement)
- Health score is approximate

### Cache
- Insights cached for 15 minutes
- Suggestions cached for 5 minutes
- Analysis cached for 10 minutes
- Manual refresh available via dashboard

## Before Release

- [ ] Test on Windows
- [ ] Test on macOS (if possible)
- [ ] Test on Linux (if possible)
- [ ] Test with Obsidian mobile app (if applicable)
- [ ] Verify README is up to date
- [ ] Check all user-facing text for typos
- [ ] Verify license is correct

## Bug Report Template

If you find an issue, please document:
1. Obsidian version
2. Plugin version
3. OS and version
4. Steps to reproduce
5. Expected behavior
6. Actual behavior
7. Console errors (Ctrl+Shift+I > Console)
8. Screenshots (if applicable)
