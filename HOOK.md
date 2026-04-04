---
name: context-hygiene
description: "Three-layer context compression: snipCompact (Layer 0), contextCollapse (Layer 2). Based on Claude Code architecture."
metadata:
  {
    "openclaw":
      {
        "emoji": "🧹",
        "events": ["before_prompt_build", "session:compact:before"],
      },
  }
---

# Context Hygiene Hook

Three-layer context compression for OpenClaw.

## Hooks

- `before_prompt_build`: Layer 0 snipCompact before every LLM call
- `session:compact:before`: Layer 2 contextCollapse before compaction

## What it cleans

- zombie marker messages
- duplicate consecutive tool results  
- empty throttle/warning messages
- intermediate tool results (same path, keeps last only)
- large outputs (>2KB → truncated)

## Source

ClaudeCodeArchitectureStudy/SYNTHESIS.md
