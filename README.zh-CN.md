# PI-Ext

[English](README.md) | [简体中文](README.zh-CN.md)

Pi 插件集合。

## 安装

在本仓库目录中执行：

```sh
pnpm run setup
```

启动 Pi，或在已有会话中执行 `/reload` 加载插件。

## 插件

### codex-bar

使用 Codex 模型时，在输入框下显示剩余额度、思考等级（Effort）和 Fast 状态。

| 命令 | 功能 |
| --- | --- |
| `/fast on` | 为后续请求开启 Fast |
| `/fast off` | 为后续请求关闭 Fast |
| `/fast` | 切换 Fast 模式 |
| `/fast status` | 查看当前 Fast 状态 |

每次启动或重载会话时，Fast 默认关闭。设置仅在当前会话有效，不会改变思考等级。Fast 是否可用取决于模型和账号，开启后可能消耗更多额度。
