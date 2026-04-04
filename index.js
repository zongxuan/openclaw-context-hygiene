/**
 * context-hygiene - Self-contained hook (no external imports)
 * Hooks: before_prompt_build, before_compaction (OpenClaw events)
 */

// ── Inlined snipCompact (from snip.js) ────────────────────────────────────

const COMPACTABLE_TOOLS = new Set([
  'Read', 'Bash', 'Grep', 'Glob', 'WebSearch',
  'WebFetch', 'Edit', 'Write',
])

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
  if (msg.type !== 'text') return false
  if (msg.isMeta) return false
  return extractText(msg) === '[zombie message]' || extractText(msg) === '[deleted message]'
}

function isEmptyThrottleOrWarning(msg) {
  if (msg.type !== 'text') return false
  if (msg.subtype !== 'throttle' && msg.subtype !== 'warning') return false
  return extractText(msg).trim().length === 0
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
  const seen = new Map(); const dups = []
  for (const m of msgs) {
    const key = getToolResultKey(m)
    if (!key) { dups.push(m); continue }
    if (seen.has(key)) { dups.push(m); stats.dupeToolResultsRemoved++ }
    else seen.set(key, m)
  }
  let res = msgs.filter(m => !dups.includes(m))
  if (res.length === 0) res = [msgs[msgs.length - 1]]
  return res
}

function dedupeConsecutiveFileReads(msgs, stats) {
  const result = []; let i = 0
  while (i < msgs.length) {
    const msg = msgs[i]
    if (msg.type === 'user' && isFileReadResult(msg)) {
      const run = [msg]; let j = i + 1
      while (j < msgs.length && isFileReadResult(msgs[j])) run.push(msgs[j++])
      if (run.length > 1) {
        for (const r of run.slice(0, -1)) stats.consecutiveReadsDeduplicated++
        result.push(run[run.length - 1]); i = j; continue
      }
    }
    result.push(msg); i++
  }
  return result
}

// ── Inlined contextCollapse ───────────────────────────────────────────────

function contextCollapse(messages) {
  const stats = { intermediateToolResultsRemoved: 0, crossFileReadsDeduplicated: 0, largeOutputsTruncated: 0, charsSaved: 0 }
  let result = removeIntermediateToolResults(messages, stats)
  result = dedupeCrossConversationFileReads(result, stats)
  result = truncateLargeOutputs(result, 2000, stats)
  return { messages: result, stats }
}

function removeIntermediateToolResults(msgs, stats) {
  const pathToRecords = new Map()
  for (let i = 0; i < msgs.length; i++) {
    const tr = extractToolResult(msgs[i])
    if (!tr) continue
    const p = getToolResultPath(tr)
    if (!p) continue
    const recs = pathToRecords.get(p) || []
    for (const r of recs) r.isFinal = false
    recs.push({ messageIndex: i, toolName: tr.name || 'Unknown', content: getToolResultContent(tr), isFinal: true })
    pathToRecords.set(p, recs)
  }
  const result = []
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]; const tr = extractToolResult(msg)
    if (!tr) { result.push(msg); continue }
    const p = getToolResultPath(tr)
    if (!p) { result.push(msg); continue }
    const recs = pathToRecords.get(p) || []
    const thisRec = recs.find(r => r.messageIndex === i)
    if (thisRec && !thisRec.isFinal) {
      stats.intermediateToolResultsRemoved++; stats.charsSaved += getToolResultContent(tr).length
      result.push(createMarker(`[Collapsed intermediate result for "${p}"]`))
    } else { result.push(msg) }
  }
  return result
}

