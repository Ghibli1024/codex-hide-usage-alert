# codex-plusplus-hide-usage-alert

Codex++ user script for hiding Codex Desktop usage-limit UI.

## 功能

- 隐藏 Codex Desktop 底部的消息限额提醒横幅。
- 隐藏左侧栏的剩余用量卡片。
- 暴露 `window.__codexPlusHideUsageAlert` 诊断对象，便于确认脚本版本、扫描次数和命中次数。

## 边界

本脚本只处理 renderer DOM 展示，不修改请求、账号、额度或服务端状态。

## 安装

复制脚本到 Codex++ 用户脚本目录：

```sh
mkdir -p "$HOME/.config/Codex++/user_scripts"
cp hide-usage-alert.js "$HOME/.config/Codex++/user_scripts/hide-usage-alert.js"
```

然后在 Codex++ 中 reload 用户脚本，或重启 Codex++ 启动的 Codex Desktop。

## 验证

```sh
node --check hide-usage-alert.js
```
