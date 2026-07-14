# LightOps Cloud Agent Prototype

零依赖 Node.js 原型，用于验证 Cloud Agent 的核心链路：

- 本地 Web UI
- 一键体检
- 无埋点项目基础诊断
- Analyzer 输出
- 业务 Bug 创建 Incident
- DeploySpec 预检
- 模拟部署与回滚记录

## Run

```bash
npm run cloud-agent
```

默认访问：

```text
http://127.0.0.1:3717
```

## Config

复制配置：

```bash
copy apps\cloud-agent\config.example.json .lightops.cloud-agent.json
```

或在 Linux：

```bash
cp apps/cloud-agent/config.example.json .lightops.cloud-agent.json
```

默认不会真实部署容器。需要真实部署时，后续版本会要求显式设置：

```json
{
  "deployment": {
    "allowRealDeploy": true
  }
}
```

当前版本仍以 dry-run 和模拟 revision 为主，避免误操作生产环境。
