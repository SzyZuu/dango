export function pinVariant(body: string, idx: number): string | null {
  const lines = body.split('\n')
  let streamIdx = -1
  let skipUri = false
  const out: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#EXT-X-STREAM-INF')) {
      streamIdx++
      skipUri = streamIdx !== idx
      if (!skipUri) out.push(line)
      continue
    }
    if (skipUri && trimmed && !trimmed.startsWith('#')) {
      skipUri = false
      continue
    }
    out.push(line)
  }
  if (streamIdx < 0 || idx > streamIdx) return null
  return out.join('\n')
}
