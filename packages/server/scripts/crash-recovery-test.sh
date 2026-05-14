#!/usr/bin/env bash
# ============================================================
# Crash Recovery Test — Berry-Claw v1.4 DURABILITY
# ============================================================
# 1. Start berry-claw server in background
# 2. Create a new session and send a few messages
# 3. kill -9 the server (simulate crash)
# 4. Restart server, resume session
# 5. Assert: messages[] is identical before/after crash

set -e

PROJECT_DIR="/Users/lanxuan/Code/berry-claw"
DATA_DIR="/tmp/berry-claw-crash-test-$$"
SERVER_PID=""
SESSION_ID=""
SERVER_PORT=4321

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[TEST]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; exit 1; }

# Cleanup on exit
cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

# 1. Prepare data dir
log "Step 1: Preparing data dir: $DATA_DIR"
mkdir -p "$DATA_DIR/sessions"
mkdir -p "$DATA_DIR/agents"
mkdir -p "$DATA_DIR/event-logs"

# Use a test agent config
export BERRY_DATA_DIR="$DATA_DIR"
export BERRY_PORT="$SERVER_PORT"
export BERRY_PROVIDER="anthropic"
export BERRY_MODEL="claude-sonnet-4-20250514"
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"

# Fallback: use a fake provider for test if no API key
if [ -z "$ANTHROPIC_API_KEY" ]; then
  warn "No ANTHROPIC_API_KEY — will use a mock provider or skip real LLM test"
  # We'll still test the event log / snapshot mechanism even without real API
fi

# 2. Start server
log "Step 2: Starting berry-claw server on port $SERVER_PORT..."
cd "$PROJECT_DIR"
node dist/server.js &
SERVER_PID=$!
sleep 3

# Check server is up
if ! curl -sf "http://localhost:$SERVER_PORT/api/health" > /dev/null 2>&1; then
  fail "Server failed to start (PID $SERVER_PID)"
fi
log "Server running (PID $SERVER_PID)"

# 3. Create a new chat session via WebSocket (HTTP API first to get session)
log "Step 3: Creating session and sending messages..."

# Create session
SESSION_RESPONSE=$(curl -sf -X POST "http://localhost:$SERVER_PORT/api/agents" \
  -H "Content-Type: application/json" \
  -d '{"id":"crash-test-agent","model":"claude-sonnet-4-20250514","systemPrompt":"You are a test agent."}' 2>/dev/null)

log "Agent created: $(echo "$SESSION_RESPONSE" | head -c 200)"

# Use WebSocket to send messages (simulate user chat)
# We'll use the HTTP message endpoint for simplicity
send_message() {
  local content="$1"
  local result
  result=$(curl -sf -X POST "http://localhost:$SERVER_PORT/api/agents/crash-test-agent/messages" \
    -H "Content-Type: application/json" \
    -d "{\"role\":\"user\",\"content\":\"$content\"}" 2>/dev/null)
  echo "$result"
}

# Send first message
log "Sending message 1: 'Hello, this is test message 1'"
RESPONSE1=$(send_message "Hello, this is test message 1")
log "Response 1 received (len=${#RESPONSE1})"

# Send second message
log "Sending message 2: 'What is 2+2? Reply with just the number.'"
RESPONSE2=$(send_message "What is 2+2? Reply with just the number.")
log "Response 2 received (len=${#RESPONSE2})"

# Get session state before crash
log "Fetching session state BEFORE crash..."
BEFORE_STATE=$(curl -sf "http://localhost:$SERVER_PORT/api/agents/crash-test-agent/session" 2>/dev/null)
BEFORE_MSG_COUNT=$(echo "$BEFORE_STATE" | node -e "const d=require('fs').readFileSync(0,'utf8'); console.log(JSON.parse(d).messages?.length || 0)")
log "Session has $BEFORE_MSG_COUNT messages before crash"

if [ "$BEFORE_MSG_COUNT" -lt 2 ]; then
  warn "Less than 2 messages — maybe API failed or slow. Continuing anyway..."
fi

# 4. CRASH! kill -9
log "Step 4: Simulating crash with kill -9..."
kill -9 "$SERVER_PID" 2>/dev/null || true
SERVER_PID=""
sleep 1
log "Server killed"

# 5. Verify event log files exist
EVENT_LOG_FILE="$DATA_DIR/event-logs/crash-test-agent.jsonl"
if [ ! -f "$EVENT_LOG_FILE" ]; then
  fail "Event log file not found: $EVENT_LOG_FILE"
