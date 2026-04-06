/**
 * context-hygiene - Self-contained hook (no external imports)
 * Hooks: before_prompt_build, before_compaction (OpenClaw events)
 */

const crypto = require('crypto')

function stableStringify(obj) {
  if (obj === null || obj === undefined) return ''
  if (typeof obj !== 'object') return String(obj)
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']'
  }
  const keys = Object.keys(obj).sort()
  const parts = keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k]))
  return '{' + parts.join(',') + '}'
}

// ── Inlined snipCompact ─────────────────────────────────────────────────

function snipCompact(messages) {
  let tokensFreed = 0
  const stats = {
    zombiesRemoved: 0,
    dupeToolResultsRemoved: 0,
    emptyMessagesRemoved: 0,
    consecutiveReadsDeduplicated: 0,
  }

  // Pass 1: Remove zombies + empty messages
  const pass1 = []
  for (const msg of messages) {
    // Protect system messages (SOUL.md, AGENTS.md, etc.) from compression
    if (msg.role === 'system') { pass1.push(msg); continue }
    if (isZombieMessage(msg)) { tokensFreed += estimateTokens(msg); stats.zombiesRemoved++; continue }
    if (isEmptyThrottleOrWarning(msg)) { tokensFreed += estimateTokens(msg); stats.emptyMessagesRemoved++; continue }
    pass1.push(msg)
  }

  // Pass 2: Deduplicate consecutive tool results
  const pass2 = dedupeConsecutiveToolResults(pass1, stats)

  // Pass 3: Keep last of consecutive file reads
  const pass3 = dedupeConsecutiveFileReads(pass2, stats)

  return { filtered: pass3, tokensFreed, stats }
}

function isZombieMessage(msg) {
  // Skip meta messages — they may legitimately contain these strings
  if (msg.isMeta) return false
  // Check for zombie markers in any message type (text, user, assistant, etc.)
  const text = extractText(msg)
  if (text === '[zombie message]' || text === '[deleted message]') return true
  return false
}

function isEmptyThrottleOrWarning(msg) {
  // throttle/warning can appear in 'text' type (legacy) or 'user' type messages
  if (msg.type !== 'text' && msg.type !== 'user') return false
  if (msg.subtype !== 'throttle' && msg.subtype !== 'warning') return false
  // Check if message has any non-text content blocks — if so, it's NOT empty
  const c = msg.message?.content
  if (Array.isArray(c)) {
    if (c.length === 0) return true  // empty array: nothing to display, treat as empty
    if (c.some(b => b.type !== 'text')) return false  // has non-text blocks, not empty
  } else {
    // c is not an array (could be null, object, string, etc.) — can't be "empty" in our sense
    return false
  }
  // Only trim-check text content for emptiness
  // But if there are text blocks with empty content, that's still explicit content
  const textBlocks = c.filter(b => b.type === 'text')
  if (textBlocks.length > 0 && textBlocks.every(b => !b.text || b.text.trim().length === 0)) {
    // Has text blocks but they're all empty — block exists, not truly empty
    return false
  }
  // Whitespace-only content is still content — keep throttle/warnings with any content
  return false  // a message with content (even whitespace) should NOT be treated as empty
}

function dedupeConsecutiveToolResults(msgs, stats) {
  const result = []
  let i = 0
  while (i < msgs.length) {
    const msg = msgs[i]
    if (msg.type === 'user' && isToolResult(msg)) {
      const run = [msg]; let j = i + 1
      while (j < msgs.length && isToolResult(msgs[j])) run.push(msgs[j++])
      const deduped = dedupeRun(run, stats)
      result.push(...deduped); i = j; continue
    }
    result.push(msg); i++
  }
  return result
}

