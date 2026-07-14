# LightOps Cloud Agent 生产级实现规格说明书

日期：2026-06-30

状态：工程实施基线文档

适用范围：LightOps Cloud Agent、Cloud Agent Web UI、Cloud Agent Deployment Runtime、云端诊断器、云端事件与审计存储、与 Control Plane / Local Bridge 的协议边界。

本文档是后续代码实现的约束文档。实现时如果发现文档和代码冲突，以本文档为准；如果代码需要偏离本文档，必须先更新本文档再修改代码。

## 1. 产品定位

LightOps 的目标用户不是大型企业 SRE 团队，而是个人开发者、小型团队、独立开发者、vibe coding 爱好者、用 AI 快速写出项目但缺少生产运维经验的人。这类用户的最大问题通常不是“写不出功能”，而是“项目写出来后不会稳定上线、不会观测、不会排障、不会安全回滚、不会把线上问题反馈给本地 AI 编码工具修复”。

Cloud Agent 是这个产品的核心。其他部分尽量复用现成方案：

- 本地代码修复使用 Codex、Claude Code、OpenHands、Aider 等现成工具。
- CI 使用 GitHub Actions、GitLab CI、Gitea Actions 或用户现有流水线。
- 镜像仓库使用 Docker Hub、GHCR、阿里云 ACR、腾讯云 TCR、Harbor。
- 复杂团队可以接入 Argo CD、Kubernetes、Prometheus、Loki、OpenTelemetry、Sentry。
- 但普通用户不应该被迫先学会这些工具才能用产品。

Cloud Agent 要解决的是“最后一公里”：

1. 用户把 Agent 装到云服务器。
2. 用户打开浏览器看到云服务器状态。
3. 用户在页面里填写镜像、端口、环境变量、域名、健康检查。
4. Agent 帮用户拉镜像、启动服务、做健康检查、记录版本。
5. 服务出问题时，Agent 自动收集证据。
6. Agent 把证据打包给 Control Plane。
7. Control Plane 把修复任务交给本地 Local Bridge。
8. Local Bridge 调用 Codex/Claude Code 修代码。
9. 修复通过 CI 后，Cloud Agent 执行安全部署、观察和回滚。

一句话：

> Cloud Agent 是装在用户云服务器上的生产运行时控制器、诊断器、部署器和安全审计器。

它不是普通监控 Agent，也不是单纯部署脚本。它必须同时承担：

- 云服务器本地 Web 控制台。
- 无埋点项目的基础探测。
- Java/Node/Python/Docker 服务识别。
- 容器镜像部署运行时。
- 版本和回滚管理。
- 业务 Bug 事故包生成。
- 与本地编码 Agent 的修复任务衔接。
- 所有生产动作的权限控制和审计。

## 2. 设计原则

### 2.1 用户体验原则

用户体验优先级如下：

1. 一键安装。
2. 浏览器可见。
3. 不懂 Linux 也能完成体检、部署、回滚。
4. 不要求一开始有 Prometheus、Loki、OpenTelemetry。
5. 有高级基础设施时可以接入，没有也能独立工作。
6. 每个危险动作都要解释清楚风险。
7. 所有自动化都要保留人工确认入口。
8. 出错时给出下一步，而不是只给日志。

Cloud Agent 的 Web UI 首页必须回答这些问题：

- 这台服务器是否健康？
- 我的项目是否正在运行？
- 最近是否刚发布？
- 当前版本是什么？
- 健康检查是否通过？
- 是否有错误日志？
- 是否有业务 Bug 或告警？
- 是否可以回滚？
- 是否需要本地 Codex/Claude Code 修代码？

### 2.2 工程原则

Cloud Agent 的工程实现必须遵守：

- 单二进制或单进程优先，降低安装复杂度。
- 默认本地文件存储，可平滑升级到 SQLite/PostgreSQL。
- 默认 Web UI 只绑定 `127.0.0.1`，用户确认后才能暴露公网。
- 所有 API 都结构化，禁止用自由文本命令承载生产动作。
- 所有部署动作必须经过 DeploySpec。
- 所有探测结果必须经过 Evidence 模型。
- 所有危险动作必须经过 Policy。
- 所有动作必须写审计日志。
- 所有状态修改必须可恢复。
- 所有外部输入都视为不可信。

### 2.3 安全原则

安全不是后补功能，而是核心功能：

- Cloud Agent 默认只能执行 L0/L1 只读或轻量诊断动作。
- 部署、回滚、重启、端口修改、反代修改属于 L3 生产变更，必须记录审批。
- 数据库迁移、删除数据、修改安全组、执行任意 shell 属于 L4/L5，默认禁止。
- Agent 不应保存密钥明文。运行时只引用 `secret_refs`。
- 日志、环境变量、命令输出进入模型或上传 Control Plane 前必须脱敏。
- Web UI 首次启动不能默认公网暴露。
- 安装脚本必须提供 checksum、签名或版本校验。
- 从镜像仓库拉取镜像时必须记录 digest，不能只记录 tag。
- 任何回滚不能破坏数据库状态。
- Prompt injection 防护必须覆盖日志、README、Issue、网页、第三方文档、异常堆栈。

### 2.4 产品边界

Cloud Agent 不负责：

- 训练模型。
- 替代 Codex/Claude Code 写代码。
- 替代 GitHub/GitLab 管理仓库。
- 替代完整企业级 CMDB。
- 替代 Kubernetes 本身。
- 替代 Prometheus/Loki 的长期大规模存储。
- 自动执行不可逆数据库操作。

Cloud Agent 负责：

- 把云服务器变成可点击、可诊断、可部署、可回滚的生产环境。
- 把线上问题转成标准 Incident Bundle。
- 把部署变成结构化 DeploySpec。
- 把服务器状态转成 Evidence。
- 把生产动作转成审计事件。

## 3. 总体架构

Cloud Agent 内部划分为以下模块：

