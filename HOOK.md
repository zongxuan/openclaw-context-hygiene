---
name: context-hygiene
description: "Three-layer context compression: snipCompact (Layer 0), contextCollapse (Layer 2). OpenClaw hook events: before_prompt_build + before_compaction."
metadata:
  {
    "openclaw":
      {
        "emoji": "🧹",
        "events": ["before_prompt_build", "before_compaction"],
        "install": [{ "id": "bundled", "kind": "bundled", "label": "Bundled with OpenClaw" }],
      },
  }
---

# Context Hygiene Hook

Three-layer context compression for OpenClaw.

## OpenClaw Events

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

## Events vs Claude Code

| Claude Code | OpenClaw | Notes |
|------------|----------|-------|
| `session:compact:before` | `before_compaction` | Same timing |
| `before_prompt_build` | `before_prompt_build` | Same name (verified in OpenClaw hooks doc) |

## Installation

```bash
./install.sh
openclaw gateway restart
```

## Uninstall

```bash
rm -rf ~/.openclaw/hooks/context-hygiene
openclaw gateway restart
```

## Source

Based on Claude Code v2.1.88 architecture study.
