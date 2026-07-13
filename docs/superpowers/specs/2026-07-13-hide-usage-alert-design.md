# Hide Usage Alert 0.1.4 修复设计

## 背景

ChatGPT 与 Codex 合并后，额度横幅被放进 composer 根节点。横幅与输入框是兄弟节点：

```text
composer root
└── layout wrapper
    ├── quota alert
    └── composer
```

0.1.3 会扫描所有 `div`，仅凭后代文本、按钮文案和尺寸判断额度提醒。layout wrapper 同时包含额度文案和输入框，因此也会被识别为提醒；`quotaBannerRoot()` 继续提升父节点，又扩大了隐藏范围。结果是额度横幅与输入框一起消失。

## 目标

- 只隐藏真正的额度提醒表面，输入框必须保持可见、可编辑。
- 保留旧版底部横幅、左侧使用量卡和 subagent 额度卡支持。
- 消除全页反复扫描所有 `div` 带来的误判与布局开销。
- 保持重复注入、手动扫描和销毁行为幂等。
- 同步独立仓库、Script Market 和本机安装文件为 0.1.4。

## 非目标

- 不修改额度、账号或请求行为。
- 不依赖构建生成的 Tailwind 类名。
- 不修改 ChatGPT/Codex 或 Codex++ 的程序文件。

## 匹配边界

脚本必须先识别最小提醒表面，再决定是否隐藏。以下节点属于保护区：

```text
[data-codex-composer-root]
[data-codex-composer]
[contenteditable]
textarea
input
form
```

候选本身若是保护区，或包含任一保护节点，立即拒绝。这个规则必须同时存在于匹配阶段和最终隐藏阶段，避免未来改动绕过保护。

候选按以下顺序收集：

1. 当前合并版 composer 内的 `aside`。
2. `[role="alert"]`、`[role="status"]`、`[aria-live]` 等语义提醒。
3. 旧版左侧使用量卡和 subagent 裸容器的受限兼容候选。

文本规则只确认候选是否为额度提醒，不能决定隐藏祖先。删除通用 `parentElement` 提升；只有候选本身或不含保护节点的明确语义表面可以成为隐藏根节点。

## 扫描与生命周期

- 首次运行执行一次完整候选扫描。
- `MutationObserver` 只收集新增节点、文字变化节点及必要祖先，在一次短防抖中局部扫描。
- 先用 `textContent` 做文本过滤，命中后才读取尺寸，避免对全页节点触发布局计算。
- 脚本仅在顶层 document 工作；`documentElement` 尚未出现时等待 DOM 就绪。
- 重复注入先执行旧实例 `destroy()`，再安装新 observer 和样式。
- `destroy()` 断开 observer、取消任务、移除样式，并查询所有 marker 后删除 hidden 与 kind 属性；不使用强引用集合保存 DOM。

## 测试

测试必须先复现 0.1.3 的错误，再实现修复。覆盖：

1. 合并版结构：横幅与 composer 为兄弟节点，只隐藏横幅。
2. 保护规则：任何包含 composer、editable、textarea、input 或 form 的候选都不能隐藏。
3. 旧版底部额度横幅仍能隐藏。
4. 左侧使用量卡仍能隐藏。
5. subagent 裸额度卡仍能隐藏。
6. 消息正文引用额度文案时不隐藏消息。
7. 重复注入只保留一个 observer；`destroy()` 完整恢复 DOM。
8. 早期注入时 `documentElement` 不存在也不会同步报错。

## 同步与实机验证

1. 在独立仓库实现并运行测试，版本升为 `0.1.4`。
2. 将相同脚本同步到 Script Market，更新 `index.json` 的版本和 SHA-256。
3. 校验独立仓库、市场脚本和本机安装文件内容一致。
4. 备份本机脚本与 `user_scripts.json`，保持脚本禁用状态完成文件替换。
5. 通过当前 ChatGPT renderer 临时注入 0.1.4，验证：
   - 额度横幅被隐藏；
   - `[data-codex-composer]` 可见、尺寸非零且仍可编辑；
   - `destroy()` 后横幅恢复、输入框不变。
6. 临时验证通过后启用本机脚本并重新加载；再次检查横幅与输入框。

若任一检查失败，立即销毁临时实例、恢复备份并保持脚本禁用。

## 验收标准

- 自动测试全部通过，且合并版回归用例能在旧实现上失败。
- 三份脚本字节一致，Script Market 的 SHA-256 与文件一致。
- 实机上额度横幅不可见，输入框可见、可编辑、尺寸正常。
- 调用 `destroy()` 后页面立即恢复，不残留 marker、样式或 observer。
- 禁用脚本并正常重启 Codex++ 后不再注入脚本。