1. Bootstrap：启动、配置加载、目录初始化、版本检查。
2. Config Manager：配置读取、校验、热更新。
3. Identity Manager：Agent ID、项目绑定、token、Control Plane 连接信息。
4. State Store：本地持久化，存储扫描、事故、部署、审计、配置快照。
5. Audit Log：append-only 审计事件。
6. Web Server：本地 UI 和 REST API。
7. Probe Runtime：主机、进程、容器、HTTP、日志、Java、Nginx、数据库探测。
8. Analyzer Runtime：把探测结果转成 finding。
9. Incident Manager：创建、更新、关闭 Incident。
10. Evidence Store：保存证据摘要和原始证据引用。
11. Deployment Runtime：DeploySpec 校验、预检、发布、健康观察、回滚。
12. Policy Engine：动作风险判断、权限、审批。
13. Secret Manager：secret refs、脱敏。
14. Control Plane Client：上传事件、接收任务。
15. Local Bridge Task Adapter：生成 LocalFixTask。
16. Notification Adapter：邮件、Webhook、飞书、钉钉等后续插件。

模块依赖方向：

- Web Server 调用 Application Services。
- Application Services 调用 Probe/Analyzer/Deployment/Incident。
- Probe/Deployment 调用受控系统适配器。
- 系统适配器不得直接接收用户自由文本命令。
- State Store 和 Audit Log 是底层基础设施。
- Policy Engine 在所有写动作之前执行。

## 4. 运行模式

### 4.1 Standalone 模式

Standalone 是默认模式。用户只安装 Cloud Agent，不配置 Control Plane，也能使用：

- 本地 Web UI。
- 一键体检。
- 项目接入向导。
- 镜像部署。
- 本地事故记录。
- 本地审计。
- 本地回滚。

Standalone 适合个人开发者验证和离线环境。

### 4.2 Connected 模式

Connected 模式下，Cloud Agent 主动连接 Control Plane：

- 上传心跳。
- 上传扫描摘要。
- 上传 Incident Bundle。
- 接收策略。
- 接收部署任务。
- 与 Local Bridge 间接协作。

连接必须是 Agent 主动出站，避免用户云服务器暴露控制端口。

### 4.3 Managed 模式

Managed 模式适合团队：

- 多项目。
- 多服务器。
- 多环境。
- 统一审批。
- 集中审计。
- 统一通知。

Cloud Agent 在 Managed 模式下仍必须保留本地 Web UI，但部分高风险动作由 Control Plane 策略控制。

## 5. 目录结构

Cloud Agent 默认使用：

```text
/var/lib/lightops/
  agent.json
  state/
    state.json
    incidents/
    deployments/
    scans/
    evidence/
  audit/
    audit.jsonl
  apps/
    <project-id>/
      revisions/
      logs/
      volumes/
  secrets/
    secret-metadata.json
  tmp/
```

Windows 或开发环境使用 workspace 下：

```text
.lightops/cloud-agent/
```

目录职责：

- `agent.json`：Agent 身份和基础配置。
- `state/state.json`：当前状态索引。
- `audit/audit.jsonl`：追加式审计日志。
- `apps/<project-id>/revisions`：部署版本元数据。
- `apps/<project-id>/logs`：Agent 管理服务的日志引用。
- `evidence`：事故证据引用和摘要。
- `tmp`：临时文件，允许自动清理。

禁止：

- 把 secret 明文写入 state。
- 把完整本地代码上传到 evidence。
- 把不可审计的 shell 输出当成状态。

## 6. 配置模型

配置分为四层：

1. 默认配置。
2. 本地配置文件。
3. Control Plane 下发策略。
4. 环境变量覆盖。

优先级：环境变量 > Control Plane 策略 > 本地配置 > 默认配置。

基础配置：

```json
{
  "agent": {
    "id": "agent_xxx",
    "name": "prod-01",
    "bindHost": "127.0.0.1",
    "port": 3717,
    "publicAccess": false
  },
  "project": {
    "id": "payment-api",
    "name": "Payment API",
    "type": "java-spring",
    "healthcheckUrl": "http://127.0.0.1:8080/actuator/health",
    "logPaths": ["/var/log/payment-api/app.log"]
  },
  "deployment": {
    "defaultRuntime": "agent-container",
    "allowRealDeploy": false,
    "requireApprovalForProd": true,
    "keepRevisions": 5
  },
  "controlPlane": {
    "url": "",
    "tokenRef": ""
  }
}
```

配置校验规则：

- `bindHost=0.0.0.0` 必须要求用户显式确认。
- `allowRealDeploy=true` 必须存在本地审批或 Control Plane 策略。
- `project.id` 只能包含字母、数字、短横线、下划线。
- `logPaths` 必须在允许目录内，不能默认读取 `/root/.ssh` 等敏感目录。
- `controlPlane.tokenRef` 只能引用 Secret Manager。

## 7. TUI 优先与 Web UI 后续扩展

当前阶段产品入口优先级调整为：

1. TUI 终端界面。
2. REST API。
3. Web UI 后续扩展。

原因：

- 目标用户会 SSH 到 Linux 云服务器。
- 用户熟悉 Codex / Claude Code 这类终端交互。
- TUI 更适合快速完成部署、体检、事故、回滚。
- Web UI 可以以后作为低门槛可视化入口，但不阻塞核心链路。

TUI 必须支持：

- `/scan` 一键体检。
- `/incident create` 创建业务事故。
- `/fix` 生成 LocalFixTask。
- `/deploy` DeploySpec 向导。
- `/rollback` 回滚向导。
- `/audit` 审计查看。
- `/config` 配置查看。
- `/refresh` 刷新状态。

TUI 设计原则：

- 声明式组件化结构。
- 所有动作调用 Cloud Agent API。
- 不直接执行生产命令。
- 高风险动作必须要求用户输入确认短语。
- 输入能力包括单行输入、多行输入、选择器和命令面板。
- 后续如果引入 Ink/React，可以保留当前 API 合同，只替换渲染层。

TUI 与 Cloud Agent 通信：

```text
TUI -> REST API -> Cloud Agent services -> Policy/Audit/Store
```

TUI 不是新的生产执行器，它只是终端客户端。

## 7.1 Web UI 规格

