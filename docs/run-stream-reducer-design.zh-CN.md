# Run-Stream Reducer 技术设计(中文版)

状态:已实施 —— PR-1([lib/chat/run-stream-reducer.ts](../lib/chat/run-stream-reducer.ts) + 回放测试)与 PR-2(chat-view 接入)均已落地;§13 记录了实现与原提案的偏差。
English version: [run-stream-reducer-design.md](run-stream-reducer-design.md)

前置条件:自愈式会话事件流传输层
([lib/chat/session-event-stream.ts](../lib/chat/session-event-stream.ts))已经落地,
客户端的连接生命周期已经由视图之外的模块独立持有。本设计是第二步:让由这条
事件流驱动的*状态*同样变得有原则、可测试。

## 1. 问题

`components/chat-view.tsx` 用十个独立的 `useState` 加五个簿记用 ref 来推导一次
live run 的全部状态,而它们的写入散落在六类调用点(帧处理器、submit、abort、
clear、queue、reconcile effect)。run 的生命周期实际上是一台伪装起来的状态机:

- 状态转移是一组组散落的 `setX()` 调用,彼此的一致性全靠人手维护(例如
  `beginActivity` 要改 9 个状态位,`finishActivity` 改 8 个,
  `clearCurrentSession` 改 20+ 个)。
- 守卫条件是反复拼装的布尔汤(`isWaiting` 组合了四个状态位;漏掉任何一个,
  产生的正是我们刚在传输层修掉的那类"卡在 thinking"的 bug)。
- 那些 ref(`currentStreamingAssistantIdRef`、`streamMessageSequenceRef`、
  `sourceMessageCountAtRunStartRef`、`pendingSourceCountRef`)存在的唯一理由是
  绕开闭包陈旧值——它们本是普通状态,只是从 React 的模型里掉了出去。
- 以上没有任何一处可以单元测试:今天想验证"重连时 replay 了 mid-run 的
  activity_start"这类场景,唯一手段是人肉 QA。

## 2. 目标 / 非目标

**目标。** 用一个纯 reducer 持有 live run 的全部状态。帧、本地意图、markdown
批量输出都变成 action。任何一段录制下来的帧序列都能在单元测试里回放,并在每
一步之间做断言。

**非目标。**

- 不引入外部状态库(zustand/redux)。状态的作用域就是一个 `ChatView` 实例,
  `useReducer` 足够。
- streaming-markdown 装配管线(rAF 批处理、可变的
  `StreamingMarkdownAssembler`)保持原样。它是性能层,不是状态(见 §6)。
- 历史合成(`baseMessages`、`buildDisplayItems`、outline 条目)继续作为
  `useMemo` 派生;进入 reducer 的只是它们的*输入*。
- 分支/树 UI 状态(`selectedNodeId`、`branchMessages`、`branchPending`)、
  composer 状态、布局状态留在组件里。

## 3. 架构

```
SSE 传输层 (SessionEventStream)             ← 已自愈
      │ RunStreamFrame
      ▼
帧分派器(薄,位于 chat-view)
      │            │
      │            └─ markdown 命令 ──→ useStreamingMarkdown(rAF,可变层)
      │                                        │ onFlushContent / onReplaceContent
      ▼                                        ▼
dispatch({type:'frame', …})           dispatch({type:'content_flushed', …})
dispatch(本地意图: submit/abort/clear/…)
      │
      ▼
runStreamReducer(state, action) → RunStreamState        [纯核]
      │
      ├─ selectors → isRunningRun / isWaiting / canQueueMessage / …
      └─ 效果层(响应状态的小型 useEffect):
           done → router.refresh()
           handover 就绪 → dispatch(handover) + resetStreamingMarkdown()
           activity 落定 → 清除 abort-fallback 定时器
```

数据单向流动。markdown 管线由分派器下发命令驱动,其批量输出以 action 的形式
回灌;它永远不读 reducer 状态。

## 4. 状态形状

