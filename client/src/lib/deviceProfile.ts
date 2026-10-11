const CONSTRAINED_UA =
  /\b(SmartTV|SMART-TV|Tizen|Web0S|webOS|NetCast|HbbTV|AppleTV|CrKey|BRAVIA|AFT[A-Za-z]|Fire\s?TV|GoogleTV|Roku|VIDAA|DTV|PlayStation|Xbox|Opera TV|POV_TV)\b/i

export function isConstrainedDevice(): boolean {
  try {
    if (CONSTRAINED_UA.test(navigator.userAgent || '')) return true
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
    if (typeof memory === 'number' && memory > 0 && memory < 2) return true
  } catch {
    // ignore
  }
  return false
}
