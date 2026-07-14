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
