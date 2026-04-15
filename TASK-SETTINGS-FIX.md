# TASK: Berry-Claw Settings Fixes + Observe Integration

## Context
Berry-Claw frontend: `web/src/` (React 19 + Vite + Tailwind CSS 3)
Backend: `src/` (Express + WebSocket)
SDK dependency: `@berry-agent/observe` (will be updated separately)

## 1. Fix TS Errors in SettingsPage

**File**: `web/src/components/SettingsPage.tsx`
**Problem**: `npx tsc --noEmit` shows 3 errors — `flash` and `message` variables undefined
**Fix**: These are leftover from incomplete Toast integration. Use `showToast()` from Toast.tsx (already imported).

Run `cd web && npx tsc --noEmit` to verify after fix.

## 2. Provider Settings — Grouped Display + Edit + Delete

**File**: `web/src/components/SettingsPage.tsx`
**Current**: After adding providers, models are shown as a flat list without distinguishing which provider they belong to. Can't edit existing providers.

**Redesign Providers section**:
- Instead of flat model chips, show provider cards:
  ```
  ┌─ zenmux (anthropic) ──────────────────────────┐
  │ Base URL: https://...                          │
  │ Models: claude-opus-4.6, claude-sonnet-4.6 │
  │                              [Edit] [Delete]   │
  └────────────────────────────────────────────────┘
  ┌─ test-provider (openai) ──────────────────────┐
  │ Models: gpt-4o, gpt-4o-mini                    │
  │                              [Edit] [Delete]   │
  └────────────────────────────────────────────────┘
  ```
- Each card shows: provider name, type badge, base URL (if set), model list
- Edit button → inline edit mode (same form as Add, pre-filled)
- Delete button → confirmation dialog or direct delete with toast
- Keep the "default model" selector (model chips) below provider cards
- API key shown as masked (`sk-ant-...****`)

**Backend needed**: 
- `GET /api/config` already returns providers. Need to return provider names as keys (currently does).
- May need a new `GET /api/config/providers` endpoint that lists providers with their details (without full API key). Check `server.ts` — if `/api/config` already returns this info, use it.

## 3. Agent Settings — Smart Defaults

**File**: `web/src/components/SettingsPage.tsx`

Current form fields: ID, Name, Model, Workspace, System Prompt
All manual input.

**Improvements**:
- **ID**: Auto-generate from name (slugify: "My Agent" → "my-agent"). Show as read-only derived field. Allow manual override with a toggle.
- **Model**: Change from text input to `<select>` dropdown populated from available models (`status.models`)
- **Workspace**: Default to global workspace from config status. Show placeholder with the default value.
- **System Prompt**: Optional with a hint "Uses default system prompt if empty"
- **Tools**: Remove hardcoded `['file', 'shell', 'search']`. For now don't show tools config in UI (use all available tools by default)

## 4. Agent List — Edit Support

Currently agents can only be added and deleted. Add edit capability:
- Click agent name or an edit icon → expand/open edit form pre-filled with current values
- Save triggers `PUT /api/agents/:id`
- Cancel returns to view mode

## 5. Fix Flaky Integration Tests (Low Priority)

The integration tests 2, 4, 7 fail intermittently due to LLM non-determinism.
- Test 2: Check for tool calls `list_files` OR `bash`/`shell` (model might use shell `ls` instead)
- Test 4: Check for `write_file` OR `bash`/`shell` with write operation
- Test 7: Only check messages count based on how many tests actually succeeded (or make it independent)

These are pre-existing issues, fix only if time permits.

## Constraints
- Keep dark mode working (use `dark:` Tailwind variants on all new elements)
- Keep all 44 passing tests passing
- TypeScript strict mode
- Tailwind CSS 3 (not 4), React 19
- lucide-react for icons

## When Done
1. `cd web && npx tsc --noEmit` — must pass (0 errors)
2. `cd . && npx vitest run` — 44+ tests pass (integration flakes are OK)
3. `cd web && npx vite build` — must succeed
4. Commit all changes

When completely finished, run this command to notify me:
openclaw system event --text "Done: Berry-Claw settings fixes — provider grouping, agent defaults, TS errors fixed" --mode now