function dedupeRun(msgs, stats) {
  if (msgs.length <= 1) return msgs
  // Keep the LAST occurrence for each key (latest tool result wins)
  // But preserve ALL blocks from each message, not just the first-block key
  // Strategy: for each message, determine if it's fully superseded; if not,
  // keep the message but swap in the final version of each key from it
  const keyToLastIndex = new Map()
  for (let i = 0; i < msgs.length; i++) {
    const all = extractAllToolResults(msgs[i])
    for (const b of all) {
      const p = getToolResultPath(b)
      if (!p) continue
      // Include content in the key so same path + different content are NOT superseded
      const raw = getToolResultContent(b) || ''
      const contentKey = crypto.createHash('sha1').update(raw).digest('hex')
      const inputKey = stableStringify(b.input || {})
      const k = `${b.toolName ?? b.name ?? 'Unknown'}:${inputKey}|${contentKey}`
      keyToLastIndex.set(k, i)
    }
  }
  // For each message, compute its "contribution": blocks to keep
  const messageContributions = []
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]
    const allBlocks = extractAllToolResults(msg)
    if (allBlocks.length <= 1) {
      // Single-block: normal dedupe behavior
      const key = getToolResultKey(msg)
      if (!key) {
        messageContributions.push({ msg, blocksToKeep: allBlocks, isKept: true })
      } else {
        const lastIdx = keyToLastIndex.get(key)
        const isKept = i === lastIdx
        if (!isKept) stats.dupeToolResultsRemoved++
        messageContributions.push({ msg, blocksToKeep: allBlocks, isKept })
      }
    } else {
      // Multi-block: check if ALL blocks are superseded by later messages
      // (not just the first block — other blocks in the same message may be unique)
      // Use content-aware keys matching keyToLastIndex so different content is not superseded
      const allSuperseded = allBlocks.every(b => {
        const p = getToolResultPath(b)
        if (!p) return false
        const raw = getToolResultContent(b) || ''
        const contentKey = crypto.createHash('sha1').update(raw).digest('hex')
        const inputKey = stableStringify(b.input || {})
        const k = `${b.toolName ?? b.name ?? 'Unknown'}:${inputKey}|${contentKey}`
        return keyToLastIndex.has(k) && keyToLastIndex.get(k) !== i
      })
      if (allSuperseded) {
        // Entire message is superseded — discard
        stats.dupeToolResultsRemoved += allBlocks.length
        messageContributions.push({ msg, blocksToKeep: [], isKept: false })
      } else {
        // Keep this message (possibly with some blocks superseded)
        // Count all keys in this message that are superseded (use content-aware key)
        const supersededCount = allBlocks.filter(b => {
          const p = getToolResultPath(b)
          if (!p) return false
          const raw = getToolResultContent(b) || ''
          const contentKey = crypto.createHash('sha1').update(raw).digest('hex')
          const inputKey = stableStringify(b.input || {})
          const k = `${b.toolName ?? b.name ?? 'Unknown'}:${inputKey}|${contentKey}`
          return keyToLastIndex.has(k) && keyToLastIndex.get(k) !== i
        }).length
        if (supersededCount > 0) stats.dupeToolResultsRemoved += supersededCount
        messageContributions.push({ msg, blocksToKeep: allBlocks, isKept: true })
      }
    }
  }
  // Collect kept messages and build the result
  const keptMessages = messageContributions.filter(c => c.isKept)
  if (keptMessages.length === 0) {
    // All discarded: return the last message (with all its blocks)
    return [msgs[msgs.length - 1]]
  }
  // For each kept message, build a new message with its contribution blocks
  const deduped = keptMessages.map(({ msg, blocksToKeep }) => {
    if (blocksToKeep.length === 0) return null
    if (blocksToKeep.length === 1) {
      // Same as original single-block message — return as-is
      return msg
    }
    // Multi-block: reconstruct message content with final versions of each key
    const keyToFinalBlock = new Map()
    // First, collect final blocks from messages at or before finalIdx
    for (let mi = 0; mi < msgs.length; mi++) {
      const m = msgs[mi]
      // Only include messages at or before finalIdx to avoid polluting with later superseded blocks
      const blocks = extractAllToolResults(m)
      for (const b of blocks) {
        const p = getToolResultPath(b)
        if (!p) continue
        const raw = getToolResultContent(b) || ''
        const contentKey = crypto.createHash('sha1').update(raw).digest('hex')
        const inputKey = stableStringify(b.input || {})
        const k = `${b.toolName ?? b.name ?? 'Unknown'}:${inputKey}|${contentKey}`
        // Only set if this message index is at or before the last occurrence of this key
        const finalIdx = keyToLastIndex.get(k)
        if (finalIdx !== undefined && mi <= finalIdx) {
          keyToFinalBlock.set(k, b)
        }
      }
    }
    // Now build the content: for each block in blocksToKeep,
    // use the final version if it exists and belongs to a later message
    const newContent = blocksToKeep.map(b => {
      const p = getToolResultPath(b)
      if (!p) return b
      const raw = getToolResultContent(b) || ''
      const contentKey = crypto.createHash('sha1').update(raw).digest('hex')
      const inputKey = stableStringify(b.input || {})
      const k = `${b.toolName ?? b.name ?? 'Unknown'}:${inputKey}|${contentKey}`
      const finalIdx = keyToLastIndex.get(k)
      const thisIdx = msgs.indexOf(msg)
      if (finalIdx !== undefined && finalIdx !== thisIdx) {
        // A later message has the final version — use it
        // Look up directly from the finalIdx message's blocks
        const finalMsgBlocks = extractAllToolResults(msgs[finalIdx])
        const finalBlock = finalMsgBlocks.find(bb => {
          const pp = getToolResultPath(bb)
          if (!pp) return false
          const raw2 = getToolResultContent(bb) || ''
          const ck = crypto.createHash('sha1').update(raw2).digest('hex')
          const inputKey2 = stableStringify(bb.input || {})
          const kk = `${bb.toolName ?? bb.name ?? 'Unknown'}:${inputKey2}|${ck}`
          return kk === k
        }) || b
        return finalBlock
      }
      return b
    })
    return { ...msg, message: { ...msg.message, content: newContent } }
  }).filter(Boolean)
  return deduped.length > 0 ? deduped : [msgs[msgs.length - 1]]
}

