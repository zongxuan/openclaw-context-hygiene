# OpenClaw Context Hygiene

> Three-layer context compression for OpenClaw — snipCompact, autoCompact, contextCollapse

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
session:compact:before (Layer 2 contextCollapse)
  → 激进压缩（需要时）
    ↓
返回 AI 回复
```

## Three Layers

| Layer | Name | Speed | Description |
|-------|------|--------|-------------|
| Layer 0 | snipCompact | ~5ms | Fast cleanup: zombie removal, dedup, empty msg removal |
| Layer 1 | autoCompact | ~10-30s | AI model summarizes oldest conversations |
| Layer 2 | contextCollapse | ~5ms | Aggressive: truncate intermediates, dedup cross-session reads |

## Installation

```bash
# Download and extract
tar -xzf openclaw-context-hygiene.tar.gz
cd openclaw-context-hygiene

# Install
./install.sh

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

## Uninstall

```bash
rm -rf ~/.openclaw/hooks/context-hygiene
openclaw gateway restart
```

## Files

```
├── HOOK.md           # OpenClaw hook metadata
├── index.js          # Self-contained hook (no external dependencies)
├── install.sh         # Install script
├── README.md         # This file
├── LICENSE            # MIT License
└── package.json      # Package manifest
```

## License

MIT

## Credits

Based on Claude Code v2.1.88 architecture study.
See: [Claude Code Architecture Study](https://github.com/steve/ClaudeCodeArchitectureStudy)