Web UI 是产品最重要的入口。它不是附属调试页面，而是面向非 Linux 用户的生产控制台。

### 7.1 页面结构

页面包括：

1. 首页 Dashboard。
2. 一键体检。
3. 项目接入向导。
4. 服务地图。
5. 告警与事故。
6. 业务 Bug 提交。
7. 部署中心。
8. 回滚中心。
9. 日志与证据。
10. 本地修复任务。
11. 设置与安全。

### 7.2 首页

首页展示：

- Agent 状态。
- 项目名称。
- 运行时类型。
- 当前版本。
- 最新体检评分。
- 健康检查状态。
- 最近告警。
- 最近部署。
- 是否可回滚。
- Control Plane 连接状态。
- Local Bridge 连接状态。

首页不应该展示过多运维术语。它应该使用行动导向语言：

- “服务正在运行”。
- “健康检查失败”。
- “最近发布后错误增加”。
- “可以回滚到上一版本”。
- “建议发送给本地 Codex 修复”。

### 7.3 一键体检

一键体检必须分组展示：

- 主机。
- 运行时。
- 应用。
- 日志。
- 网络。
- 数据库。
- 安全基线。
- 部署可回滚性。

每个检查项都有：

- 状态：ok/warning/critical/info。
- 解释。
- 证据。
- 建议动作。
- 是否可自动修复。
- 风险等级。

### 7.4 部署中心

部署中心表单字段：

- 服务名称。
- 环境。
- 运行时：agent-container、agent-process、compose-plugin、k8s-plugin、gitops-plugin。
- 镜像地址。
- tag。
- digest。
- 端口。
- 环境变量。
- secret refs。
- 卷。
- 域名。
- TLS。
- 反向代理。
- 健康检查。
- smoke test。
- 资源限制。
- 回滚策略。

部署中心按钮：

- 预检。
- 保存草稿。
- 部署到 staging。
- 部署到 production。
- 回滚。
- 查看审计。

### 7.5 告警与事故

事故页展示：

- 事故 ID。
- 严重等级。
- 触发来源。
- 时间线。
- 影响范围。
- 证据。
- Analyzer 结果。
- 候选根因。
- 建议动作。
- 是否已生成 LocalFixTask。
- 是否已有 PR。
- 是否已发布修复。

### 7.6 安全设置

安全设置必须提供：

- Web UI 绑定地址。
- 是否允许公网访问。
- 访问 token。
- Control Plane 连接。
- 生产写操作审批。
- secret refs。
- 命令白名单。
- 自动回滚开关。
- 审计日志导出。

## 8. REST API 规格

所有 API 返回 JSON。错误格式统一：

```json
{
  "error": {
    "code": "validation_failed",
    "message": "DeploySpec is invalid",
    "details": []
  },
  "request_id": "req_xxx"
}
```

### 8.1 基础 API

- `GET /api/health`：Agent 健康。
- `GET /api/state`：UI 首页状态。
- `GET /api/config`：脱敏配置。
- `PATCH /api/config`：更新本地配置。

### 8.2 探测 API

- `POST /api/scans`：创建扫描。
- `GET /api/scans`：扫描列表。
- `GET /api/scans/:id`：扫描详情。

### 8.3 事故 API

- `POST /api/incidents`：创建事故。
- `GET /api/incidents`：事故列表。
- `GET /api/incidents/:id`：事故详情。
- `PATCH /api/incidents/:id`：更新事故状态。
- `POST /api/incidents/:id/local-fix-task`：生成本地修复任务。

### 8.4 部署 API

- `POST /api/deployments/validate`：DeploySpec 预检。
- `POST /api/deployments`：创建部署。
- `GET /api/deployments`：部署列表。
- `GET /api/deployments/:id`：部署详情。
- `POST /api/deployments/:id/promote`：切流或确认发布。
- `POST /api/deployments/:id/rollback`：回滚。

### 8.5 审计 API

- `GET /api/audit`：审计列表。
- `GET /api/audit/:id`：审计详情。

API 实现要求：

- 所有 POST/PATCH 都要写审计。
- 所有生产写动作都要过 Policy。
- 所有请求都要有 request_id。
- 所有响应都要 no-store。
- UI API 和 Agent-to-Control API 要分开命名空间。

## 9. State Store 规格

MVP 使用文件存储，但接口必须可替换：

```text
StateStore
  getState()
  saveState(state)
  appendAudit(event)
  listScans()
  getScan(id)
  saveScan(scan)
  listIncidents()
  saveIncident(incident)
  listDeployments()
  saveDeployment(deployment)
```

文件写入要求：

- 写临时文件再 rename，避免半写状态。
- audit 使用 append-only。
- 大证据不放 state.json，只放引用。
- 读取失败时返回明确错误，不能静默覆盖。

状态模型：

```json
{
  "version": 1,
  "bootedAt": "2026-06-30T00:00:00Z",
  "agent": {},
  "scans": [],
  "incidents": [],
  "deployments": [],
  "revisions": [],
  "controlPlane": {},
  "localBridge": {}
}
```

## 10. 审计模型

审计事件字段：

```json
{
  "id": "aud_xxx",
  "request_id": "req_xxx",
  "actor": {
    "type": "user|agent|control_plane|system",
    "id": "local-user"
  },
  "action": "deploy.create",
  "risk_level": "L3_PROD_CHANGE",
  "decision": "allow|deny|require_approval",
  "status": "success|failed|blocked",
  "target": {
    "type": "deployment",
    "id": "dep_xxx"
  },
  "summary": "Created dry-run deployment",
  "details": {},
  "created_at": "2026-06-30T00:00:00Z"
}
```

审计要求：

- 不能删除。
- 不能覆盖。
- 不能记录 secret 明文。
- 每个生产动作必须关联审计。
- 每个 denied 动作也必须记录。

## 11. 探测 Runtime

Probe Runtime 负责从云服务器收集事实，不负责下结论。结论交给 Analyzer。

### 11.1 Host Probe

采集：

- OS。
- 架构。
- hostname。
- uptime。
- CPU core。
- load average。
- total memory。
- free memory。
- disk 使用。
- 网络接口。

