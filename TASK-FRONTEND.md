# TASK: Berry-Claw Frontend Overhaul

## Context
Berry-Claw is an AI agent product. Frontend is React 19 + Vite + Tailwind CSS 3.
Located at `web/src/`. Backend at `src/`.

Current state: basic chat works, observe dashboard works (SDK integration), but UX is rough.

## Tasks (do ALL of them)

### 1. Markdown Rendering + Code Highlighting (HIGH)
- Install `react-markdown`, `remark-gfm`, `react-syntax-highlighter` (or `prism-react-renderer`)
- In `MessageBubble.tsx`: render assistant messages as markdown
- Code blocks: syntax highlighting with language detection, copy button
- Support: headers, lists, tables, bold/italic, links, inline code
- User messages: keep as plain text (no markdown)

### 2. Agent + Model Selector (HIGH)
- Add agent selector dropdown in Sidebar (above session list) or top bar
- Show current active agent name + model
- Dropdown lists all agents from `/api/config` (with their configured models)
- Model quick-switch: small dropdown next to agent name showing available models
- On agent switch: call backend `PUT /api/agents/active` or existing switch API
- On model switch: call backend `POST /api/agents/model` or existing switch API
- Check `server.ts` for existing endpoints

### 3. Session Auto-Naming (HIGH)
- After first assistant response in a new session, generate a short title
- Use first user message (truncated to ~30 chars) as session title
- Display in Sidebar instead of `ses_17761577...`
- Store title in SessionManager (add `title` field to SessionState)
- Backend: add title to session list response + update on first message

### 4. Streaming Tool Call Display (MEDIUM)
- During agent execution, show tool calls in real-time
- Display "🔧 Calling read_file..." with a spinner/pulse animation
- When tool_result arrives, show success ✅ or error ❌
- Tool calls should be collapsible (click to expand input/output)
- Use existing WsIncoming `tool_call` and `tool_result` events

### 5. Thinking Process Display (MEDIUM)
- Show `thinking_delta` events in a collapsible "Thinking..." section
- Use a distinct visual style (e.g., gray italic text, or a bordered box)
- Should appear above the final response text
- Collapse by default after response completes

### 6. Settings Save Feedback (LOW)
- Add toast/notification system (simple CSS-based, no heavy library)
- Show success toast on config save
- Show error toast on failure

### 7. Dark Mode (LOW)
- Add dark mode toggle (in Settings or top bar)
- Use Tailwind `dark:` variant classes
- Store preference in localStorage
- Apply `dark` class to `<html>` element

### 8. Mobile Responsive (LOW)
- Sidebar: collapsible on mobile (hamburger menu)
- Chat area: full width on small screens
- Input box: stays at bottom
- Observe dashboard: stack cards vertically

### 9. Cost Display Fix (MEDIUM)
- Cost shows $0.0000 because model name `anthropic/claude-sonnet-4.6` doesn't match pricing table
- In observe pricing: add alias support or normalize model names
- Quick fix: add common aliases to `@berry-agent/observe` pricing.ts OR
- Add pricing config in berry-claw that maps zenmux model names to standard names

## Architecture Notes
- `App.tsx` — main layout, state management, WebSocket handler
- `Sidebar.tsx` — navigation + session list (session list only shows on chat tab)
- `ChatArea.tsx` — chat messages + input
- `MessageBubble.tsx` — individual message rendering
- `ObserveDashboard.tsx` — imports SDK's ObserveApp
- `SettingsPage.tsx` — provider/agent config UI
- `types.ts` — shared types
- `hooks/useWebSocket.ts` — WebSocket connection

## Backend APIs (check server.ts for exact routes)
- GET /api/sessions — list sessions
- GET /api/sessions/:id — session detail + messages
- GET /api/config — full config
- PUT /api/config — update config
- GET /api/agents/current — current agent info
- POST /api/agents/switch — switch agent
- POST /api/agents/model — switch model

## Constraints
- Keep existing 39 tests passing
- TypeScript strict mode
- No `any` types
- Tailwind CSS 3 (not 4)
- React 19
- lucide-react for icons
- No heavy UI libraries (no MUI, no Chakra) — Tailwind only
- Observe UI components come from SDK cross-repo import, don't modify them

## When done
1. Run `npx tsc --noEmit` — must pass
2. Run `npx vitest run` — 39 tests must pass
3. Run `cd web && npx vite build` — must succeed
4. Commit all changes

When completely finished, run this command to notify me:
openclaw system event --text "Done: Berry-Claw frontend overhaul complete — markdown rendering, agent/model selector, session naming, tool call display, thinking, dark mode, mobile responsive, toast notifications" --mode now
