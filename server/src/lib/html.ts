function decodeNamedEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

export function decodeHtml(s: string): string {
  return decodeNamedEntities(
    s
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
  )
}

export function stripHtml(input?: string | null): string {
  if (!input) return ''
  return decodeNamedEntities(input.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
}