MVP 可以先采集 CPU、内存、load，磁盘和网络后补。

### 11.2 Process Probe

采集：

- 进程列表。
- 监听端口。
- systemd unit。
- 启动时间。
- 重启次数。

Windows 开发环境允许降级。

### 11.3 Container Probe

采集：

- Docker/Podman 是否存在。
- 容器列表。
- 镜像。
- 端口。
- 重启次数。
- healthcheck。
- logs tail。

MVP 如果没有 Docker，只记录 runtime missing，不失败。

### 11.4 Java Probe

采集：

- Java 是否存在。
- Java 版本。
- JVM 进程。
- JAR 路径。
- 启动参数。
- 是否配置 Actuator。
- 日志中的异常。

MVP 先通过命令检测 Java 版本和日志签名，后续再加 jcmd/jstack。

### 11.5 HTTP Probe

采集：

- URL。
- status。
- latency。
- body 摘要。
- TLS 证书过期时间。
- DNS 解析。

MVP 先实现 URL 状态和延迟。

### 11.6 Log Probe

采集：

- 文件是否存在。
- 最近 N 行。
- 错误签名。
- 时间窗口。
- 原始文件引用。

日志必须脱敏。

### 11.7 Dependency Probe

采集：

- 数据库连通性。
- Redis 连通性。
- MQ 连通性。
- 外部 HTTP 依赖。

MVP 可以只保留接口，不强制实现。

## 12. Analyzer Runtime

Analyzer 输入 ProbeResult，输出 Finding。Finding 不执行动作。

Finding 字段：

```json
{
  "id": "fnd_xxx",
  "analyzer": "http_probe_analyzer",
  "status": "critical",
  "message": "Health probe failed",
  "evidence_refs": [],
  "confidence": 0.92,
  "suggested_actions": [],
  "risk_level": "L1_DIAGNOSTIC",
  "created_at": "2026-06-30T00:00:00Z"
}
```

Analyzer 列表：

1. host_resource_analyzer。
2. runtime_analyzer。
3. process_analyzer。
4. container_analyzer。
5. java_runtime_analyzer。
6. http_probe_analyzer。
7. log_signature_analyzer。
8. deploy_change_analyzer。
9. security_baseline_analyzer。
10. business_probe_analyzer。

Analyzer 规则：

- 不能夸大置信度。
- 必须引用证据。
- 不能把猜测当事实。
- 找不到证据时输出 `needs_more_evidence`。
- 建议动作必须标注风险。

## 13. Incident 模型

Incident 是业务问题或系统问题的容器。它不是日志列表，而是处理闭环。

状态：

- open。
- triaging。
- waiting_local_fix。
- patch_proposed。
- deploying_fix。
- observing。
- resolved。
- closed。
- escalated。

字段：

```json
{
  "id": "inc_xxx",
  "project_id": "payment-api",
  "severity": "P1",
  "symptom": "接口 500",
  "description": "",
  "status": "open",
  "created_at": "",
  "updated_at": "",
  "evidence_refs": [],
  "findings": [],
  "timeline": [],
  "local_fix_task": null,
  "resolution": null
}
```

严重等级：

- P0：生产全站不可用、数据破坏、安全事故。
- P1：核心业务不可用，如登录、支付、下单。
- P2：部分功能异常。
- P3：非核心问题。

创建 Incident 的来源：

- 用户在 Web UI 提交业务 Bug。
- HTTP 探针失败。
- Analyzer critical。
- Control Plane 下发。
- 外部 webhook。

## 14. LocalFixTask 协议

Cloud Agent 不直接调用 Codex/Claude Code。它生成 Incident Bundle，Control Plane 生成 LocalFixTask，Local Bridge 调用本地 Agent。

Cloud Agent 需要提供：

- 事故摘要。
- 证据引用。
- 最近部署。
- 日志签名。
- 健康检查结果。
- 期望修复目标。

LocalFixTask 中不能包含：

- secret 明文。
- 完整生产日志。
- 数据库明文数据。
- 用户隐私数据。

## 15. DeploySpec 模型

DeploySpec 是唯一允许进入 Deployment Runtime 的部署输入。

字段：

```json
{
  "service": "payment-api",
  "env": "prod",
  "runtime": "agent-container",
  "artifact": {
    "type": "oci_image",
    "image": "registry.example.com/payment-api",
    "tag": "1.0.0",
    "digest": "sha256:..."
  },
  "container": {
    "ports": [],
    "env": {},
    "secret_refs": [],
    "volumes": [],
    "resources": {}
  },
  "network": {
    "domain": "",
    "reverse_proxy": "nginx|caddy|none",
    "tls": "managed|external|none"
  },
  "healthcheck": {
    "type": "http",
    "url": "",
    "path": "",
    "interval_seconds": 10,
    "timeout_seconds": 3,
    "success_threshold": 3,
    "failure_threshold": 3
  },
  "rollback": {
    "strategy": "previous_successful_deploy",
    "keep_revisions": 5,
    "auto_rollback": true
  }
}
```

校验规则：

- service 必填。
- runtime 必填，默认 agent-container。
- artifact.image 必填。
- tag 或 digest 至少一个。
- prod 部署必须有 healthcheck。
- prod 部署必须有 rollback。
- env 中疑似密钥字段不允许明文。
- host_port 必须是 1-65535。
- 同一服务端口不能冲突。
- volume host_path 必须在允许目录或用户确认。

## 16. Deployment Runtime

Deployment Runtime 状态机：

- draft。
- validating。
- blocked。
- approved。
- pulling_artifact。
- preparing_revision。
- starting。
- probing。
- promoting。
- observing。
- succeeded。
- failed。
- rolling_back。
- rolled_back。
- rollback_failed。

MVP 阶段可以实现 dry-run 状态机：

1. validate。
2. create revision record。
3. mark simulated_success。
4. write audit。

生产阶段实现真实 agent-container：

1. docker/podman login。
2. pull image。
3. inspect image digest。
4. create network。
5. create volume。
6. start container with generated name。
7. run healthcheck。
8. update reverse proxy。
9. observe。
10. mark success。

