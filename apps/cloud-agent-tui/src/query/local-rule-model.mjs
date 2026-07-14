export async function* localRuleModel({ messages, toolResults = [] }) {
  const latestUser = [...messages].reverse().find((message) => message.role === "user");
  const prompt = latestUser?.content || "";

  if (toolResults.length) {
    yield text(summaryFromToolResults(toolResults));
    return;
  }

  if (/体检|scan|检查|健康|状态/i.test(prompt)) {
    yield text("我先运行云端一键体检，收集主机、运行时、日志和健康检查证据。\n");
    yield tool("cloud.scan", {});
    return;
  }

  if (/修复|fix|claude|codex|本地/i.test(prompt)) {
    yield text("我会基于最近的 Incident 生成 LocalFixTask，交给本地 Codex/Claude Code 处理。\n");
    yield tool("cloud.localFixTask.create", {
      objective: prompt
    });
    return;
  }

  if (/事故|告警|bug|异常|500|失败|incident/i.test(prompt)) {
    yield text("我会先创建一个 Incident，把当前现象和最近体检证据固化下来。\n");
    yield tool("cloud.incident.create", {
      symptom: prompt.slice(0, 80),
      description: prompt
    });
    return;
  }

  if (/回滚|rollback/i.test(prompt)) {
    yield text("我会查找最近部署并创建一次受控回滚记录。\n");
    yield tool("cloud.rollback.latest", {});
    return;
  }

  if (/部署|deploy|版本|镜像/i.test(prompt)) {
    yield text("部署需要结构化 DeploySpec。请使用 /deploy 打开部署向导，这样可以配置镜像、端口、健康检查和回滚策略。\n");
    return;
  }

  yield text("我可以帮你处理云端体检、业务事故、本地修复任务、部署和回滚。你可以直接说“帮我体检”“创建支付失败事故”“生成本地修复任务”，也可以使用 /scan /incident create /fix /deploy /rollback。\n");
}

function text(content) {
  return { type: "assistant_text", content };
}

function tool(name, input) {
  return { type: "tool_use", name, input };
}

function summaryFromToolResults(toolResults) {
  const lines = ["工具执行完成，我根据结果做一个简要总结："];
  for (const item of toolResults) {
    if (item.toolName === "cloud.scan") {
      lines.push(`- 体检完成：${item.result.summary}，评分 ${item.result.score}。`);
    } else if (item.toolName === "cloud.incident.create") {
      lines.push(`- Incident 已创建：${item.result.id}，等级 ${item.result.severity}，状态 ${item.result.status}。`);
    } else if (item.toolName === "cloud.localFixTask.create") {
      lines.push(`- LocalFixTask 已生成：${item.result.id}，状态 ${item.result.status}。`);
    } else if (item.toolName === "cloud.rollback.latest") {
      lines.push(`- 回滚记录已生成：${item.result.id}，状态 ${item.result.status}。`);
    } else {
      lines.push(`- ${item.toolName} 执行完成。`);
    }
  }
  lines.push("下一步可以继续让我分析结果，或者使用 /audit 查看审计链路。");
  return `${lines.join("\n")}\n`;
}