```ts
// lib/chat/run-stream-reducer.ts
export type RunStreamPhase = 'idle' | 'starting' | 'thinking' | 'streaming'
// 'connecting' 删除:自 SSE 统一之后已无任何写入方。

export interface RunStreamState {
  phase: RunStreamPhase
  activityId: string | null
  activityStartApplied: boolean // activityId 对应的 activity_start 是否已应用(见 §13)
  sdkRunning: boolean          // 原 sdkSessionRunning
  queueReady: boolean          // 原 sdkSessionQueueReady
  aborting: boolean            // 原 abortingRun
  error: string | null         // 原 streamError
  done: boolean                // 原 streamDone(run 结束、post-run refresh 待执行)
  startedAt: number | null     // 原 streamStartedAt
  messages: ChatMessage[]      // 原 streamMessages(live tail,实时尾部)
  optimisticUserMessage: ChatMessage | null   // 原 optimisticMessage

  // 原先的 ref —— reducer 消除闭包问题后,它们回归为普通状态:
  currentAssistantId: string | null   // 原 currentStreamingAssistantIdRef
  latestAssistantId: string | null    // 原 latestStreamingAssistantIdRef
  messageSequence: number             // 原 streamMessageSequenceRef
  sourceCountAtRunStart: number       // 原 sourceMessageCountAtRunStartRef
  stagedSourceCount: number | null    // 原 pendingSourceCountRef
}

export const initialRunStreamState: RunStreamState
```

`queueingMessage`('steer' | 'follow-up' | null)可以在后续跟进中收编;第一轮
迁移刻意排除它,以保证 diff 可评审。

## 5. Action 集合

```ts
export type RunStreamAction =
  // 整个服务端契约通过一个 action 进入:
  | { type: 'frame'; frame: RunStreamFrame; at: number }

  // 本地意图:
  | { type: 'prompt_submitted'; message: ChatMessage; sourceCount: number; at: number }
  | { type: 'prompt_started'; activityId: string | null } // POST 响应宣布了 activity id
  | { type: 'prompt_rejected'; error: string | null; alreadyRunning?: boolean }
  | { type: 'abort_requested' }
  | { type: 'abort_failed'; error: string }
  | { type: 'abort_fallback_fired' }
  | { type: 'branch_context_staged'; sourceCount: number }  // 编辑消息导致的分支导航
  | { type: 'session_reset' }        // clear-session 与会话切换
  | { type: 'handover_completed' }   // live tail 已移交进持久化历史
  | { type: 'error_dismissed' }      // 流错误自动消散超时
  | { type: 'stream_error_raised'; error: string }  // 帧流之外的本地失败(如 queueMessage 的 POST)

  // markdown 管线的输出(由 useStreamingMarkdown 以 rAF 批量):
  | { type: 'content_flushed'; batch: readonly { messageId: string; content: string }[] }
  | { type: 'content_replaced'; messageId: string; content: string }
```

**纯度规则。** reducer 永不调用 `Date.now()`、`Math.random()`,也不读 ref。
一切非确定输入(时间戳 `at`、生成 id 的种子)都由 action payload 携带;id 从
`messageSequence` 派生。这使 reducer 在 StrictMode 双调用下安全,也让回放测试
是精确的。

## 6. Markdown 双通道

`message_delta` 的文本刻意**不**由 `frame` action 写入状态。高频增量走现有的
rAF 批量装配器(`useStreamingMarkdown`),其批量输出以 `content_flushed` /
`content_replaced` action 的形式返回,并对 assistant 行做 upsert。每个 pi 事件
的*其余部分*(phase 转移、process 行、usage、error、assistant 起止簿记)由
reducer 同步处理。

因此分派器对每一帧只做两件事:

1. `dispatch({ type: 'frame', frame, at: Date.now() })`
2. 下发对应的 markdown 命令(`beginMessage`、`appendDelta`、
   `sealTextSegment`、`finishMessage`、`finishAll`、`reset`)——与当前
   `handlePiEvent` 发出的调用完全相同。

markdown `reset` 的时机限定在新 tail 开始的那几刻:`prompt_submitted`
(dispatch 之前)、handover effect、以及 `session_reset`。它**刻意不在**
`activity_start` 上执行——被 replay 的 start 在 reducer 里是 no-op(§7),
若在此处重置装配器,会丢掉重放增量已不再携带的前缀文本。`finishAll` 则在
`activity_end`、pi `error` 事件、以及 abort 失败路径上执行。

有一处细节迁入 reducer:今天 `appendStreamingAssistantDelta` 在没有当前
assistant id 时会回退调用 `startStreamingAssistant()`。迁移后该回退变为:
`content_flushed` 对未知 `messageId` 直接 upsert 新行(这本就是
`applyStreamingContentBatch` 的现行行为),同时 `frame`/`message_delta` 在
`currentAssistantId` 为空时为其赋值。

## 7. 关键转移规则