失败时：

- 不停止旧版本。
- 新 revision 标记 failed。
- 保存失败日志。
- 给 UI 展示原因。
- 如已切流，则回滚。

## 17. agent-container 后端

agent-container 是默认部署方式。

容器命名：

```text
lightops_<project_id>_<service>_<revision>
```

标签：

- lightops.project_id。
- lightops.service。
- lightops.revision。
- lightops.deploy_id。
- lightops.managed=true。

启动原则：

- 不使用 `--privileged`。
- 默认限制 CPU/内存。
- 默认只挂载声明的 volume。
- 默认不挂载 Docker socket 到业务容器。
- 默认不传 secret 明文。

镜像规则：

- 必须记录 image。
- 必须记录 tag。
- 能解析 digest 时必须记录 digest。
- 生产部署建议 pin digest。

## 18. agent-process 后端

agent-process 用于不想容器化的用户，例如直接运行 Java JAR。

DeploySpec artifact：

- jar。
- node directory。
- python venv。

生产实现：

- 生成 systemd unit。
- 工作目录在 `/var/lib/lightops/apps/<project>`。
- stdout/stderr 进入 journald 或指定日志。
- healthcheck 通过后标记成功。

安全限制：

- 不允许用户提交任意 shell。
- 启动命令必须结构化：binary + args。
- 环境变量必须脱敏。

## 19. 回滚模型

回滚策略：

- previous_successful_deploy。
- specific_revision。
- manual_only。

回滚要求：

- 必须知道上一成功 revision。
- 必须知道旧容器/进程是否仍可启动。
- 必须保存旧配置。
- 必须保存旧反向代理配置。
- 回滚也要健康检查。
- 回滚失败必须升级事故。

禁止：

- 自动执行数据库反向迁移。
- 自动删除新版本数据。

## 20. 发布后观察

观察窗口：

- 1 分钟：进程或容器是否存活。
- 5 分钟：健康检查、错误日志。
- 10 分钟：延迟和错误率。
- 30 分钟：业务探针。

MVP 先实现：

- 定时 HTTP healthcheck。
- 日志错误签名。
- 容器/进程是否还在。

观察失败条件：

- healthcheck 连续失败。
- 新错误签名出现。
- 容器退出。
- 用户手动标记异常。

## 21. Policy Engine

风险等级：

- L0_READONLY。
- L1_DIAGNOSTIC。
- L2_RECOVERABLE。
- L3_PROD_CHANGE。
- L4_HIGH_RISK。
- L5_FORBIDDEN。

动作映射：

- scan.run：L0。
- incident.create：L0。
- deploy.validate：L1。
- deploy.create.prod：L3。
- deploy.rollback.prod：L3。
- secret.read.raw：L5。
- shell.exec.freeform：L5。

Policy 决策：

- allow。
- deny。
- require_approval。
- require_control_plane。

MVP 可实现简单规则：

- dry-run 部署 allow。
- real prod deploy require_approval。
- inline secret deny。
- freeform shell deny。

## 22. Secret Manager

Secret Manager MVP 只做引用，不做复杂加密存储。

字段：

```json
{
  "name": "db_password",
  "provider": "local_env",
  "env_name": "PAYMENT_DB_PASSWORD"
}
```

要求：

- UI 不能显示 secret value。
- API 不能返回 secret value。
- 审计不能记录 secret value。
- DeploySpec 只能引用 secret_refs。

## 23. Control Plane Client

Connected 模式下，Cloud Agent 主动连接 Control Plane。

事件：

- agent.heartbeat。
- scan.completed。
- incident.created。
- deployment.created。
- deployment.succeeded。
- deployment.failed。
- audit.appended。

连接策略：

- 指数退避重连。
- 本地缓存。
- 恢复后补发。
- Control Plane 不可用不影响本地只读功能。

## 24. 安装脚本规格

Linux 一键安装：

```bash
curl -fsSL https://install.lightops.dev/cloud-agent.sh -o cloud-agent.sh
shasum -a 256 cloud-agent.sh
sudo bash cloud-agent.sh --token <claim-token>
```

安装脚本必须：

- 检测系统。
- 检测架构。
- 创建 lightops 用户。
- 下载二进制。
- 校验 checksum。
- 安装 systemd service。
- 创建数据目录。
- 启动 Agent。
- 打印本地访问 URL。
- 打印 SSH tunnel 命令。

首次默认：

- bindHost=127.0.0.1。
- allowRealDeploy=false。
- requireApprovalForProd=true。

## 25. 错误处理

错误必须分层：

- validation_error。
- policy_denied。
- approval_required。
- probe_failed。
- deployment_failed。
- rollback_failed。
- store_error。
- control_plane_unavailable。

错误响应必须可读：

```json
{
  "error": {
    "code": "policy_denied",
    "message": "Inline secret values are not allowed",
    "next_actions": ["Move DB_PASSWORD to secret_refs"]
  }
}
```

## 26. 日志规范

Agent 自身日志：

- level。
- time。
- request_id。
- action。
- message。

禁止：

- 打印 token。
- 打印 secret。
- 打印完整环境变量。

## 27. 测试策略

测试分层：

- unit：validator、policy、redaction、state machine。
- integration：API、state store、scan。
- smoke：启动服务，调用 health/scan/incident/deploy。
- e2e：Web UI 操作。

MVP 必须有 smoke。

验收命令：

```bash
node --check apps/cloud-agent/src/server.mjs
node apps/cloud-agent/scripts/smoke.mjs
```

## 28. MVP 代码目标

第一阶段生产骨架不是完整生产系统，但必须不像玩具：

必须做到：

- 模块化目录。
- 明确服务层。
- 明确模型。
- 明确验证器。
- 明确状态存储。
- 明确审计。
- 明确 Analyzer。
- 明确 Deployment Runtime 状态机。
- Web UI 使用 API，不硬编码假数据。
- smoke 覆盖核心链路。

暂不做：

- 真实 Docker 部署。
- 真实 systemd 写入。
- 真实 Control Plane WebSocket。
- 真实 secret 加密。
- 真实登录系统。

