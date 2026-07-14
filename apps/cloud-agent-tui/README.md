# LightOps TUI

Terminal UI for LightOps Cloud Agent.

Start Cloud Agent first:

```bash
node apps/cloud-agent/src/server.mjs
```

Then run:

```bash
node apps/cloud-agent-tui/src/main.mjs
```

Or use the launcher:

```bash
bin/lightops
```

Windows PowerShell:

```powershell
.\bin\lightops.ps1
```

## Real model

The TUI uses the local rule model by default. To enable DeepSeek, provide a local API key through an environment variable:

```bash
export DEEPSEEK_API_KEY="your-key"
node apps/cloud-agent-tui/src/main.mjs
```

PowerShell:

```powershell
$env:DEEPSEEK_API_KEY="your-key"
node apps/cloud-agent-tui/src/main.mjs
```

You can also store local-only secrets in `.lightops/tui.env`, which is ignored by git:

```text
DEEPSEEK_API_KEY=your-key
DEEPSEEK_MODEL=deepseek-chat
```

Optional settings:

- `DEEPSEEK_BASE_URL`, default `https://api.deepseek.com`
- `DEEPSEEK_MODEL`, default `deepseek-chat`
- `DEEPSEEK_TEMPERATURE`, default `0.2`

Commands:

- `/scan`
- `/incident create`
- `/fix`
- `/deploy`
- `/rollback`
- `/audit`
- `/config`
- `/quit`

Natural language input is also supported. Examples:

```text
帮我体检一下云端项目状态
接口 500，创建一个事故
根据最近事故生成本地修复任务
回滚最近一次部署
```

The TUI runs a Claude Code style query loop:

- preprocess conversation context
- stream assistant text with typewriter output
- call Cloud Agent tools
- append tool results
- continue until no follow-up is needed
- persist transcript as JSONL under `.lightops/tui-sessions`

Tool system:

- Cloud tools are exposed through a unified `ToolRegistry`.
- Real models receive JSON schemas for each tool.
- `shell.read` is available as a conservative read-only diagnostic command tool.
- Complex shell syntax, destructive commands, publishing commands, and unknown commands are rejected.
- Tool output is budgeted before it is written back into the conversation.

See `docs/tool-system-and-query-loop-design.md` for the full design.
