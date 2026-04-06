# OpenClaw Context Hygiene

> Three-layer context compression for OpenClaw — snipCompact, contextCollapse

## What It Does

`context-hygiene` is an OpenClaw hook that automatically cleans up your AI conversation context, keeping long sessions fast and stable.

```
用户发消息
    ↓
before_prompt_build (Layer 0 snipCompact ~5ms)
  → 移除 zombie 消息
  → 去重重复的 tool_result
  → 清理空消息
    ↓
AI 处理消息
    ↓
before_compaction (Layer 2 contextCollapse)
  → 激进压缩（需要时）
    ↓
返回 AI 回复
```

## Three Layers

| Layer | Hook | Speed | Description |
|-------|------|--------|-------------|
| Layer 0 | `before_prompt_build` | ~5ms | Fast cleanup: zombie removal, dedup, empty msg removal |
| Layer 1 | (auto by OpenClaw) | ~10-30s | AI model summarizes oldest conversations |
| Layer 2 | `before_compaction` | ~5ms | Aggressive: truncate intermediates, dedup cross-session reads |

## Installation

```bash
# Extract to OpenClaw hooks directory
cp -r openclaw-context-hygiene ~/.openclaw/hooks/context-hygiene

# Restart gateway
openclaw gateway restart

# Verify
openclaw hooks list | grep context-hygiene
```

## Requirements

- OpenClaw 2026.3.24 or later
- Node.js 22+

## Configuration

No configuration required — works out of the box.

## File Structure

```
openclaw-context-hygiene/
├── README.md           # This file
├── LICENSE             # MIT License
├── package.json       # Package manifest
├── HOOK.md            # OpenClaw hook metadata
├── dist/
│   └── index.js       # The hook (self-contained, no external deps)
├── tests/             # 143 test cases
│   ├── test_adversarial.js
│   ├── test_semantic.js
│   ├── test_regression.js
│   └── test_easter_egg.js
└── reports/           # Development reports
    ├── bugfix-summary.md
    └── arch-integration-report.md
```

## Testing

```bash
npm test
# or individually:
node tests/test_adversarial.js
node tests/test_semantic.js
node tests/test_regression.js
node tests/test_easter_egg.js
```

## Key Fixes (vs upstream)

- SHA1 content-aware deduplication (not truncation-based)
- stableStringify input keys (handles all input field names)
- Multi-block message support
- Intermediate result collapse
- Consecutive file read deduplication
- Proper null/undefined/content handling

## License

MIT
