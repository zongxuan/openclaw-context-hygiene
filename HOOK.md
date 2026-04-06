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
