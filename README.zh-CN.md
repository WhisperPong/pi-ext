# PI-Ext

[English](README.md) | [简体中文](README.zh-CN.md)

Pi 扩展与 skills 集合。

## 安装

在本仓库目录中执行：

```sh
pnpm run setup
```

安装向导会列出可选扩展和 skills，输入编号进行多选，按 Enter 检查选择，再确认安装。输入 `q` 或按 Ctrl+C 可取消，不会修改配置。

再次运行 setup 可以调整本仓库启用的扩展；未选中的扩展会停用，已有 skills 不会被删除或覆盖。

Skills 通过 `~/.agents/skills/` 供 Pi 和 Codex 共用。安装后请保留本仓库目录。目前尚未内置 skills。

启动 Pi，或在已有会话中执行 `/reload` 加载所选内容。

## 插件

### codex-bar

使用 Codex 模型时，在输入框下显示剩余额度、思考等级（Effort）、Fast 状态和输出速度。

`Speed` 显示最近一次已完成回复的正文输出速度估算（tokens/秒），排除等待和思考阶段。新请求和工具调用期间保留上次有效数值；过短或缓冲后一次性返回的回复不更新速度，暂无有效数据时显示 `--`。

| 命令 | 功能 |
| --- | --- |
| `/fast on` | 为后续请求开启 Fast |
| `/fast off` | 为后续请求关闭 Fast |
| `/fast` | 切换 Fast 模式 |
| `/fast status` | 查看当前 Fast 状态 |

每次启动或重载会话时，Fast 默认关闭。设置仅在当前会话有效，不会改变思考等级。Fast 是否可用取决于模型和账号，开启后可能消耗更多额度。
