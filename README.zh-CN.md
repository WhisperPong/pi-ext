# PI-Ext

[English](README.md) | [简体中文](README.zh-CN.md)

Pi 扩展集合。

## 安装

在本仓库目录中执行：

```sh
pnpm run setup
```

安装向导使用键盘交互式多选，已安装的扩展默认勾选。↑/↓ 移动，空格切换勾选，`a` 全选，`n` 清空；按 Enter 查看选择，再选中 **Apply selection** 并按 Enter 安装。Esc 从确认页返回列表，在列表页按 Esc 取消；`q` 或 Ctrl+C 随时取消，不会修改配置。长列表支持自动滚动。

再次运行 setup 可以调整本仓库启用的扩展；未选中的扩展会停用。安装后请保留本仓库目录。

启动 Pi，或在已有会话中执行 `/reload` 加载所选内容。

## 扩展

### skill-manager

通用的内置任务指令管理扩展。任务按系列组织，指令和参考资料都随扩展维护，不再单独安装原生 Skills 或提示词模板。在 setup 中选中 `skill-manager` 即可启用命令。

| 命令 | 功能 |
| --- | --- |
| `/tasks` | 打开任务选择菜单 |
| `/tasks <command> [instructions]` | 执行指定任务，可附加要求 |
| `/review:fix [instructions]` | 检查并直接修复本次代码改动 |

```text
/review:fix
/review:fix 重点整理状态封装与异常处理
/tasks review:fix 重点检查项目规范
```

`review:fix` 检查封装、职责划分、规范、正确性和测试，直接进行最小修复与验证，保留用户已有工作区改动及暂存状态。不自动暂存或提交；涉及业务歧义、破坏性变更或大规模重构时先确认。

命令把任务指令交给当前 Agent 执行，不创建独立 Agent，也不提供强制工作流状态机。任务需要显式调用，不自动匹配；Agent 忙碌时会排到当前运行结束后执行。回复跟随用户语言。

#### 添加任务

```text
packages/skill-manager/tasks/
└── review/
    └── fix/
        ├── TASK.md
        └── references/
            └── checklist.md
```

每个任务目录包含一份 `TASK.md`，声明描述和执行指令：

```markdown
---
description: Check and directly fix current code changes.
---

Follow the project's conventions. Read references/checklist.md when needed.
```

目录路径决定命令：`review/fix/TASK.md` 对应 `/review:fix`。其他系列按相同方式添加，不用修改注册代码。参考资料和脚本放在各任务目录中，Agent 会收到任务目录位置，用于解析相对路径。目录名以小写字母开头，可包含数字及单个连字符。修改后执行 `/reload`。

#### 从独立 Skills 迁移

原 `/skill:review-fix` 改为 `/review:fix`。setup 发现指向本仓库旧目录的 `~/.agents/skills/review-fix` 链接时，会默认勾选 `skill-manager`，并在成功启用扩展后清理该链接。不会删除真实 Skill 目录，也不处理其他来源的链接；以后无需单独安装或同步 Skill。

### codex-bar

使用 Codex 模型时，在输入框下显示剩余额度、思考等级（Effort）和 Fast 状态。

| 命令 | 功能 |
| --- | --- |
| `/fast on` | 为后续请求开启 Fast |
| `/fast off` | 为后续请求关闭 Fast |
| `/fast` | 切换 Fast 模式 |
| `/fast status` | 查看当前 Fast 状态 |

每次启动或重载会话时，Fast 默认关闭。设置仅在当前会话有效，不会改变思考等级。Fast 是否可用取决于模型和账号，开启后可能消耗更多额度。