但接口必须预留。

## 29. 生产化路线

### Phase 1：生产骨架

- 模块化 Node 原型。
- 本地 Web UI。
- 文件状态存储。
- 一键体检。
- Incident。
- DeploySpec dry-run。
- 审计。

### Phase 2：真实 agent-container

- Docker/Podman API。
- 镜像拉取。
- revision。
- healthcheck。
- 回滚。

### Phase 3：安全与联网

- Token。
- Web UI 登录。
- Control Plane 连接。
- Policy 下发。
- LocalFixTask 联动。

### Phase 4：生产插件

- Nginx/Caddy。
- Java Actuator 建议 PR。
- Prometheus/Loki。
- Sentry。
- GitHub/GitLab。

## 30. 验收标准

Cloud Agent 初版验收：

1. 能启动。
2. 能打开 Web UI。
3. 能返回健康检查。
4. 能执行扫描。
5. 能输出 Analyzer findings。
6. 能创建 Incident。
7. 能校验 DeploySpec。
8. 能创建 dry-run deployment。
9. 能记录审计。
10. 能通过 smoke test。
11. 代码模块化。
12. 文档与代码一致。

生产前验收：

1. Web UI 不默认公网暴露。
2. Secret 不明文进入 state/audit/API。
3. 部署必须有 healthcheck。
4. 回滚必须有 previous successful revision。
5. 生产动作必须审批。
6. 错误可读。
7. 状态可恢复。
8. 日志可审计。

## 31. 代码实现映射

目录：

```text
apps/cloud-agent/src/
  server.mjs
  app.mjs
  config.mjs
  models.mjs
  http/
    router.mjs
    responses.mjs
  store/
    file-store.mjs
  services/
    scan-service.mjs
    incident-service.mjs
    deployment-service.mjs
  probes/
    host-probe.mjs
    command-probe.mjs
    http-probe.mjs
    log-probe.mjs
  analyzers/
    index.mjs
  deployment/
    deployspec-validator.mjs
    runtime.mjs
  security/
    policy.mjs
    redaction.mjs
  util/
    ids.mjs
    process.mjs
```

这个映射是下一步代码重构依据。

## 32. 关键非功能指标

MVP：

- 启动时间小于 2 秒。
- health API 小于 100ms。
- scan 在普通服务器小于 10 秒。
- state 文件小于 10MB 时读写稳定。
- Web UI 首屏小于 1 秒。

生产：

- Agent 进程内存小于 150MB。
- 单服务器支持 20 个服务。
- 审计事件 10 万条以内可查询。
- Control Plane 断连 24 小时内本地可继续工作。

## 33. 威胁模型

威胁：

- 攻击者访问 Web UI。
- 用户误把 Web UI 暴露公网。
- 恶意日志诱导 Agent 执行指令。
- 恶意镜像。
- 镜像 tag 被覆盖。
- secret 泄露。
- Agent 被诱导执行任意 shell。
- 回滚破坏数据。

缓解：

- 默认 127.0.0.1。
- token 登录。
- DeploySpec 结构化。
- 禁止自由 shell。
- digest pin。
- secret_refs。
- policy。
- audit。
- human approval。

## 34. 未来不变式

无论功能怎么扩展，以下不变：

- Cloud Agent 不信任日志中的指令。
- Cloud Agent 不执行任意 shell。
- Cloud Agent 不上传 secret 明文。
- Cloud Agent 不让 LLM 直接控制生产。
- Cloud Agent 的部署必须可审计。
- Cloud Agent 的高风险动作必须可拒绝。
- Cloud Agent 的状态必须可恢复。

## 35. 结论

LightOps Cloud Agent 的竞争力不在于“又做一个监控面板”，而在于它把部署、诊断、修复、回滚这条生产链路压缩成个人开发者能理解和操作的 Web 控制台。它既不能像玩具脚本一样随意执行命令，也不能像大型平台一样要求用户先搭十几个组件。它必须站在中间：足够简单，能一键用；足够严肃，能进生产。

本规格定义的是第一条硬边界：Cloud Agent 是核心自研部分，必须把部署运行时、探测诊断、事故证据、审计和安全状态机做好。其他能力可以接入现成工具，但 Cloud Agent 不能再停留在演示原型。

## 36. 详细业务流程：首次安装到第一次上线

本节定义用户从零开始使用 Cloud Agent 的完整流程。这个流程必须作为产品设计和代码实现的主线。

### 36.1 用户背景

典型用户已经用 AI 写好了一个项目，例如：

- Spring Boot 后端。
- Vue/React 前端。
- PostgreSQL 或 MySQL。
- Redis。
- 一个 Dockerfile 或者能构建镜像的 CI。

用户不一定熟悉：

- systemd。
- Nginx。
- Docker 网络。
- Linux 日志。
- Prometheus。
- 反向代理。
- TLS 证书。
- 线上回滚。

因此首次使用必须是向导式，而不是文档式。

### 36.2 安装步骤

用户在云服务器执行安装命令。安装后浏览器打开本地 UI。首次页面要求完成：

1. 设置本机访问 token。
2. 确认 Web UI 是否只允许本地访问。
3. 选择要接入的项目。
4. 选择项目运行方式。
5. 配置镜像或进程。
6. 配置端口。
7. 配置健康检查。
8. 执行第一次体检。
9. 保存项目配置。

每一步必须有“跳过”和“稍后配置”，但部署前必须补齐关键配置。

### 36.3 第一次部署

第一次部署流程：

1. 用户输入镜像地址。
2. Agent 校验镜像地址格式。
3. Agent 检查容器运行时。
4. Agent 检查端口是否被占用。
5. Agent 检查目标目录。
6. Agent 检查 secret refs。
7. Agent 生成 DeploySpec。
8. Agent 展示部署计划。
9. 用户确认。
10. Agent 执行 dry-run 或真实部署。
11. Agent 记录 revision。
12. Agent 做健康检查。
13. Agent 展示结果。

页面必须把部署计划写成人能看懂的描述，例如：

