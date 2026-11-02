# PI-Ext

个人 Pi 插件，使用 pnpm workspace 和 TypeScript。

```sh
pnpm install
pnpm dev
```

插件入口：`packages/<name>/src/index.ts`。

`pnpm check` 执行各插件的 `check` 脚本。

`pi install .` 安装全部插件。

`codex-bar`：输入框下显示 Codex 剩余额度、Effort 和 Fast。

`/fast on|off` 设置请求优先级，`/fast` 切换，`/fast status` 查看。设置仅在当前会话有效；未设置时沿用 provider 配置。状态栏区分请求设置与服务端实际状态。
