# Pi Studio PRD

## 1. 产品名称

**Pi Studio**

一个面向 [pi.dev](https://pi.dev/) 的 Web 配置管理与对话工作台，用于管理 pi 的全局资源、创建可复用 Agent Profile，并基于 Agent 进行多会话、多分支的 Chat 工作流。

---

## 2. 产品背景

pi 是一个极简、可扩展的 terminal coding agent。它通过文件系统和配置文件管理全局资源，例如：

- Skills
- Prompt Templates
- Models / Providers
- Sessions
- Settings
- Extensions

但 pi 默认主要通过终端交互，不提供图形化管理界面。用户希望构建一个类似 `cc-switch` 的工具，但专门服务于 pi：

- 管理全局配置
- 创建多个命名 Agent
- 为不同 Agent 选择不同的 skill、prompt、mcp、model 配置
- 按 Agent 管理会话
- 在 Web Chat 页面中继续历史会话、切换分支、切换模型与 thinking level

本 PRD 用于生成 Web UI 原型，后续可扩展为桌面 App。

---

## 3. 产品目标

### 3.1 核心目标

Pi Studio 要成为 pi 的图形化工作室与控制台，帮助用户完成：

1. 管理全局 pi 资源
2. 创建和管理 Agent Profile
3. 按 Agent 组织会话
4. 在 Web Chat 中使用 pi SDK 进行对话
5. 可视化查看 session tree 并切换分支
6. 支持多 tab 同时运行多个 Agent / Session

### 3.2 非目标 / 暂不做

以下内容作为未来 TODO，不进入首版核心范围：

- OAuth 登录流程
- 真正运行 MCP server 并注入工具
- 完整插件市场
- 团队协作 / 云同步
- 权限系统
- 移动端适配优先级低

---

## 4. 用户画像

### 4.1 主要用户

- 使用 pi.dev 的开发者
- 需要管理多个模型 provider 的 AI coding 工具用户
- 频繁使用 skills / prompt templates 的 power user
- 希望图形化管理历史会话和分支的用户

### 4.2 使用场景

1. 用户有多个 AI provider，需要快速配置和切换。
2. 用户从 skills.sh 导入多个 skill，需要启用/禁用部分 skill。
3. 用户有多个工作流：代码审查、架构设计、专利写作、简历排版等，希望分别创建 Agent。
4. 用户希望从历史会话恢复并继续对话。
5. 用户希望查看 pi session 的树状分支，而不是只看线性聊天。

---

## 5. 信息架构

Pi Studio 包含两层配置模型：

1. **Global Configs 全局配置层**
2. **Agent Profiles Agent 配置层**

### 5.1 Global Configs

全局配置是资源池，所有 Agent 都可以从里面选择使用。

包括：

- Global Packages
- Global Skills
- Global Prompt Templates
- Global MCP Configs
- Global Model Providers / Models

其中 Packages 是资源来源层，可以包含 extensions、skills、prompt templates、themes。Skills 和 Prompts 既可以来自本地，也可以来自 packages。

### 5.2 Agent Profiles

Agent 是一个命名配置组合。每个 Agent 可以拥有：

- 名称
- 描述
- 标签
- 默认工作目录
- 默认 model provider
- 默认 model
- 默认 thinking level
- 启用的 skills
- 启用的 prompts
- 启用的 MCP configs
- 可用 models 范围
- 独立会话列表

### 5.3 Sessions

Sessions 按 Agent 分类。每个 Agent 下有多个 session。每个 session 内部是树结构，支持分支查看和分支切换。

---

## 6. 核心数据模型

### 6.1 Global Skill

```ts
interface GlobalSkill {
  id: string;
  name: string;
  description: string;
  source: "skills.sh" | "local" | "git" | "manual";
  path: string;
  version?: string;
  author?: string;
  tags: string[];
  installedAt: string;
  updatedAt: string;
}
```

说明：

- Skill 来源优先支持 `https://www.skills.sh/`
- 支持从 skills.sh 搜索、下载、导入
- 支持本地导入 skill 目录
- 是否启用不在 GlobalSkill 上决定，而是在 Agent 中选择

### 6.2 Global Prompt Template

```ts
interface GlobalPromptTemplate {
  id: string;
  name: string;
  description?: string;
  content: string;
  path: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
```

### 6.3 Global MCP Config

```ts
interface GlobalMcpConfig {
  id: string;
  name: string;
  description?: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  tags: string[];
  enabledGlobally: boolean;
  createdAt: string;
  updatedAt: string;
}
```

说明：

- 首版只管理 MCP 配置，不负责运行 MCP server
- 每个 Agent 可以选择启用哪些 MCP config

### 6.4 Global Model Provider

```ts
interface GlobalModelProvider {
  id: string;
  name: string;
  baseUrl: string;
  api: "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";
  apiKey?: string;
  headers?: Record<string, string>;
  models: GlobalModel[];
  createdAt: string;
  updatedAt: string;
}
```

### 6.5 Global Model

```ts
interface GlobalModel {
  id: string;
  name?: string;
  reasoning?: boolean;
  input: Array<"text" | "image">;
  contextWindow?: number;
  maxTokens?: number;
}
```

### 6.6 Agent Profile

```ts
interface AgentProfile {
  id: string;
  name: string;
  description?: string;
  tags: string[];
  icon?: string;
  color?: string;
  defaultCwd?: string;

  selectedSkillIds: string[];
  selectedPromptIds: string[];
  selectedMcpConfigIds: string[];

  selectedProviderIds: string[];
  selectedModelIds: string[];
  defaultProviderId?: string;
  defaultModelId?: string;
  defaultThinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

  createdAt: string;
  updatedAt: string;
}
```

### 6.7 Agent Session

```ts
interface AgentSessionSummary {
  id: string;
  agentId: string;
  name?: string;
  filePath: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  firstUserMessage?: string;
  lastMessagePreview?: string;
  totalTokens?: number;
  totalCost?: number;
  tags: string[];
}
```

### 6.8 Session Tree Node

```ts
interface SessionTreeNode {
  id: string;
  parentId: string | null;
  type: "message" | "model_change" | "thinking_level_change" | "compaction" | "branch_summary" | "label" | "custom";
  role?: "user" | "assistant" | "toolResult" | "bashExecution" | "custom";
  preview: string;
  timestamp: string;
  children: SessionTreeNode[];
  label?: string;
  isCurrent?: boolean;
}
```

---

## 7. 主要页面

### 7.1 Dashboard / Agents 页面

这是应用首页，用于展示和管理 Agent Profiles。

#### 页面目标

用户可以快速查看已有 Agent，创建新 Agent，进入某个 Agent 的 Chat 或配置页。

#### UI 区域

1. 顶部工具栏
   - 搜索 Agent
   - 新建 Agent 按钮
   - 全局设置入口

2. Agent 卡片网格
   - Agent 名称
   - 描述
   - 标签
   - 默认模型
   - 启用的 skill 数量
   - 启用的 prompt 数量
   - 启用的 MCP 数量
   - 会话数量
   - 最近使用时间
   - 操作按钮：Chat、Configure、Duplicate、Delete

3. Empty State
   - 当没有 Agent 时，展示创建引导

#### 关键交互

- 点击 Agent 卡片进入 Chat
- 点击 Configure 进入 Agent 配置页
- 支持复制 Agent
- 支持通过标签过滤 Agent

---

### 7.2 Agent Detail / Agent 配置页面

用于编辑某个 Agent 的资源选择。

#### 页面结构

使用 tabs：

1. Overview
2. Skills
3. Prompts
4. MCP
5. Models
6. Sessions
7. Settings

#### Overview Tab

显示：

- Agent 名称
- 描述
- 标签
- 默认工作目录
- 默认模型
- 默认 thinking level
- 资源启用统计
- 最近会话

#### Skills Tab

从 Global Skills 中选择当前 Agent 启用哪些 skill。

UI：

- 左侧全局 skill 列表
- 搜索、标签筛选、来源筛选
- 每项有 checkbox / toggle
- 右侧显示已启用 skills

#### Prompts Tab

同 Skills Tab，从 Global Prompts 中选择启用项。

#### MCP Tab

从 Global MCP Configs 中选择当前 Agent 关联的 MCP 配置。

说明：首版只作为配置关联，不实际运行。

#### Models Tab

配置当前 Agent 可用模型范围。

- 选择允许的 providers
- 选择允许的 models
- 设置默认 provider/model
- 设置默认 thinking level

#### Sessions Tab

只展示当前 Agent 下的 sessions。

- 搜索
- 按时间排序
- 标签过滤
- 打开继续对话
- 查看 session tree
- 删除
- 批量删除

---

### 7.3 Global Skills 页面

全局 Skill 管理。

#### 页面目标

管理全局可用 skill 池，支持从 skills.sh 搜索和导入。

#### UI 区域

1. 顶部工具栏
   - 搜索本地 skills
   - Import 按钮
   - Browse skills.sh 按钮
   - Refresh 按钮

2. Local Skills 列表
   - name
   - description
   - source
   - tags
   - path
   - 被多少 Agent 使用
   - 操作：View、Edit、Delete、Assign to Agent

3. skills.sh Browser
   - 以 modal 或 split panel 展示
   - 搜索框
   - 分类/标签过滤
   - skill 卡片
   - Install / Import 按钮

#### Skill 卡片字段

- 名称
- 描述
- 来源
- 标签
- 是否已安装
- 使用中的 Agent 数量

---

### 7.4 Global Prompts 页面

全局提示词模板管理。

#### 页面目标

创建、编辑、删除 Prompt Templates，并查看被哪些 Agent 使用。

#### UI 区域

1. 左侧 prompt 列表
   - 搜索
   - 标签过滤
   - 新建按钮

2. 右侧编辑器
   - Prompt 名称
   - 描述
   - 标签
   - Markdown 内容编辑器
   - Preview 模式
   - Save / Delete

3. 使用情况
   - 当前 prompt 被哪些 Agent 启用

---

### 7.5 Global MCP 页面

全局 MCP 配置管理。

#### 页面目标

管理 MCP server 配置。首版只做配置，不运行。

#### UI 字段

- name
- description
- command
- args
- env
- tags
- globally enabled
- used by agents

#### 操作

- 新增 MCP config
- 编辑 MCP config
- 删除 MCP config
- 复制配置
- 分配给 Agent

---

### 7.6 Global Models 页面

全局 Provider / Model 管理。

#### 页面目标

管理 pi 的 `models.json` 与默认模型设置。

#### UI 结构

1. Provider 列表
   - provider name
   - api type
   - baseUrl
   - model count
   - default badge
   - status

2. Provider 详情编辑
   - name
   - baseUrl
   - api type
   - apiKey
   - custom headers
   - model list

3. Model 列表
   - id
   - display name
   - reasoning support
   - input types
   - context window
   - max tokens

4. 操作
   - Add Provider
   - Add Model
   - Delete Provider
   - Set as Default
   - Test Connection

#### 注意

- 首版只支持 API key 模式
- OAuth 登录为未来 TODO

---

### 7.7 Sessions 页面

全局或按 Agent 查看 sessions。

#### 页面目标

查看所有 Agent 的会话，也可以按 Agent 过滤。

#### UI 区域

1. 左侧过滤器
   - Agent
   - 时间范围
   - 标签
   - 工作目录
   - 模型

2. Session 列表
   - session name
   - agent name
   - cwd
   - first user message
   - updated time
   - message count
   - token/cost
   - branch count

3. 批量操作栏
   - Delete selected
   - Export selected
   - Add tag

4. Session Preview Drawer
   - 线性消息预览
   - Session tree 预览
   - Open in Chat

---

### 7.8 Chat 页面

核心主页面，用于多 tab 对话。

#### 页面目标

用户可以选择 Agent，打开一个或多个会话 tab，并继续与 pi agent 对话。

#### 页面布局

```
┌─────────────────────────────────────────────────────────────┐
│ Top Bar: Agent selector | Model selector | Thinking level    │
├───────────────┬──────────────────────────────┬──────────────┤
│ Session Tabs  │ Chat Messages                 │ Session Tree │
│ / Agent Panel │                              │ / Branches    │
│               │                              │              │
│               │                              │              │
├───────────────┴──────────────────────────────┴──────────────┤
│ Composer: input + attachments + send                         │
└─────────────────────────────────────────────────────────────┘
```

#### 顶部栏

- Agent selector
- Current session selector
- Model provider selector
- Model selector
- Thinking level selector
- New session
- Resume session
- Abort

#### 左侧栏

- 当前打开的 chat tabs
- 每个 tab 显示 Agent 名称、session 名称、状态
- 支持关闭 tab
- 支持新建 tab

#### 中间 Chat Area

消息类型：

- User message
- Assistant message
- Thinking block
- Tool call block
- Tool result block
- Bash output block
- Error message
- Compaction summary
- Branch summary

渲染能力：

- Markdown
- GFM tables
- Code highlighting
- Mermaid flowcharts
- 图片预览
- 音频播放
- 视频播放
- 文件附件列表

#### 右侧 Session Tree Panel

展示 pi session JSONL 的树结构。

功能：

- 显示 message / tool / compaction / branch summary 节点
- 当前分支高亮
- 支持点击节点切换分支
- 支持搜索节点内容
- 支持 label / bookmark
- 支持只看 user message / no-tools / all 等过滤模式

#### 输入框 Composer

- 多行输入
- 支持粘贴图片
- 支持上传文件
- 支持拖拽图片
- 支持发送
- streaming 中支持 steer / follow-up 选项

---

## 8. 导航结构

主导航建议：

1. Agents
2. Chat
3. Sessions
4. Packages
5. Skills
6. Prompts
7. MCP
8. Models
9. Settings

其中 Agents 是中心入口，Chat 是主要使用入口，Packages/Skills/Prompts/MCP/Models 是全局资源管理。Packages 是资源来源管理层，Skills/Prompts 是从 packages 或本地目录中解析出的具体可用资源。

---

## 9. 关键用户流程

### 9.1 创建 Agent 并开始对话

1. 用户进入 Agents 页面
2. 点击 New Agent
3. 输入名称、描述、标签
4. 选择默认模型和 thinking level
5. 从全局 skills 中选择启用项
6. 从全局 prompts 中选择启用项
7. 从全局 MCP config 中选择启用项
8. 保存 Agent
9. 点击 Start Chat
10. 创建新 session 并进入 Chat 页面

### 9.2 从 skills.sh 导入 skill

1. 用户进入 Global Skills 页面
2. 点击 Browse skills.sh
3. 搜索 skill
4. 查看 skill 详情
5. 点击 Import / Install
6. Skill 加入全局 skill 池
7. 用户可以分配给某个 Agent

### 9.3 恢复历史会话并切换分支

1. 用户进入 Sessions 页面或 Agent Detail 的 Sessions Tab
2. 搜索历史 session
3. 点击 Open in Chat
4. Chat 页面打开新的 tab
5. 右侧显示 session tree
6. 用户点击某个历史节点
7. 系统切换到对应分支
8. 用户继续输入消息，生成新分支

### 9.4 在线切换模型

1. 用户在 Chat 顶部选择 Model Provider
2. 选择 Model
3. 选择 Thinking Level
4. 当前 session 记录 model_change / thinking_level_change
5. 后续消息使用新模型

---

## 10. UI 视觉方向

### 10.1 设计关键词

- 专业
- 高密度
- 暗色
- 工具感
- 面向开发者
- 类 IDE / DevTool
- 信息架构清晰
- 支持长时间使用

### 10.2 风格参考

- Linear 的清爽密度
- VS Code 的工具布局
- Raycast 的命令感
- GitHub Copilot Chat 的消息结构
- Cursor Settings 的模型配置体验

### 10.3 色彩建议

- 背景：深灰黑 `#0f1117`
- 面板：`#161922`
- 边框：`#2a2f3e`
- 主文字：`#e4e7ed`
- 次文字：`#9ca3b4`
- Accent：蓝紫色 `#7c8cf8`
- 成功：绿色
- 警告：橙色
- 错误：红色

### 10.4 组件风格

- 圆角中等
- 边框细
- hover 明确
- 表格密度较高
- 卡片用于 Agent
- 资源列表使用 table/list hybrid
- Chat 使用三栏布局

---

## 11. MVP 范围

### MVP 必须包含

1. Agents 页面
2. Agent 创建 / 编辑
3. 全局 Packages 管理
4. 全局 Skills 管理
5. 从 skills.sh 导入 skill 的 UI 原型
6. 全局 Prompts 管理
7. 全局 MCP 配置管理
8. 全局 Models 管理
9. Sessions 页面
10. Chat 页面三栏布局
11. Session Tree 可视化原型
12. 多 tab Chat 原型
13. Model / Thinking Level 在线切换 UI

### MVP 不需要真实实现

- skills.sh 实际 API 调用
- MCP 实际运行
- OAuth 登录
- 桌面打包
- 后端真实连接 pi SDK

---

## 12. v0.app UI 原型生成 Prompt

下面这段可以直接输入给 v0.app：

---

Build a high-fidelity web app prototype for **Pi Studio**, a developer tool for managing [pi.dev](https://pi.dev/) global configurations, Agent Profiles, and multi-session chat workflows.

The app should use a dark professional IDE-like design, optimized for power users and developers. Use a dense but clear layout similar to VS Code, Linear, Cursor settings, and GitHub Copilot Chat.

### Product Concept

Pi Studio manages global pi resources:

- Skills
- Prompt Templates
- MCP configurations
- Model Providers / Models

Users can create named **Agent Profiles**. Each Agent can select which global skills, prompts, MCP configs, and models are enabled for that agent. Sessions are grouped by Agent. Chat supports restoring historical sessions, multi-tab conversations, online model switching, thinking level switching, and a visual session tree for branch navigation.

### Main Navigation

Create a left sidebar with these sections:

1. Agents
2. Chat
3. Sessions
4. Packages
5. Skills
6. Prompts
7. MCP
8. Models
9. Settings

Use icons, active state, and compact labels.

### Pages to Prototype

#### 1. Agents Dashboard

Show a grid/list of Agent cards.

Each Agent card should show:

- Agent name
- Description
- Tags
- Default model
- Default thinking level
- Number of enabled skills
- Number of enabled prompts
- Number of enabled MCP configs
- Number of sessions
- Last used time
- Buttons: Chat, Configure, Duplicate, Delete

Top bar:

- Search agents
- Tag filter
- New Agent button

#### 2. Agent Configuration Page

Create tabs:

- Overview
- Skills
- Prompts
- MCP
- Models
- Sessions
- Settings

Overview tab shows summary stats and editable metadata.

Skills tab shows a two-column picker:

- Left: all global skills with search/filter
- Right: skills enabled for this Agent
- Toggle/checkbox per skill

Prompts and MCP tabs use similar picker layout.

Models tab lets the user select allowed providers/models and set:

- Default provider
- Default model
- Default thinking level

Sessions tab shows sessions belonging to this Agent.

#### 3. Global Packages Page

Show pi package management. Packages are installed from npm, git, URL, or local path and can contain extensions, skills, prompt templates, and themes.

Include:

- Installed packages list
- Search packages from pi.dev/packages
- Install package button
- Update package button
- Remove package button
- Enable/disable resources from a package
- Package scope selector: Global / Project-local, but MVP can focus on Global

Package row/card should show:

- Package source, e.g. npm:@foo/bar, git:github.com/user/repo, local path
- Package type: npm/git/local
- Version or pinned ref
- Install scope: global/project
- Contained resources count: extensions, skills, prompts, themes
- Security warning for packages containing extensions
- Status: installed, update available, pinned, error
- Actions: Configure Resources, Update, Remove, Open Source

Add a package discovery panel using pi.dev/packages:

- Search package gallery
- Package preview image/video if available
- Description
- Resource badges
- Install command preview
- Install button

Important security note: Pi packages can execute arbitrary code through extensions. Show an explicit warning before installing third-party packages.

#### 4. Global Skills Page

Show global skill management.

Include:

- Search local skills
- Browse skills.sh button
- Import button
- Skill list/table

Each skill row/card:

- Name
- Description
- Source: skills.sh/local/git/manual
- Tags
- Path
- Used by number of Agents
- Actions: View, Edit, Delete, Assign to Agent

Add a `Browse skills.sh` modal or side panel:

- Search bar
- Category/tag filters
- Skill cards
- Install/Import button
- Installed badge

#### 5. Global Prompts Page

Create a split-pane prompt manager:

- Left: prompt list with search, tags, New Prompt button
- Right: prompt editor

Editor fields:

- Name
- Description
- Tags
- Markdown content editor
- Preview tab
- Save/Delete buttons
- Used by Agents section

#### 6. Global MCP Page

Create a table for MCP configs.

Fields:

- Name
- Description
- Command
- Args
- Env count
- Tags
- Used by Agents
- Actions: Edit, Duplicate, Delete, Assign

Add form modal for editing MCP config:

- command
- args
- environment variables

Make it clear that MVP only manages MCP config and does not run MCP servers.

#### 7. Global Models Page

Create provider/model management UI.

Left side: Provider list.

Provider card/row shows:

- Provider name
- API type
- Base URL
- Number of models
- Default badge
- Status

Right side: Provider detail editor:

- Name
- Base URL
- API type select
- API key input
- Headers editor
- Model table
- Add model button
- Test connection button
- Set as default button

Model table fields:

- Model id
- Display name
- Reasoning support
- Input type text/image
- Context window
- Max tokens

Show a note: OAuth is future TODO, MVP supports API key mode.

#### 8. Sessions Page

Create a session management table.

Filters:

- Agent filter
- Date range
- Tags
- Working directory
- Model

Session row fields:

- Session name
- Agent name
- Working directory
- First user message preview
- Updated time
- Message count
- Token/cost
- Branch count
- Actions: Open in Chat, View Tree, Delete

Add batch selection with batch delete/export/tag actions.

Include a right drawer preview with:

- Linear message preview
- Session tree preview
- Open in Chat button

#### 9. Chat Page

This is the main page. Build a three-column layout:

Left column:

- Open chat tabs
- New tab button
- Agent selector
- Session selector
- Each tab shows Agent name, session name, status, close button

Top bar:

- Agent selector
- Current session name
- Model provider selector
- Model selector
- Thinking level selector: off/minimal/low/medium/high/xhigh/max
- New session
- Resume session
- Abort button

Center column:

- Chat messages
- User message bubbles
- Assistant responses with Markdown rendering
- Collapsible thinking blocks
- Collapsible tool call/result blocks
- Bash output blocks
- Error blocks
- Mermaid diagram preview example
- Image preview example
- Audio/video preview example

Bottom composer:

- Multiline input
- Attachment button
- Image paste/upload indication
- Send button
- When streaming: show options for steer/follow-up

Right column:

- Session Tree / Branches panel
- Tree nodes with parent-child structure
- Current branch highlighted
- Labels/bookmarks
- Search tree
- Filter modes: default, no-tools, user-only, labeled-only, all
- Clicking a node switches branch

### Visual Design

Use dark theme:

- Background: #0f1117
- Panel: #161922
- Raised panel: #1c2030
- Border: #2a2f3e
- Main text: #e4e7ed
- Secondary text: #9ca3b4
- Accent: #7c8cf8

Use clean cards, compact tables, subtle borders, developer-tool aesthetics. Avoid marketing website style. It should feel like an advanced local control panel for an AI coding agent.

### Components Needed

- Sidebar navigation
- Agent cards
- Resource picker
- Table with batch selection
- Modal
- Drawer
- Tabs
- Tag chips
- Toggle switches
- Code/Markdown preview blocks
- Chat message components
- Session tree component
- Model selector
- Thinking level selector

Generate a polished, realistic UI prototype with fake but plausible data.

---

## 13. 后续技术方案文档建议

PRD 确认后，下一步建议输出独立技术方案文档，包括：

1. 文件存储方案
2. Agent Profile 存储格式
3. Session 与 Agent 的关联方式
4. 后端 API 设计
5. WebSocket chat 协议
6. pi packages 集成方案
7. skills.sh 集成方案
8. pi SDK 集成方案
9. 桌面 Tauri 封装方案