function dedupeConsecutiveFileReads(msgs, stats) {
  const result = []; let i = 0
  while (i < msgs.length) {
    const msg = msgs[i]
    if (msg.type === 'user' && isFileReadResult(msg)) {
      const run = [msg]; let j = i + 1
      while (j < msgs.length && isFileReadResult(msgs[j])) run.push(msgs[j++])
      if (run.length > 1) {
        stats.consecutiveReadsDeduplicated += run.length - 1
        result.push(run[run.length - 1]); i = j; continue
      }
    }
    result.push(msg); i++
  }
  return result
}

// ── Inlined contextCollapse ─────────────────────────────────────────────

function contextCollapse(messages, maxChars) {
  const stats = { intermediateToolResultsRemoved: 0, crossFileReadsDeduplicated: 0, largeOutputsTruncated: 0, charsSaved: 0 }
  let result = removeIntermediateToolResults(messages, stats)
  result = dedupeCrossConversationFileReads(result, stats)
  result = truncateLargeOutputs(result, maxChars, stats)
  return { messages: result, stats }
}

function removeIntermediateToolResults(msgs, stats) {
  // First pass: collect all tool results per path across all messages
  const pathToRecords = new Map()
  for (let i = 0; i < msgs.length; i++) {
    const all = extractAllToolResults(msgs[i])
    for (const tr of all) {
      const p = getToolResultPath(tr)
      if (!p) continue
      const recs = pathToRecords.get(p) || []
      for (const r of recs) if (r.messageIndex < i) r.isFinal = false
      recs.push({ messageIndex: i, toolResult: tr, toolName: tr.toolName ?? tr.name ?? 'Unknown', content: getToolResultContent(tr), isFinal: true })
      pathToRecords.set(p, recs)
    }
  }
  // Second pass: collapse intermediate results within message content
  const result = []
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]
    // Protect system messages from compression
    if (msg.role === 'system') { result.push(msg); continue }
    const all = extractAllToolResults(msg)
    if (all.length === 0) { result.push(msg); continue }
    let collapsed = false
    const newContent = all.map(b => JSON.parse(JSON.stringify(b)))  // deep clone blocks
    for (let idx = 0; idx < all.length; idx++) {
      const tr = all[idx]
      const p = getToolResultPath(tr)
      if (!p) { continue }  // preserve as-is (already cloned)
      const recs = pathToRecords.get(p) || []
      const thisRec = recs.find(r => r.messageIndex === i && r.toolResult === tr)
      if (thisRec && !thisRec.isFinal) {
        const originalLen = getToolResultContent(tr).length
        const collapsedText = `[Collapsed intermediate ${thisRec.toolName} result for "${p}"]`
        const markerLen = collapsedText.length
        stats.charsSaved += Math.max(0, originalLen - markerLen)
        newContent[idx] = { type: 'text', text: collapsedText }
        collapsed = true
      } else { newContent[idx] = JSON.parse(JSON.stringify(tr)) }
    }
    if (collapsed) {
      stats.intermediateToolResultsRemoved++
      result.push({ ...msg, message: { ...msg.message, content: newContent } })
    } else { result.push(msg) }
  }
  return result
}