function dedupeCrossConversationFileReads(msgs, stats) {
  const pathToLatest = new Map()
  for (let i = 0; i < msgs.length; i++) {
    const tr = extractToolResult(msgs[i])
    if (!tr || tr.name !== 'Read') continue
    const p = getToolResultPath(tr)
    if (!p) continue
    pathToLatest.set(p, { messageIndex: i, content: getToolResultContent(tr) })
  }
  const result = []
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]; const tr = extractToolResult(msg)
    if (!tr || tr.name !== 'Read') { result.push(msg); continue }
    const p = getToolResultPath(tr)
    if (!p) { result.push(msg); continue }
    const latest = pathToLatest.get(p)
    if (!latest || latest.messageIndex !== i) {
      stats.crossFileReadsDeduplicated++; stats.charsSaved += getToolResultContent(tr).length
      result.push(createMarker(`[Earlier read of "${p}" collapsed]`))
    } else { result.push(msg) }
  }
  return result
}

function truncateLargeOutputs(msgs, maxChars, stats) {
  return msgs.map(msg => {
    if (msg.type !== 'user' || !Array.isArray(msg.message?.content)) return msg
    const newContent = msg.message.content.map(block => {
      if (block.type !== 'tool_result') return block
      const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
      if (content.length <= maxChars) return block
      stats.largeOutputsTruncated++; stats.charsSaved += content.length - maxChars
      const firstLine = content.split('\n')[0] || content.slice(0, 100)
      return { ...block, content: [{ type: 'text', text: `[Truncated ${content.length}→${maxChars}]\n${firstLine}\n...` }], _collapsed: true }
    })
    return { ...msg, message: { ...msg.message, content: newContent } }
  })
}

function createMarker(text) {
  return { type: 'user', isMeta: true, subtype: 'context_collapse_marker',
    message: { role: 'user', content: [{ type: 'text', text }] } }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isToolResult(msg) {
  if (msg.type !== 'user') return false
  if (!Array.isArray(msg.message?.content)) return false
  return msg.message.content.some(b => b.type === 'tool_result')
}

function isFileReadResult(msg) {
  if (msg.type !== 'user') return false
  if (!Array.isArray(msg.message?.content)) return false
  const blocks = msg.message.content.filter(b => b.type === 'tool_result')
  return blocks.length === 1 && blocks[0].name === 'Read'
}

function extractToolResult(msg) {
  if (msg.type !== 'user' || !Array.isArray(msg.message?.content)) return null
  const blocks = msg.message.content.filter(b => b.type === 'tool_result')
  return blocks.length === 1 ? blocks[0] : null
}

function getToolResultPath(tr) {
  if (!tr || !tr.input) return null
  return tr.input.path || tr.input.file_path || tr.input.target || null
}

function getToolResultContent(tr) {
  if (!tr) return ''
  return typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content)
}

function extractText(msg) {
  if (!msg) return ''
  if (msg.type === 'user') {
    const c = msg.message?.content
    if (typeof c === 'string') return c
    if (Array.isArray(c)) return c.filter(b => b.type === 'text').map(b => b.text || '').join('\n')
  }
  if (msg.type === 'assistant') {
    const c = msg.message?.content
    if (typeof c === 'string') return c
    if (Array.isArray(c)) return c.filter(b => b.type === 'text').map(b => b.text || '').join('\n')
  }
  if (msg.type === 'text') return msg.text || ''
  return ''
}

function estimateTokens(msg) { return Math.ceil(extractText(msg).length / 4) }

// ── Hook Handlers ────────────────────────────────────────────────────────

function before_prompt_build(params) {
  // Layer 0: snipCompact — runs before every LLM call
  const msgs = params.messages
  if (!msgs || msgs.length === 0) return params
  const result = snipCompact(msgs)
  if (result.filtered.length < msgs.length) {
    msgs.length = 0
    msgs.push(...result.filtered)
  }
  return params
}

function before_compaction(params) {
  // Layer 2: contextCollapse — runs before compaction
  const msgs = params.messages
  if (!msgs || msgs.length === 0) return params
  const result = contextCollapse(msgs)
  if (result.messages.length < msgs.length) {
    msgs.length = 0
    msgs.push(...result.messages)
  }
  return params
}

// ── Export — key names MUST match OpenClaw event names ──────────────────

module.exports = {
  before_prompt_build,
  before_compaction,
}