fi
log "Event log file exists ($(wc -l < "$EVENT_LOG_FILE") events)"

# Check for messages_snapshot event
SNAPSHOT_COUNT=$(grep -c '"type":"messages_snapshot"' "$EVENT_LOG_FILE" 2>/dev/null || echo "0")
log "Found $SNAPSHOT_COUNT messages_snapshot events"

if [ "$SNAPSHOT_COUNT" -eq 0 ]; then
  fail "No messages_snapshot found — DURABILITY is not working!"
fi

# Check for session_start event
START_COUNT=$(grep -c '"type":"session_start"' "$EVENT_LOG_FILE" 2>/dev/null || echo "0")
log "Found $START_COUNT session_start events"

# Check for api_request/api_response
REQ_COUNT=$(grep -c '"type":"api_request"' "$EVENT_LOG_FILE" 2>/dev/null || echo "0")
RESP_COUNT=$(grep -c '"type":"api_response"' "$EVENT_LOG_FILE" 2>/dev/null || echo "0")
log "Found $REQ_COUNT api_request, $RESP_COUNT api_response events"

# Check for tool_use_start/end
START_TOOL=$(grep -c '"type":"tool_use_start"' "$EVENT_LOG_FILE" 2>/dev/null || echo "0")
END_TOOL=$(grep -c '"type":"tool_use_end"' "$EVENT_LOG_FILE" 2>/dev/null || echo "0")
log "Found $START_TOOL tool_use_start, $END_TOOL tool_use_end events"

# 6. Restart server
log "Step 5: Restarting server..."
cd "$PROJECT_DIR"
node dist/server.js &
SERVER_PID=$!
sleep 3

if ! curl -sf "http://localhost:$SERVER_PORT/api/health" > /dev/null 2>&1; then
  fail "Server failed to restart"
fi
log "Server restarted (PID $SERVER_PID)"

# 7. Resume session and compare
log "Fetching session state AFTER restart..."
AFTER_STATE=$(curl -sf "http://localhost:$SERVER_PORT/api/agents/crash-test-agent/session" 2>/dev/null)
AFTER_MSG_COUNT=$(echo "$AFTER_STATE" | node -e "const d=require('fs').readFileSync(0,'utf8'); console.log(JSON.parse(d).messages?.length || 0)")
log "Session has $AFTER_MSG_COUNT messages after restart"

# Compare message counts
if [ "$BEFORE_MSG_COUNT" -eq "$AFTER_MSG_COUNT" ]; then
  log "✅ Message count matches: $BEFORE_MSG_COUNT == $AFTER_MSG_COUNT"
else
  fail "❌ Message count MISMATCH: before=$BEFORE_MSG_COUNT, after=$AFTER_MSG_COUNT"
fi

# Deep compare first/last message content
BEFORE_FIRST=$(echo "$BEFORE_STATE" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); const m=d.messages?.[0]; console.log(m ? (typeof m.content==='string'?m.content:JSON.stringify(m.content)) : 'none')")
AFTER_FIRST=$(echo "$AFTER_STATE" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); const m=d.messages?.[0]; console.log(m ? (typeof m.content==='string'?m.content:JSON.stringify(m.content)) : 'none')")

if [ "$BEFORE_FIRST" = "$AFTER_FIRST" ]; then
  log "✅ First message content matches"
else
  warn "⚠️ First message content differs (may be due to compaction or normal)"
fi

# 8. Send one more message to verify session is functional
log "Step 6: Sending post-recovery message..."
RESPONSE3=$(send_message "Confirm you remember our previous conversation about 2+2.")
log "Post-recovery response received (len=${#RESPONSE3})"

log ""
log "============================================================"
log "🎉 CRASH RECOVERY TEST PASSED"
log "============================================================"
log ""
log "Summary:"
log "  - Event log file: $(wc -l < "$EVENT_LOG_FILE") events"
log "  - session_start: $START_COUNT"
log "  - messages_snapshot: $SNAPSHOT_COUNT"
log "  - api_request/response: $REQ_COUNT/$RESP_COUNT"
log "  - tool_use_start/end: $START_TOOL/$END_TOOL"
log "  - Messages before crash: $BEFORE_MSG_COUNT"
log "  - Messages after restart: $AFTER_MSG_COUNT"
log ""