function dedupeCrossConversationFileReads(msgs, stats) {
  const pathToLatest = new Map()
  for (let i = 0; i < msgs.length; i++) {
    const all = extractAllToolResults(msgs[i])
    for (const tr of all) {
      if ((tr.toolName ?? tr.name) !== 'Read') continue
      const p = getToolResultPath(tr)
      if (!p) continue
      pathToLatest.set(p, { messageIndex: i, toolResult: tr })
    }
  }
  const result = []
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]
    // Protect system messages from compression
    if (msg.role === 'system') { result.push(msg); continue }
    const all = extractAllToolResults(msg)
    if (all.length === 0) { result.push(msg); continue }
    // If message has multiple blocks (e.g., [Read_result, OtherTool_result]), don't collapse
    // to avoid breaking the message structure
    if (all.length > 1) { result.push(msg); continue }
    let hasDeduplicated = false
    const newContent = all.map(b => JSON.parse(JSON.stringify(b)))  // deep clone blocks
    for (let idx = 0; idx < all.length; idx++) {
      const tr = all[idx]
      if ((tr.toolName ?? tr.name) !== 'Read') { continue }  // preserve as-is (already cloned)
      const p = getToolResultPath(tr)
      if (!p) { continue }  // preserve as-is (already cloned)
      const latest = pathToLatest.get(p)
      if (!latest || latest.messageIndex !== i || latest.toolResult !== tr) {
        const originalLen = getToolResultContent(tr).length
        const collapsedText = `[Earlier read of "${p}" collapsed]`
        const markerLen = collapsedText.length
        stats.charsSaved += Math.max(0, originalLen - markerLen)
        newContent[idx] = { type: 'text', text: collapsedText }
        hasDeduplicated = true
      } else { newContent[idx] = JSON.parse(JSON.stringify(tr)) }
    }
    if (hasDeduplicated) {
      stats.crossFileReadsDeduplicated++
      result.push({ ...msg, message: { ...msg.message, content: newContent } })
    } else { result.push(msg) }
  }
  return result
}

function truncateLargeOutputs(msgs, maxChars, stats) {
  if (maxChars <= 0) return msgs
  return msgs.map(msg => {
    // Protect system messages from truncation
    if (msg.role === 'system') return msg
    if (msg.type !== 'user' || !Array.isArray(msg.message?.content)) return msg
    const newContent = msg.message.content.map(block => {
      if (block.type !== 'tool_result' && block.type !== 'tool_result_error') {
        if (block._collapsed && block.type === 'text') return block  // preserve collapse markers
        return block
      }
      // Extract displayable text content to measure length
      const rawContent = block.content
      const displayText = extractBlockDisplayText(rawContent)
      if (displayText.length <= maxChars) {
        // Within limit: strip _collapsed flag if it was set previously
        if (block._collapsed) {
          const { _collapsed, ...rest } = block
          return rest
        }
        return block
      }
      stats.largeOutputsTruncated++
      stats.charsSaved += displayText.length - maxChars
      // Preserve original block fields EXCEPT tool_use_id (no longer valid when
      // content becomes a text block) and _collapsed (always set fresh)
      const preservedFields = {}
      for (const k of Object.keys(block)) {
        if (k !== 'content' && k !== '_collapsed' && k !== 'tool_use_id') {
          preservedFields[k] = block[k]
        }
      }
      const firstLine = (displayText.split('\n')[0] || displayText.slice(0, maxChars)).slice(0, maxChars)
      return {
        ...preservedFields,
        content: [{ type: 'text', text: `[Truncated ${displayText.length}→${maxChars}]\n${firstLine}\n...` }],
        _collapsed: true
      }
    })
    return { ...msg, message: { ...msg.message, content: newContent } }
  })
}