| Action / 帧                            | 转移(要点)                                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `prompt_submitted`                     | 重置 live 字段;`phase='starting'`;记录 `optimisticUserMessage`;`sourceCountAtRunStart = stagedSourceCount ?? sourceCount`;清空 staged;`activityStartApplied=false` |
| `prompt_started`                       | `activityId=宣布的 id; sdkRunning=true`(POST 响应与帧流存在竞速——见 §13)                                        |
| `frame:state` running=true             | `sdkRunning=true; queueReady=true; activityId ??= frame.activityId`;`phase: idle→thinking`(其余保持)            |
| `frame:state` running=false            | `sdkRunning=false; queueReady=false; activityId=null; activityStartApplied=false; phase='idle'`                   |
| `frame:activity_start`                 | **以"start 已应用"为幂等键**:`activityId` 相同**且** `activityStartApplied` → no-op(重连 replay 不得清空已积累的 live tail);否则 → 重置 live 字段、`phase='thinking'`、`startedAt=at`、`activityStartApplied=true` |
| `frame:activity_end` completed/aborted | 将 `'streaming'` 行落定为 `'now'`;`activityId=null; activityStartApplied=false; sdkRunning=false; queueReady=false; aborting=false; phase='idle'; done=true` |
| `frame:activity_end` failed            | 同上,但 `error=frame.error ?? 默认文案; done=false`                                                              |
| `frame:pi assistant_message_start`     | `currentAssistantId = latestAssistantId = messageId ?? generated(seq)`                                            |
| `frame:pi assistant_message_end`       | 该行落定为 `'now'`;若 `currentAssistantId` 匹配则清空                                                            |
| `frame:pi thinking/tool/bash 增量`     | `phase='thinking'`;upsert process 行(保留现行合并规则:连续 `thinking` 行合并;`bash` 行按 title 合并)          |
| `frame:pi message_delta`               | `phase='streaming'`;`currentAssistantId` 为空时赋值(内容经 `content_flushed` 到达)                              |
| `frame:pi usage`                       | 将 `tokens`/`usage` 附着到 `messageId ?? latestAssistantId` 对应行                                                |
| `frame:pi error`                       | `error=message`(权威的失败信号仍是 `activity_end`)                                                              |
| `content_flushed` / `content_replaced` | 追加或创建 assistant 行(`timestamp:'streaming'`)                                                                |
| `handover_completed`                   | `messages=[]; optimisticUserMessage=null; startedAt=null; done=false; phase='idle'; currentAssistantId=latestAssistantId=null` |
| `session_reset`                        | 回到 `initialRunStreamState`,其中 `sourceCountAtRunStart=0`                                                      |

`activity_start` 的幂等行是唯一一处**有意的行为变更**:今天被 replay 的
`activity_start` 会先清空 live tail,再由重放的增量重建(可见闪烁);reducer
方案下 replay 是 no-op,后续 upsert 天然容忍重复。其余规则均为现有 `setX` 组
的 1:1 翻译,并在触碰 UI 之前先由测试锁定。

## 8. Selectors

```ts
export const selectIsStartingRun = (s) => s.phase === 'starting' && !s.activityId
export const selectIsRunningRun  = (s) => Boolean(s.activityId) || s.sdkRunning
export const selectCanQueueMessage = (s) => selectIsRunningRun(s) && s.queueReady && !s.aborting
export const selectRunProducedAssistantText = (s) =>
  s.messages.some((m) => m.type === 'assistant' && m.content)
export const selectIsWaiting = (s, hasPersistedRun: boolean) =>
  !s.error && !hasPersistedRun &&
  (s.phase !== 'idle' || s.sdkRunning) && s.messages.length === 0
export const selectHasPersistedRun = (s, sourceMessages: ChatMessage[]) =>
  s.done && hasPersistedAssistantResponse(sourceMessages, s.sourceCountAtRunStart, {
    acceptProcessMessages: !selectRunProducedAssistantText(s),
  })
```

Selectors 从 reducer 模块导出并与之一起做单元测试;组件不再内联重新推导这些
条件。

## 9. 效果层(继续以 `useEffect` 存在的部分)

副作用响应状态;它们永远不计算状态:

- `state.done` → 去抖后的 `router.refresh()`(维持"每次 run 只 refresh 一次"
  的规则不变)。
- `selectHasPersistedRun(state, sourceMessages)` →
  `dispatch({type:'handover_completed'})` 与 `resetStreamingMarkdown()`
  (依赖来自服务端 props 的 `sourceMessages`,因此无法放进 reducer)。
