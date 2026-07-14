# AI DevOps Agent 方案阅读指南

日期：2026-06-29

主文档：

- [轻量级 AI DevOps Agent 平台总体设计](./lightweight-ai-devops-agent-architecture.md)

## 1. 明天优先阅读顺序

建议先看这些章节：

1. `1. 项目目标`
2. `2. 参考资料与开源项目判断`
3. `3. 总体架构`
4. `4.3 云端项目探测与诊断设计`
5. `6. 权限与安全模型`
6. `8. 事故处理链路`
7. `9. 生产前检测体系`
8. `10. 异常情况矩阵`
9. `14. MVP 路线`

如果时间有限，先看 `1、3、4.3、6、14`。

## 2. 最核心结论

这个项目不应该做成“大而全 AIOps 平台”，而应该做成：

> 轻量、自托管、默认安全的 Agent 运维控制中心，把线上故障自动变成本地可修复、可验证、可审计、可上线的任务。

产品核心不是“AI 自动拥有生产权限”，而是：

- Cloud Agent 负责线上证据。
- Cloud Agent Web UI 负责让不熟 Linux 的用户完成体检、告警查看、业务 Bug 提交、镜像部署、发布确认和回滚。
- Local Bridge 负责连接程序员电脑上的 Codex/Claude Code/OpenHands；真正的代码理解、修复、测试交给这些现成本地 Agent。
- Control Plane 负责权限、审计、审批、发布闸门。
- CI/CD 和 GitOps 负责真正上线。

## 3. 最小可行闭环

第一版只做这条链路：

```text
告警触发
  -> Cloud Agent 收集日志/指标/部署信息
  -> Cloud Agent Web UI 展示体检结果和证据链
  -> Control Plane 生成事故包
  -> AI 生成事故摘要和候选根因
  -> Local Bridge 调用 Codex/Claude Code/OpenHands 分析代码并生成 patch
  -> 本地测试通过
  -> 创建 PR
  -> CI/安全扫描通过
  -> Cloud Agent 拉取镜像并按 DeploySpec 发布
  -> 发布后观察
```

第一版不建议做：

- 全自动改生产。
- 任意 shell 执行。
- 自动数据库迁移。
- 自研监控系统。
- 自研完整 coding agent。

## 4. 面向 vibe coding 用户的云端体验

目标用户可能会登录 Linux，但不想长期使用 Linux 命令排障。因此 Cloud Agent 应该内置一个本地 Web 页面：

- 首页：项目是否健康、最近是否发布、当前错误是什么。
- 一键体检：主机、Docker、Java、端口、日志、数据库、Nginx、安全基线。
- 项目接入向导：自动扫描 Java 进程、Docker 容器、开放端口、日志路径。
- 业务 Bug 提交：用户选择“登录失败/下单失败/页面打不开/接口 500”，Agent 自动创建事故。
- 修复建议：展示 Codex/Claude Code 返回的根因、diff、测试结果、PR。
- 发布中心：展示 CI、安全扫描、回滚方案，用户点击确认发布或回滚。
- 部署向导：用户填写镜像、端口、环境变量、域名、健康检查，Agent 自动拉取镜像并部署。

一键安装体验：

```bash
curl -fsSL https://install.lightops.dev/cloud-agent.sh -o cloud-agent.sh
shasum -a 256 cloud-agent.sh
sudo bash cloud-agent.sh --token <claim-token>
```

安装后用户打开：

```text
http://server-ip:3717
```

首次启动建议默认只绑定 `127.0.0.1`，通过 SSH tunnel 访问；用户确认后再允许绑定公网 IP。

## 5. 第一阶段推荐技术选型

| 模块 | 推荐 |
| --- | --- |
| Control Plane | FastAPI + PostgreSQL |
| Event Bus | NATS，简单版可先 Redis Streams |
| Cloud Agent | Go |
| Local Bridge | Python/Node 薄适配器，调用 Claude Code/Codex/OpenHands |
| UI | React + shadcn/ui |
| 日志 | Loki |
| 指标 | Prometheus |
| Trace | OpenTelemetry |
| 安全扫描 | Gitleaks + Trivy + Semgrep |
| 发布 | Cloud Agent Deployment Runtime，自定义拉镜像/端口/域名/健康检查/回滚 |
| 权限 | YAML Policy 起步，后续 OPA |
| Cloud Agent Web UI | Go embed 静态前端或 React/Vite 构建后嵌入 |

## 6. 第一阶段要做的 12 个工程任务

1. 定义 `.lightops.yml` 项目接入配置。
2. 定义 Incident Bundle JSON Schema。
3. 实现 Control Plane 的项目、Agent、事故、审计 API。
4. 实现 Cloud Agent 注册、心跳、只读工具调用。
5. 实现 Cloud Agent 本地 Web UI 和一键体检页面。
6. 实现 Java/Docker/systemd/Nginx/端口/日志自动扫描。
7. 接入 Prometheus/Sentry webhook。
8. 实现日志、指标、部署版本采集。
9. 实现 RCA 报告生成。
10. 实现 Local Bridge 接收 `LocalFixTask` 并调用 Codex/Claude Code/OpenHands。
11. 实现 `LocalFixResult` 回传、patch/test/PR 草稿流程。
12. 实现 CI、安全扫描、人工确认发布前 Gate。

## 7. 必须提前设计好的安全边界

这些不是后期优化，而是第一版就要有：

- 工具权限分级：L0-L5。
- 生产写操作默认禁止。
- 命令白名单。
- 密钥脱敏。
- 工具调用审计。
- 人工审批。
- CI 和安全扫描强制 Gate。
- 发布后观察和回滚。
- prompt injection 防护。
- 不可信输入隔离。
- Cloud Agent Web UI 首次默认不暴露公网。
- 一键安装脚本必须提供 checksum 和最小权限说明。

## 8. 与现有开源项目的关系

| 项目 | 本项目中的定位 |
| --- | --- |
| Claude Code/Codex/OpenHands | 直接作为本地代码 Agent，本项目只做 Bridge 和协议适配 |
| OpenDeRisk | RCA 和 AI-SRE 角色设计参考 |
| K8sGPT | K8s 诊断插件参考 |
| Robusta | 告警增强和 remediation 参考 |
| Argo CD | 可选 GitOps 插件，不作为默认部署依赖 |
| Prometheus/Loki/OTel | 可观测底座 |
| Trivy/Gitleaks/Semgrep | 安全扫描底座 |
| OPA | 策略引擎进阶方案 |
| Netdata | 一键安装、本地 Dashboard、自动主机体检体验参考 |

## 9. 下一步建议

下一步不要继续空泛设计，应该拿一个真实项目做接入样例：

1. 写该项目的 `.lightops.yml`。
2. 明确 Cloud Agent 默认部署方式：容器镜像、进程/JAR、已有 Compose、还是已有 K8s 插件。
3. 明确日志位置、健康检查、CI 命令、安全扫描命令。
4. 模拟一个线上异常。
5. 用这个异常反推 Incident Bundle、Cloud Agent 工具、LocalFixTask/LocalFixResult 和 Local Bridge 工作流。
