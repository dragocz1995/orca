# Product screenshot manifest

Public documentation screenshots are captured from a live Elowen instance and redacted before they are committed. They illustrate product behavior, not a real user's account, projects, tasks, memories, sessions, provider credentials, or usage data.

| Asset | Surface and state | Viewport | Alt text | Redaction |
| --- | --- | --- | --- | --- |
| `settings-overview.png` | Settings → System | 1600px desktop | Elowen System settings with the spatial section rail and service diagnostics | Identity, timestamp, ports, and service values replaced with demo-safe values. |
| `settings-models.png` | Settings → Models | 1600px desktop | Elowen model catalog with provider groups and enabled models | Identity, provider accounts, and model labels replaced with generic examples. |
| `account-settings.png` | Account → Elowen AI | 1600px desktop | Account control surface with Elowen AI preferences | Identity and provider/model values replaced with generic examples. |
| `web-ui-tasks.png` | Tasks with selected mission | 1600px desktop | Task workspace with a right-side task detail drawer | Task, mission, phase, project, model, time, and identity data replaced with fictional examples. |
| `brain-memory.png` | Memory with selected record | 1600px desktop | Memory workspace with a right-side memory detail drawer | Every memory, category, history item, identifier, URL, model label, and identity is fictionalized. |
| `web-ui-dashboard.png` | Dashboard (Home) | 1755px desktop | Dashboard with the agent state, activity feed and attention rail | Disposable demo instance. |
| `web-ui-kanban.png` | Kanban board | 1755px desktop | Kanban board with tasks across open, in progress, blocked and closed | Disposable demo instance. |
| `web-ui-sessions.png` | Sessions → Conversations | 1755px desktop | Session runtime with the brain conversation history | Disposable demo instance. |
| `web-ui-timeline.png` | Timeline | 1755px desktop | Timeline with commits over time and the most active files | Disposable demo instance. |
| `web-ui-escalations.png` | Escalations inbox | 1755px desktop | Decision inbox with agent questions awaiting a human reply | Disposable demo instance. |
| `projects-list.png` | Projects registry | 1755px desktop | Project registry with paths, Pilot notes and PR workflow | Disposable demo instance; paths shown as `/srv/projects/…`. |
| `projects-editor.png` | Editor with an open file | 1755px desktop | Built-in code editor with the project file tree and an open source file | Disposable demo instance. |
| `users-rbac.png` | Users directory | 1755px desktop | User directory with roles, project boundaries and model permissions | Disposable demo instance. |
| `plugins-overview.png` | Settings → Plugins | 1755px desktop | Installed plugins with their tools, platforms and health | Disposable demo instance. |
| `brain-chat.png` | Dashboard with the chat dock open | 1755px desktop | Elowen answering a product question in the web chat dock | Disposable demo instance. |
| `getting-started-chat.png` | Dashboard with the chat dock open | 1755px desktop | Elowen introducing its capabilities in the web chat dock | Disposable demo instance. |
| `../../screenshots/cli/16-gpt-limits.png` | Terminal chat with GPT-5.5 and telemetry | 956px terminal | GPT-5.5 terminal conversation with live context and subscription limits | Captured in a disposable English-only demo session; the prompt, reply, and working directory are non-sensitive. |

## How the web UI screenshots are produced

The 1755px web UI captures come from a **disposable Elowen instance**, never from a production
daemon: a throwaway SQLite database, a demo admin (`alex`), fictional colleagues (`jordan`, `sam`),
three demo repositories (`acme-api`, `acme-web`, `design-system`) and an English demo task backlog.
Because no real account, repository, memory or credential is ever loaded, nothing needs redacting
after the fact. Capture at a `1755x941` viewport with `deviceScaleFactor: 2` (a 3510×1882 retina
PNG) and keep the UI language set to English.

The CLI screenshots use a separate disposable demonstration session. Never capture a user's active transcript, tokens, API keys, absolute project paths, private task content, or production session identifiers. Existing `09-todos.png` and `11-subagent.png` are English-only demo captures for their respective interaction states.