- `state.error` → 自动消散定时器 → `dispatch({type:'error_dismissed'})`。
- activity 落定(`activityId` 变为 null)→ 清除 abort-fallback 定时器
  (替代现在 `finishActivity` 内的命令式清除)。
- 滚动跟随与 composer 聚焦不动。

## 10. 迁移计划

三个可独立评审的步骤;每一步之后应用都保持可用。

1. **PR-1 —— 纯模块 + 测试。** 新增 `lib/chat/run-stream-reducer.ts` 与
   `run-stream-reducer.test.ts`。编码*现有*行为(除已注明的 `activity_start`
   幂等修正外)。不改 UI。
2. **PR-2 —— 接入。** chat-view 换用 `useReducer`;帧分派器替换
   `handleFrame`/`handlePiEvent` 的函数体;submit/abort/clear/reconcile 各调用
   点改为 dispatch 意图;selectors 替换内联推导;删除十个 `useState` 与五个
   ref。
3. **PR-3 —— 清理(可选)。** 收编 `queueingMessage`;从类型中删除
   `'connecting'` phase;增加仅开发环境的 dispatch 日志。

## 11. 测试计划(PR-1)

回放式测试:每条用例是一段帧/action 序列,步骤之间穿插断言:

- 黄金路径:submit → activity_start → assistant start → flush → assistant
  end → activity_end(completed) → handover。每一步断言 `phase`、`isWaiting`、
  行内容。
- 重连 replay:重复的 `activity_start` + 重放的增量 → live tail 不被清空、
  无重复行。
- Mid-run attach:先收 `state(running)`,再收未知 assistant id 的 flush →
  行被 upsert,`isWaiting` 为 false。
- 失败:`activity_end(failed)` → 错误呈现、`done=false`、不触发 handover。
- Abort:`abort_requested` → `activity_end(aborted)` → `aborting` 复位。
- 编辑消息分支:`branch_context_staged(n)` 后 `prompt_submitted` →
  `sourceCountAtRunStart === n`,staged 已清空。
- 纯工具轮次:没有 assistant 文本 → `selectHasPersistedRun` 接受 process
  消息(即现行的 `acceptProcessMessages` 规则)。
- Process 行合并:连续 thinking 增量合并;bash 行按 title 合并;usage 附着到
  正确的行。
- `session_reset` 从任意 mid-run 状态回到初始状态。

## 12. 风险

- **行为漂移** —— 由 PR-1 在任何 UI 改动之前先用测试锁死现有语义,加上 §7 的
  1:1 转移表来缓解。
- **渲染频率** —— 不变:增量仍走 rAF 批量;每帧一次 dispatch 取代一次或多次
  setState(React 18+ 对两者的批处理完全相同)。
- **reducer 纯度回归** —— StrictMode 双调用加回放测试会在 `Date.now()`/ref
  溜回来时大声失败。

## 13. 实现偏差(PR-1/PR-2 期间发现)

实现与本提案的差异,每一条都由设计遗漏的真实交互所迫:

- **状态新增 `activityStartApplied: boolean`。** 提案把 `activity_start` 的
  幂等键定为"相同 `activityId`"。这在黄金路径上就是错的:POST 响应
  (`prompt_started`)会在帧流送达 `activity_start` *之前*宣布 activity id,
  于是真正的 start 帧因 id 已知而被跳过——run 永远停在 `'starting'`。回放
  测试第一次运行就抓住了这个问题。幂等键现在是"start 已应用"而非"id 已
  见过":该标志在 `prompt_submitted` 时置 false,应用 start 帧时置 true,
  `activity_end` / `state(running=false)` 时再置 false。
- **`prompt_started` action。** §5 里被隐含但未列出:POST 成功路径需要自己
  的意图来记录宣布的 id 并标记 SDK 运行中(不能等 `state` 帧)。
- **`prompt_rejected` 增加 `alreadyRunning?: boolean`。** 服务端因另一个
  run 占用会话而拒绝 prompt 时,客户端应反映那个 run 的存在
  (`sdkRunning=true, queueReady=true`、无错误),让 steer/follow-up 的交互
  亮起,而不是弹错误横幅。
- **`stream_error_raised` action。** `error_dismissed` 的对偶,供帧流之外
  的本地失败路径使用(例如 queue-message 的 POST 失败)。提案原本只允许
  错误经由帧和 `prompt_rejected`/`abort_failed` 进入。
- **markdown `reset` 范围收窄**(§6):reset 只发生在
  `prompt_submitted`/handover/`session_reset`,绝不在 `activity_start` 上,
  与 start 帧的幂等语义保持一致。