```text
将部署 payment-api:1.0.3 到生产环境。
容器端口 8080 会映射到服务器 8080。
健康检查为 http://127.0.0.1:8080/actuator/health。
如果健康检查失败，旧版本不会被停止。
部署成功后会保留最近 5 个版本用于回滚。
```

### 36.4 第一次失败

首次部署失败是高概率事件。产品必须把失败变成教学流程：

- 镜像拉取失败：展示 registry、tag、登录状态。
- 端口冲突：展示占用端口的进程。
- 健康检查失败：展示 HTTP 状态、日志错误签名。
- 启动失败：展示容器退出码、最近日志。
- 环境变量缺失：展示缺失项，但不展示 secret 值。
- 数据库不可达：展示连接目标和网络建议。

失败后按钮：

- 重新预检。
- 修改配置。
- 查看日志。
- 创建 Incident。
- 发送给本地 Codex/Claude Code 分析。

## 37. 详细业务流程：线上业务 Bug

业务 Bug 不一定来自监控。用户可能只是收到客户反馈：“支付失败”。Cloud Agent 必须支持手工创建业务 Bug。

### 37.1 业务 Bug 表单

字段：

- 功能：登录、注册、下单、支付、上传、搜索、后台管理、自定义。
- 现象：500、超时、页面空白、数据错误、权限错误。
- 发生时间。
- 用户影响范围。
- 是否刚发布。
- 是否可复现。
- 补充描述。

提交后 Agent 自动做：

1. 记录 Incident。
2. 取发生时间前后日志。
3. 执行 HTTP 探针。
4. 查询最近部署。
5. 执行 Analyzer。
6. 生成证据摘要。
7. 如果 Local Bridge 在线，生成 LocalFixTask。

### 37.2 业务 Bug 证据包

证据包必须包含：

- 用户描述。
- 时间窗口。
- 服务版本。
- 最近部署。
- 健康检查。
- 错误日志签名。
- 主机资源状态。
- 运行时状态。
- 可疑配置变更。

证据包不能包含：

- secret。
- 完整用户隐私数据。
- 大量原始日志。
- 未脱敏请求头。

### 37.3 与本地 Agent 的交接

Cloud Agent 不直接修代码。它只提供证据。Local Bridge 负责调用本地 Codex/Claude Code。

交接内容：

```json
{
  "objective": "根据线上证据定位支付失败原因，生成最小修复补丁和测试",
  "evidence_summary": {},
  "suspected_files": [],
  "recent_deploy": {},
  "constraints": {
    "do_not_access_prod": true,
    "do_not_request_secrets": true,
    "produce_tests": true
  }
}
```

## 38. 并发与锁

生产 Agent 必须处理并发：

- 用户同时点击部署。
- 扫描和部署同时发生。
- Control Plane 下发任务时用户本地操作。
- 回滚时新的发布请求到达。

锁模型：

- `scan` 可以并发，但同一项目最多一个 active scan。
- `deployment` 同一服务同一环境只能一个 active deployment。
- `rollback` 和 `deployment` 互斥。
- `config update` 和 `deployment` 对相关服务互斥。

锁记录：

```json
{
  "lock_id": "lock_xxx",
  "resource": "service:payment-api:prod",
  "owner": "deployment:dep_xxx",
  "created_at": "",
  "expires_at": ""
}
```

锁必须有过期时间，避免 Agent 崩溃后永久阻塞。

MVP 可以先实现内存锁，生产版必须持久化。

## 39. 文件存储一致性

State Store 使用文件时必须保证：

- 写入先写 `.tmp`。
- fsync 后 rename。
- rename 后再更新索引。
- audit append 失败时动作不能报告成功。
- state 读取失败时进入 degraded 状态，而不是覆盖文件。

状态文件损坏处理：

1. 尝试读取最近备份。
2. 如果备份可用，进入恢复模式。
3. 如果不可恢复，UI 展示错误。
4. 禁止生产写操作。
5. 允许导出损坏文件给人工分析。

## 40. 真实部署安全门

真实部署必须通过以下门：

1. DeploySpec schema valid。
2. Policy allow 或 approval。
3. artifact 可获取。
4. digest 已记录或用户确认 tag 风险。
5. port 无冲突。
6. healthcheck 已配置。
7. rollback strategy 已配置。
8. previous successful revision 存在，或用户确认这是首次部署。
9. secret refs 可解析。
10. 磁盘空间足够。
11. runtime 可用。
12. 审计写入成功。

任一失败，部署不能继续。

## 41. 真实部署步骤详细定义

agent-container 真实部署：

1. 创建 deployment 记录，状态 validating。
2. 获取服务锁。
3. 执行 policy。
4. 执行 preflight。
5. 状态 pulling_artifact。
6. 拉取镜像。
7. inspect 镜像，记录 digest。
8. 状态 preparing_revision。
9. 创建 revision metadata。
10. 创建网络和卷。
11. 状态 starting。
12. 创建新容器。
13. 启动新容器。
14. 状态 probing。
15. 执行健康检查。
16. 执行 smoke test。
17. 状态 promoting。
18. 切换流量。
19. 状态 observing。
20. 观察窗口。
21. 状态 succeeded。
22. 释放锁。
23. 写审计。

任何步骤失败：

- 写失败原因。
- 保留现场。
- 不影响旧版本。
- 释放锁。
- 必要时 rollback。

## 42. Nginx/Caddy 反向代理策略

Cloud Agent 不应第一版强制依赖 Nginx，但需要设计接口。

ProxyProvider：

```text
validate(config)
render(service, revision)
test()
apply()
rollback()
```

Nginx 策略：

- 生成独立 include 文件。
- 不覆盖用户主配置。
- `nginx -t` 成功才 reload。
- reload 失败自动恢复旧 include。

Caddy 策略：

- 通过 Caddy API 或 Caddyfile 片段。
- 自动 HTTPS 可作为后续增强。

MVP 可以先不真实切流，只记录 proxy plan。

## 43. 日志脱敏规则

脱敏规则必须覆盖：

- `Authorization: Bearer xxx`
- `password=xxx`
- `token=xxx`
- `secret=xxx`
- `api_key=xxx`
- `AKIA...`
- JWT。
- Cookie。
- 数据库连接串密码。

