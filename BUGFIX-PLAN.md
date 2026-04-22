# Berry-Claw Bug Fix Plan — 2026-04-22

**Status**: All P0/P1 fixes applied. Pending verification by lanxuan.

## 已修复 ✅

### #5d: "position 121 empty assistant" 400 Error — P0
**File**: `berry-claw/src/engine/agent-manager.ts`
**Fix**: `hydrateChatMessages()` 在 assistant message 处理中加了过滤：
```ts
if (!text && !thinking && (!toolCalls || toolCalls.length === 0)) continue;
```
空 assistant message（text/thinking/toolCalls 全空）会被跳过，不会送进 LLM API。

### #4: Chat 界面模型切换不生效 — P1
**File**: `berry-claw/src/engine/agent-manager.ts`
**Fix**: `switchModel()` 现在写回 config：
```ts
entry.model = model;
this.config.setAgent(this.activeAgentId, entry);
this.config.save();
const cached = this.agents.get(this.activeAgentId);
if (cached) cached.entry = entry;
```
同时刷新了内存 snapshot，所以 `currentModel()` 返回的是最新值。

### #1/#2: 数据维护不同步 — P1
**Files**: 
- `berry-claw/src/server.ts` — 加了 `clients` WebSocket Set + `broadcast()` 函数
- 在 agent PUT/PATCH/DELETE endpoints 后 `broadcast('config_changed', ...)`
- `berry-claw/web/src/types.ts` — 加了 `config_changed` WsIncoming 类型
- `berry-claw/web/src/App.tsx` — 处理 `config_changed`，dispatch `berry:config-changed` CustomEvent
- `berry-claw/web/src/components/AgentsPage.tsx` — 监听 `berry:config-changed`，自动 `fetchAgents()`
- `berry-claw/web/src/components/AgentSelector.tsx` — 同上，自动 `refresh()`

现在 save project / save agent 后，所有打开的前端标签页都会自动刷新数据。

### #6: Compact 按钮 — P2 (已有效，只是确认)
**Status**: 按钮走 `agent.compactSession()` SDK API，前端已处理 `session_compacted` 事件并 toast。
**无需修复**。

### #8: Compaction Analysis 展示不完整 — P3
**File**: `packages/observe/ui/src/components/CompactionAnalysis.tsx`
**Fix**: 加了 3 个缺失的展示：
1. 统计摘要加了 "Avg Threshold" 列
2. 每次 compaction 事件加了 "freed X tokens" 显示
3. 加了 "Trigger Frequency" 区块（byTrigger 数组）

## 待验证 ⏳

### #3: Team leader 关联 project
**Status**: lanxuan 说"操作起来怪怪的，但就先这样吧" —— 保留现有行为。

### #5a/b/c: Tool 失败 3 次后停止 / 还能聊天 / 是否宕机
**Root cause 分析**:
- tool 失败是 SDK 设计（guard deny 或 tool 抛错）
- agent.query() 抛错后 berry-claw 的 `handleChat` catch 发 error WS 消息
- session 还在，但 messages 可能脏了（已被 #5d 修复过滤）
- "还能聊天" 是因为 error 不是 fatal，session 未被删除
- 这不是宕机，是预期的错误恢复行为

但有一个问题需要确认：**如果 query 抛错，session.messages 里是否会被 SDK 添加一个空的 assistant message？**

如果会，那 #5d 的过滤只能治标，SDK 层面也需要在 `query()` 的 catch 块中 cleanup messages。

### #7: Observe 界面 crash_recovered
**Status**: SDK observe 包已有：
- `TurnDetail` amber banner
- `TurnList` AlertTriangle 图标
- `turns` 表有 `recoveredFromCrash` 等字段
- API 返回这些数据

berry-claw 的 `ObserveDashboard.tsx` 直接 import SDK 的 `ObserveApp`，所以理论上已经生效。
**但需要实际测试验证**：触发一次 crash recovery，然后看 Observe 界面是否显示 banner。

## 提交计划

Berry-Claw 修复作为一个 commit:
```
fix(berry-claw): #5d empty assistant 400, #4 model switch, #1/#2 config sync
```

SDK CompactionAnalysis 作为一个 commit:
```
feat(observe-ui): add tokensFreed display + trigger frequency to CompactionAnalysis
```

## 下一步

1. 提交代码
2. 让 lanxuan 重启 berry-claw 测试
3. 特别关注 #5d 是否彻底解决 400 error
4. 如果 #5d 还有问题，需要检查 SDK 的 `query()` catch 块是否添加了脏消息
