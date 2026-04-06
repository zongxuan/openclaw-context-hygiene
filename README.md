# OpenClaw Context Hygiene

<p align="center">
  <img src="https://img.shields.io/badge/OpenClaw-Hook-blue?style=flat-square" alt="OpenClaw Hook">
  <img src="https://img.shields.io/badge/Node-%3E%3D22-green?style=flat-square" alt="Node.js">
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License">
  <img src="https://img.shields.io/badge/Tests-143-green?style=flat-square" alt="Test Cases">
</p>

> 🧹 Three-layer context compression for OpenClaw — keeps your AI conversations fast and stable during long sessions.

## Overview

`context-hygiene` is an OpenClaw hook that automatically cleans up and compresses your AI conversation context through a three-layer strategy. It removes redundant information, deduplicates repeated content, and collapses intermediate results — all while preserving the essential context your AI needs.

### Why You Need This

When you're in a long conversation with an AI, the context grows continuously. Eventually:
- Responses slow down
- Context windows fill up  
- Quality degrades

Context Hygiene solves this by automatically maintaining a lean, efficient context — so your AI stays fast and sharp, session after session.

## Architecture

```
User Message
    │
    ▼
┌─────────────────────────────────────────┐
│  Layer 0: snipCompact (~5ms)            │
│  before_prompt_build hook               │
│  • Remove zombie messages               │
│  • Deduplicate repeated tool_results   │
│  • Clean empty messages                 │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  Layer 1: autoCompact (OpenClaw built-in)│
│  ~10-30s                                │
│  • AI summarizes oldest conversations   │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  Layer 2: contextCollapse (~5ms)         │
│  before_compaction hook                 │
│  • Aggressive compression when needed   │
│  • Truncate intermediates               │
│  • Cross-session read deduplication    │
└─────────────────────────────────────────┘
    │
    ▼
 AI Response
```

## Three Layers Explained

| Layer | Hook | Speed | What It Does |
|-------|------|-------|--------------|
| **Layer 0** | `before_prompt_build` | ~5ms | Fast cleanup: zombie removal, tool_result deduplication, empty message removal |
| **Layer 1** | *(OpenClaw automatic)* | ~10-30s | AI model summarizes oldest conversation segments |
| **Layer 2** | `before_compaction` | ~5ms | Aggressive: truncate long intermediate results, dedup across sessions |

## Features

### Core Deduplication
- **SHA1 content-aware deduplication** — not truncation-based, finds actual duplicates
- **stableStringify input key handling** — handles all input field names correctly
- **Multi-block message support** — processes complex message structures
- **Consecutive file read deduplication** — prevents redundant file reads

### Smart Compression
- **Intermediate result collapse** — shortens lengthy tool outputs to summaries
- **Zombie message removal** — cleans up abandoned message chains
- **Empty message cleanup** — removes null/blank messages

### Security Protection
- **System message preservation** — `role: 'system'` messages (SOUL.md, AGENTS.md, etc.) are protected from all compression operations and never lost

### Reliability
- **No external dependencies** — self-contained, no supply chain risk
- **150+ test cases** — comprehensive coverage including adversarial scenarios and security tests
- **MIT Licensed** — free to use, modify, and distribute

## Requirements

- **OpenClaw** 2026.3.24 or later
- **Node.js** 22+

## Installation

### Option 1: Install via npm (when published)

```bash
npm install openclaw-context-hygiene
```

### Option 2: Manual Installation

```bash
# Clone or extract to OpenClaw hooks directory
git clone https://github.com/zongxuan/openclaw-context-hygiene.git ~/.openclaw/hooks/context-hygiene

# Or copy extracted files
cp -r openclaw-context-hygiene ~/.openclaw/hooks/context-hygiene

# Restart the gateway
openclaw gateway restart

# Verify installation
openclaw hooks list | grep context-hygiene
```

## Configuration

**No configuration required** — works out of the box with sensible defaults.

If you need to customize behavior, edit `index.js` directly.

## Usage

Once installed, the hook activates automatically for all conversations. No additional setup needed.

### Verify It's Working

```bash
# Check hook status
openclaw hooks list

# Should show context-hygiene as active
```

## Testing

Run the full test suite:

```bash
npm test
```

Or run tests individually:

```bash
node test_adversarial.js   # Adversarial input testing
node test_semantic.js      # Semantic deduplication tests
node test_regression.js    # Regression tests
node test_easter_egg.js   # Easter egg tests
```

## File Structure

```
openclaw-context-hygiene/
├── index.js              # Main hook entry point (self-contained)
├── HOOK.md               # OpenClaw hook metadata
├── README.md             # This file
├── LICENSE               # MIT License
├── package.json          # Package manifest
├── test*.js              # Test suites (143 test cases)
├── tests/                # Additional test suites
│   └── test_system_protection.js  # System message protection tests
├── reports/              # Development documentation
│   ├── bugfix-summary.md
│   ├── bugfix-report-*.md
│   └── arch-*-report.md
└── FIX-REPORT.md        # Security fix report (v3.0.0)
```

## Security Fix (v3.0.0)

**Critical fix**: System messages (`role: 'system'`) are now protected from compression. This prevents SOUL.md, AGENTS.md, and other bootstrap file contents from being accidentally removed or corrupted during context hygiene operations.

Protected functions:
- `snipCompact()` — system messages pass through unchanged
- `removeIntermediateToolResults()` — system messages not collapsed
- `dedupeCrossConversationFileReads()` — system messages not deduplicated
- `truncateLargeOutputs()` — system messages not truncated

## Key Fixes (vs Upstream)

This implementation includes several improvements over similar context compression approaches:

| Issue | Solution |
|-------|----------|
| Truncation-based deduplication causes false positives | SHA1 content-aware deduplication |
| Missing input key variations | stableStringify with all input field names |
| Single-block message only | Multi-block message support |
| Intermediate results not collapsed | Intelligent intermediate result collapse |
| Redundant consecutive file reads | Consecutive file read deduplication |
| Null/undefined/content edge cases | Proper null/undefined/content handling |

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new features
4. Submit a pull request

## License

MIT License — see [LICENSE](LICENSE) for details.

---

<p align="center">
  Made with 🧹 for OpenClaw
</p>
