/**
 * Lightweight text helpers for README / GitHub description copy.
 */

export function stripMarkdown(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,!?]|$)/g, "$1$2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\|.*\|$/gm, " ")
    .replace(/^[-*_]{3,}\s*$/gm, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Keep the first 1–2 sentences, capped by length.
 */
export function preciseBlurb(text, { maxChars = 200, maxSentences = 2 } = {}) {
  const clean = stripMarkdown(text);
  if (!clean) return "";

  const parts = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [clean];
  const picked = [];
  for (const part of parts) {
    const next = part.trim();
    if (!next) continue;
    if (/^(npm |yarn |pnpm |pip |cargo |go |make |cd |git )/i.test(next)) continue;
    if (/^#{0,6}\s*install|^usage|^getting started|^license|^contributing/i.test(next)) continue;
    picked.push(next);
    const joined = picked.join(" ");
    if (picked.length >= maxSentences || joined.length >= maxChars * 0.7) break;
  }

  let out = (picked.join(" ") || clean).trim();
  if (out.length > maxChars) {
    const cut = out.slice(0, maxChars - 1);
    const sp = cut.lastIndexOf(" ");
    out = `${(sp > 80 ? cut.slice(0, sp) : cut).trim()}…`;
  }
  return out;
}