脱敏策略：

- 保留 key 名。
- 替换 value 为 `[REDACTED]`。
- 审计中记录已脱敏。

脱敏必须在：

- 上传 Control Plane 前。
- 进入 LLM 前。
- 写入 Incident evidence 前。
- Web UI 展示前。

## 44. Java/Spring Boot 生产补齐建议

Cloud Agent 发现 Spring Boot 项目无生产探测点时，应生成建议：

- 加入 actuator。
- 开启 health/info/prometheus。
- 添加 build-info。
- 添加 request id filter。
- 添加全局异常处理。
- 添加结构化日志。
- 添加 Docker healthcheck。
- 添加 smoke test。
- 添加 graceful shutdown。

这些建议可以转成 LocalFixTask，由 Codex/Claude Code 自动改代码。

## 45. Node/Python 生产补齐建议

Node：

- `/healthz`。
- pino/winston 结构化日志。
- request id。
- error middleware。
- graceful shutdown。
- Docker healthcheck。

Python：

- `/healthz`。
- logging JSON。
- request id middleware。
- exception handler。
- gunicorn/uvicorn worker 配置检查。
- Docker healthcheck。

## 46. UI 交互验收

UI 必须支持：

- 页面刷新后状态不丢。
- 扫描按钮有 loading。
- 部署按钮有 validation。
- 事故创建后列表更新。
- 错误以用户可懂语言展示。
- 移动端不溢出。
- 关键信息不被卡片嵌套淹没。

UI 不应该：

- 展示大段原始 JSON 作为主要界面。
- 要求用户理解 Linux 命令。
- 用“成功/失败”之外没有解释的状态。

## 47. API 验收用例

用例 1：health。

- 请求 `GET /api/health`。
- 返回 200。
- status=ok。

用例 2：scan。

- 请求 `POST /api/scans`。
- 返回 scan id。
- findings 非空。
- audit 包含 scan.run。

用例 3：incident。

- 请求 `POST /api/incidents`。
- 返回 incident id。
- status=open。
- evidence_refs 或 findings 存在。

用例 4：deploy validation。

- inline secret env。
- 返回 422。
- error code validation_failed。

用例 5：dry-run deploy。

- valid DeploySpec。
- 返回 deployment id。
- dryRun=true。
- audit 包含 deploy.create。

## 48. 代码质量要求

实现要求：

- 单文件 server 不可继续膨胀。
- 业务逻辑不得写在 HTTP handler 内。
- validator 必须独立。
- analyzer 必须独立。
- store 必须独立。
- policy 必须独立。
- UI 静态资源可以保持简单，但 API 合同清晰。

命名：

- 文件用 kebab-case。
- 函数动词开头。
- 模型字段用 camelCase。
- API JSON 字段用 camelCase。

## 49. 后续重构限制

允许：

- 后端从 Node 迁移 Go。
- StateStore 从文件迁移 SQLite。
- Web UI 从原生 JS 迁移 React。

不允许：

- 移除 DeploySpec。
- 绕过 Policy。
- 绕过 Audit。
- 把生产动作改成任意 shell。
- 让 LLM 直接执行部署。

## 50. 本文档的完成定义

本文档超过 3 万字符后，可以作为生产代码重构依据。后续每次增加新模块，必须补充：

- 模块职责。
- 输入输出。
- 状态机。
- 失败处理。
- 安全要求。
- 验收测试。

## 51. 生产发布检查表

Cloud Agent 自身发布前必须逐项检查：

- 是否能在无 Control Plane 情况下启动。
- 是否能在只读文件系统错误时给出明确提示。
- 是否默认绑定 `127.0.0.1`。
- 是否在公网绑定前要求确认。
- 是否能加载默认配置。
- 是否能加载用户配置。
- 是否能输出脱敏后的配置。
- 是否能执行 health API。
- 是否能执行 scan API。
- 是否能创建 Incident。
- 是否能拒绝非法 DeploySpec。
- 是否能拒绝 inline secret。
- 是否能创建 dry-run deployment。
- 是否能写审计。
- 是否能在 audit 写失败时阻断生产动作。
- 是否能在 healthcheck 缺失时阻断生产发布。
- 是否能在 rollback 缺失时阻断生产发布。
- 是否能在 Docker 不存在时降级为 runtime warning。
- 是否能在 Java 不存在时给出项目类型建议。
- 是否能在日志文件不存在时给出修正建议。
- 是否能在 HTTP 探针失败时生成 critical finding。
- 是否能在 API 错误时返回统一错误格式。
- 是否能通过 smoke test。
- 是否能在 Windows 开发环境和 Linux 目标环境保持行为一致。

## 52. 当前代码落地范围

本轮代码必须从玩具原型升级到生产骨架，但不要求一次完成真实容器部署。落地范围：

必须实现：

- `app.mjs` 作为应用组装入口。
- `config.mjs` 作为配置加载器。
- `file-store.mjs` 作为状态存储。
- `responses.mjs` 作为统一响应。
- `router.mjs` 作为 HTTP 路由。
- `scan-service.mjs` 作为体检服务。
- `incident-service.mjs` 作为事故服务。
- `deployment-service.mjs` 作为部署服务。
- `deployspec-validator.mjs` 作为部署规格校验。
- `policy.mjs` 作为动作策略。
- `redaction.mjs` 作为脱敏工具。
- `analyzers/index.mjs` 作为诊断器集合。
- `probes/*` 作为探针集合。
- `runtime.mjs` 作为 dry-run Deployment Runtime。

可以暂缓：

- 真实 Docker API。
- 真实 Nginx 写入。
- 真实登录。
- 真实 Control Plane 长连接。
- 真实 Local Bridge 通信。

本轮代码验收标准：

- 目录结构符合第 31 节。
- API 名称向第 8 节靠拢。
- 旧 API 可以兼容，但新 API 必须存在。
- smoke test 走新 API。
- 旧 Web UI 能正常使用。
- 代码里不再把所有业务逻辑堆在 `server.mjs`。
