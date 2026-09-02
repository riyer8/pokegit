/**
 * Public GitHub contribution calendar (includes private days when the
 * profile owner opted into "Include private contributions on my profile").
 */

export function parseContributionPulse(html, now = Date.now()) {
  if (!html || typeof html !== "string") return null;

  const yearMatch = html.match(/([\d,]+)\s+contributions?\s+in\s+the\s+last\s+year/i);
  const yearCount = yearMatch ? Number(yearMatch[1].replace(/,/g, "")) : null;
  const includesPrivate = /private contributions/i.test(html);

  const found = new Map();
  const patterns = [
    /data-date="(\d{4}-\d{2}-\d{2})"[^>]*?data-level="(\d+)"/gi,
    /data-level="(\d+)"[^>]*?data-date="(\d{4}-\d{2}-\d{2})"/gi,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(html))) {
      const date = m[1].includes("-") ? m[1] : m[2];
      const level = Number(m[1].includes("-") ? m[2] : m[1]);
      if (!date || Number.isNaN(level)) continue;
      found.set(date, level);
    }
  }

  const cutoff = now - 14 * 24 * 60 * 60 * 1000;
  let recentActiveDays = 0;
  let recentLevelSum = 0;
  for (const [date, level] of found) {
    const t = new Date(`${date}T12:00:00Z`).getTime();
    if (Number.isNaN(t) || t < cutoff) continue;
    if (level > 0) {
      recentActiveDays += 1;
      recentLevelSum += level;
    }
  }

  const weeks = buildWeeklyLevels(found, now, 12);

  if (yearCount == null && found.size === 0) return null;
  return {
    yearCount,
    includesPrivate,
    recentActiveDays,
    recentLevelSum,
    weeks,
  };
}

/** Last N weeks of contribution intensity (0–28 scale per week from day levels 0–4). */
export function buildWeeklyLevels(dayMap, now = Date.now(), weekCount = 12) {
  const weeks = [];
  const msWeek = 7 * 24 * 60 * 60 * 1000;
  const start = now - weekCount * msWeek;

  for (let w = 0; w < weekCount; w++) {
    const weekStart = start + w * msWeek;
    const weekEnd = weekStart + msWeek;
    let levelSum = 0;
    let activeDays = 0;
    for (const [date, level] of dayMap) {
      const t = new Date(`${date}T12:00:00Z`).getTime();
      if (Number.isNaN(t) || t < weekStart || t >= weekEnd) continue;
      if (level > 0) {
        activeDays += 1;
        levelSum += level;
      }
    }
    weeks.push({ weekStart, levelSum, activeDays });
  }
  return weeks;
}

export async function fetchContributionPulse(username) {
  const login = String(username || "").trim();
  if (!login) return null;
  try {
    const res = await fetch(
      `https://github.com/users/${encodeURIComponent(login)}/contributions`,
      {
        headers: {
          Accept: "text/html",
          "X-Requested-With": "XMLHttpRequest",
        },
      }
    );
    if (!res.ok) return null;
    return parseContributionPulse(await res.text());
  } catch {
    return null;
  }
}
