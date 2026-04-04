# Context Hygiene Hook for OpenClaw

Three-layer context compression hook for OpenClaw agents.

## Events

| Event | When | Layer | Purpose |
|-------|------|-------|---------|
| `before_prompt_build` | After model resolved, messages ready | L0 snipCompact | ~5ms cleanup before every LLM call |
| `before_compaction` | Before compaction | L2 contextCollapse | Aggressive compression before summarizing |

## What it cleans

**Layer 0 snipCompact** (`before_prompt_build`):
- `[zombie message]` markers
- Empty throttle/warning messages
- Consecutive duplicate tool results
- Consecutive same-file reads (keeps last only)

**Layer 2 contextCollapse** (`before_compaction`):
- Intermediate tool results (same path, keeps final only)
- Cross-conversation file read deduplication
- Large outputs (>2KB → truncated to first line)

## Installation

```bash
# Install via OpenClaw CLI
openclaw plugins install /path/to/openclaw-context-hygiene.tar.gz

# Or from GitHub raw URL
openclaw plugins install https://github.com/steve/openclaw-context-hygiene/releases/latest/download/openclaw-context-hygiene.tar.gz
```

## Manual Installation

```bash
# Extract to OpenClaw hooks directory
mkdir -p ~/.openclaw/hooks
tar -xzf openclaw-context-hygiene.tar.gz -C ~/.openclaw/hooks/

# Enable in config (~/.openclaw/openclaw.json)
# Add to hooks.internal.entries if workspace hook (disabled by default):
{
  "hooks": {
    "internal": {
      "entries": {
        "openclaw-context-hygiene": {
          "enabled": true
        }
      }
    }
  }
}

# Restart gateway
openclaw gateway restart
```

## Verify Installation

```bash
openclaw hooks list
```

You should see `context-hygiene` in the list with status `ready`.

## Uninstall

```bash
rm -rf ~/.openclaw/hooks/openclaw-context-hygiene
openclaw gateway restart
```

## Source

Based on Claude Code v2.1.88 architecture study.
