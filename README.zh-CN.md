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
| `/project:touch [instructions]` | 精简梳理项目结构、架构、业务与关键数据流 |
| `/language:practice [preferences]` | 开始带纠错和学习记忆的语音外教课 |

```text
/review:fix
/review:fix 重点整理状态封装与异常处理
/tasks review:fix 重点检查项目规范
/project:touch
/project:touch 重点了解订单业务与数据持久化
```

`review:fix` 检查封装、职责划分、规范、正确性和测试，直接进行最小修复与验证，保留用户已有工作区改动及暂存状态。不自动暂存或提交；涉及业务歧义、破坏性变更或大规模重构时先确认。

`project:touch` 只读分析当前项目（也可指定子目录或业务场景），以核心目录职责、架构边界和一到两条关键业务／数据流帮助快速上手，并给出少量源码入口。默认控制在一屏左右，不逐文件罗列、不修改代码，不确定的实现会明确标注。

#### 语音外教课

`language:practice` 使用 [pi-gpt-voice](https://pi.dev/packages/pi-gpt-voice) 提供实时语音。首次执行 `pi install npm:pi-gpt-voice`，然后 `/reload`。语音使用该扩展的 ChatGPT 登录或已有的 `openai-codex` 登录；需要时执行 `/voice login` 和 `/voice setup`。本仓库 setup 负责启用 `skill-manager`，不会安装可选的语音依赖。

```text
/language:practice 学英语，母语中文，20 分钟，聊工作面试
```

任务准备完成后，在同一会话、同一受信任的项目目录执行 `/voice realtime`。也可以不带参数，通过几轮对话确定偏好。老师会复用记忆、逐步深入话题，用目标语言交流、用母语解释纠错。发音评价必须有实际音频依据。语法、词汇、用法和发音薄弱项会写入本地记忆，在后续课程中复习考察。

记忆保存在 `~/.pi/agent/language-practice`（或 `PI_CODING_AGENT_DIR` 下），包括学习档案、按语言分开的复习记录和课时笔记。任务会临时向 `.pi/REALTIME-SYSTEM-PROMPT.md` 添加课堂指令，正常结束时移除，保留其他内容。意外断线保留最近一次保存的进度，可再次执行 `/language:practice` 恢复。说“结束通话”会保存并关闭语音，也可用 `/voice stop` 立即停止。时长在对话中检查，不是精确的自动断线定时器。手动清理课堂提示词时，在上课目录运行 `node packages/skill-manager/tasks/language/practice/scripts/lesson.mjs finish`；不在本仓库上课时请使用脚本的绝对路径。

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

### study-mode

在 Pi 里定学习路线、上课和练习。运行 setup 时勾选 `study-mode`，然后输入 `/study 学习主题`，或者只输入 `/study`。接下来可以直接用自然语言答题、确认计划、继续下一课或暂停。上课、测验和补漏等环节会使用下表对应的教学规则。

```text
/study 我想学大模型，会 Python，每周能学五小时
```

学习检查点单独保存在 `~/.study/`，每个主题一份 JSONL 日志，包含已确认的计划、已学内容、测验结果、知识漏洞和待继续的问题或活动。备份该目录即可保留这些记录。新开 Pi 会话后输入 `/study` 可以恢复，有多个主题时可选择；也可以输入 `/study 新主题` 开始另一项学习。完整聊天历史由 Pi 自己保存。

如果想直接做某项活动，也可以输入 `/study <模式> [补充说明]`。

| 模式 | 功能 |
| --- | --- |
| `roadmap` | 摸底并拟定带验收目标的学习路线 |
| `plan` | 把某一级拆成课程和练习 |
| `lesson` | 一次讲一个概念，等你动手练习 |
| `quiz` | 逐题测验，判分并找出知识漏洞 |
| `feynman` | 针对一个漏洞，用复述练习补漏 |
| `sheet` | 整理一份五分钟可读完的速查表 |
| `project` | 定义项目交付物，按标准审查你的成果 |
| `exam` | 对整个级别做综合测验，指出下一步复习内容 |

```text
/study roadmap 我想学大模型，会 Python，每周能学五小时
/study lesson 自注意力
/study quiz 自注意力这节课
```

学习目标明确时，Pi 直接出一道具体的摸底题。它一次只问一题，根据你的回答说明从哪一级开始、哪些级别可以跳过，再补问缺失的时间和练习方式。建议稿包括 2～6 级阶梯、按使用顺序排列的 5 份资料，以及起始级默认约 20 小时的实操课程。Pi 会按每周可用时间估算学习周期，等你确认后定稿。

提示词以英文编写，老师用你的语言回复。