// Extract displayable text from block content (handles text, image, audio, etc.)
function extractBlockDisplayText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return JSON.stringify(content)
  // Extract text blocks; represent non-text blocks with a placeholder to reflect actual content volume
  const parts = content.map(b => {
    if (b.type === 'text') return b.text || ''
    // Non-text block (image, audio, etc.) — use a placeholder to reflect content presence
    return `[${b.type} content]`
  })
  const result = parts.join('\n')
  // If displayable text is empty but there is actual non-text content,
  // return a string whose length reflects the underlying content size.
  // This ensures truncateLargeOutputs does not silently skip large content.
  if (result.length === 0 && content.length > 0) {
    // Measure actual raw content size so truncation can work correctly
    const rawLen = content.reduce((acc, b) => {
      if (typeof b === 'string') return acc + b.length
      if (b.data && typeof b.data === 'string') return acc + b.data.length
      if (b.content && typeof b.content === 'string') return acc + b.content.length
      return acc + JSON.stringify(b).length
    }, 0)
    return `[non-text ${rawLen} bytes]`
  }
  return result
}

function createMarker(text, placeholderId) {
  return { type: 'user', isMeta: true, subtype: 'context_collapse_marker',
    message: { role: 'user', content: [{ type: 'text', text }] } }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function isToolResult(msg) {
  if (msg.type !== 'user') return false
  if (!Array.isArray(msg.message?.content)) return false
  return msg.message.content.some(b =>
    b.type === 'tool_result' || b.type === 'tool_result_error'
    || (typeof b.type === 'string' && b.type.startsWith('tool_result'))
  )
}

function isFileReadResult(msg) {
  if (msg.type !== 'user') return false
  if (!Array.isArray(msg.message?.content)) return false
  const blocks = msg.message.content.filter(b => b.type === 'tool_result' || b.type === 'tool_result_error')
  if (blocks.length !== 1) return false
  const name = blocks[0].name ?? blocks[0].toolName ?? null
  return name === 'Read'
}

function extractToolResult(msg) {
  if (msg.type !== 'user' || !Array.isArray(msg.message?.content)) return null
  const blocks = msg.message.content.filter(b => b.type === 'tool_result' || b.type === 'tool_result_error')
  return blocks.length === 1 ? blocks[0] : null
}

// Returns ALL tool results from a message (safe for single or multi-block messages)
function extractAllToolResults(msg) {
  if (msg.type !== 'user' || !Array.isArray(msg.message?.content)) return []
  return msg.message.content.filter(b =>
    b.type === 'tool_result' || b.type === 'tool_result_error'
    || (typeof b.type === 'string' && b.type.startsWith('tool_result'))
  )
}

function getToolResultKey(msg) {
  // Try single-block extraction first
  const tr = extractToolResult(msg)
  if (tr) {
    const path = getToolResultPath(tr)
    if (!path) return null
    // Include content so same path with different content is NOT deduplicated away
    const raw = getToolResultContent(tr) || ''
    const contentKey = crypto.createHash('sha1').update(raw).digest('hex')
    const inputKey = stableStringify(tr.input || {})
    return `${tr.toolName ?? tr.name ?? 'Unknown'}:${inputKey}|${contentKey}`
  }
  // Multi-block: extract all, deduplicate internally (keep last of each path), return last key
  const all = extractAllToolResults(msg)
  if (all.length === 0) return null
  // Keep last occurrence of each path (same dedupe semantics as dedupeRun)
  const pathToLast = new Map()
  for (const block of all) {
    const p = getToolResultPath(block)
    if (p) pathToLast.set(p, block)
  }
  const deduped = [...pathToLast.values()]
  if (deduped.length === 0) return null
  // Return the LAST deduped block's key for consistency with "latest wins" semantics
  const last = deduped[deduped.length - 1]
  const lastRaw = getToolResultContent(last) || ''
  const lastContentKey = crypto.createHash('sha1').update(lastRaw).digest('hex')
  const lastInputKey = stableStringify(last.input || {})
  return `${last.toolName ?? last.name ?? 'Unknown'}:${lastInputKey}|${lastContentKey}`
}

function getToolResultPath(tr) {
  if (!tr || !tr.input) return null
  return tr.input.path || tr.input.file_path || tr.input.target
    || tr.input.target_file || tr.input.source_file
    || tr.input.source || tr.input.destination
    || tr.input.url || tr.input.uri
    || tr.input.file || tr.input.filename
    || tr.input.path_from || tr.input.path_to
    || tr.input.source_path || tr.input.target_path
    || null
}

function getToolResultContent(tr) {
  if (!tr) return ''
  // Treat undefined/null content as empty string (not the string "undefined")
  if (tr.content === undefined || tr.content === null) return ''
  if (typeof tr.content === 'string') return tr.content
  // If content is an array, stringify the whole thing (as before)
  if (Array.isArray(tr.content)) return JSON.stringify(tr.content)
  // If content is an object, try to extract meaningful text fields
  if (typeof tr.content === 'object') {
    // Prefer explicit text field, fall back to full stringify
    if (typeof tr.content.text === 'string') return tr.content.text
    if (typeof tr.content.content === 'string') return tr.content.content
    if (typeof tr.content.data === 'string') return tr.content.data
    // Fall back to stringify but only the non-metadata part
    const { metadata, ...rest } = tr.content
    const meaningful = Object.keys(rest).length > 0 ? rest : tr.content
    return JSON.stringify(meaningful)
  }
  return JSON.stringify(tr.content)
}

function extractText(msg) {
  if (!msg) return ''
  if (msg.type === 'user') {
    const c = msg.message?.content
    if (typeof c === 'string') return c
    if (Array.isArray(c)) return c.filter(b => b.type === 'text').map(b => b.text || '').join('\n')
    if (typeof c === 'object' && c !== null) {
      // single block object form
      if (c.type === 'text') return c.text || ''
      return ''
    }
    return ''
  }
  if (msg.type === 'assistant') {
    const c = msg.message?.content
    if (typeof c === 'string') return c
    if (Array.isArray(c)) return c.filter(b => b.type === 'text').map(b => b.text || '').join('\n')
    if (typeof c === 'object' && c !== null) {
      // single block object form
      if (c.type === 'text') return c.text || ''
      return ''
    }
    return ''
  }
  if (msg.type === 'text') {
    if (typeof msg.text === 'string') return msg.text
    if (msg.message?.content) {
      const c = msg.message.content
      if (typeof c === 'string') return c
      if (Array.isArray(c)) return c.filter(b => b.type === 'text').map(b => b.text || '').join('\n')
      if (typeof c === 'object' && c !== null) {
        // single block object form
        if (c.type === 'text') return c.text || ''
        return ''
      }
    }
    return ''
  }
  return ''
}

function estimateTokens(msg) { return Math.ceil(extractText(msg).length / 4) }

// ── Hook Handlers ───────────────────────────────────────────────────────

function before_prompt_build(params) {
  // Layer 0: snipCompact — runs before every LLM call
  const msgs = params.messages
  if (!msgs || msgs.length === 0) return params
  const result = snipCompact(msgs)
  if (result.filtered.length < msgs.length) {
    msgs.length = 0
    msgs.push(...result.filtered)
  }
  // Expose stats on params so OpenClaw or debugging can access them
  if (!params._contextHygiene) params._contextHygiene = {}
  params._contextHygiene.snipCompact = { tokensFreed: result.tokensFreed, stats: result.stats }
  return params
}

function before_compaction(params) {
  // Layer 2: contextCollapse — runs before compaction
  const msgs = params.messages
  if (!msgs || msgs.length === 0) return params
  // Default 2000 chars per tool result output; minimum 10 to ensure useful snippets
  const maxChars = Math.max(10, params.config?.truncateMaxChars ?? 2000)
  const result = contextCollapse(msgs, maxChars)
  if (result.messages.length < msgs.length) {
    msgs.length = 0
    msgs.push(...result.messages)
  }
  // Expose stats on params so OpenClaw or debugging can access them
  if (!params._contextHygiene) params._contextHygiene = {}
  params._contextHygiene.contextCollapse = { stats: result.stats }
  return params
}

// ── Export — key names MUST match OpenClaw event names ──────────────────

module.exports = {
  before_prompt_build,
  before_compaction,
}


// ── Test exports (additive only, not modifying production exports) ────────
const _origExport = module.exports
const _extraFns = {
  snipCompact, contextCollapse, isEmptyThrottleOrWarning, extractText,
  getToolResultPath, getToolResultContent, extractAllToolResults,
  getToolResultKey, truncateLargeOutputs, dedupeRun,
  before_prompt_build, before_compaction,
  isToolResult, isFileReadResult, isZombieMessage,
  extractToolResult, estimateTokens,
  removeIntermediateToolResults, dedupeCrossConversationFileReads,
  createMarker, extractBlockDisplayText,
  dedupeConsecutiveToolResults, dedupeConsecutiveFileReads,
}
module.exports = { ..._origExport, ..._extraFns }

