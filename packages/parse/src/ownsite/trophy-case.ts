export type Trophy = {
  year: string;
  league: string;
  title: string;
  isChampion: boolean;
};

export function parseTrophyCase(html: string): Trophy[] {
  if (!html.includes("Trophy Case")) return [];

  const items = [...html.matchAll(/<p>([\s\S]*?)<\/p>/gi)];
  const trophies: Trophy[] = [];

  for (const item of items) {
    const raw = item[1]!
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/\s*\/\s*/g, "/")
      .replace(/\s+/g, " ")
      .trim();
    if (!raw || raw.length < 8) continue;

    const m = raw.match(/^(\d{4}(?:\/\d{2})?)\s+(.+)$/);
    if (!m) continue;

    const year = m[1]!;
    const rest = m[2]!;

    if (!/Champion|Trophy|Runner|Finalist/i.test(rest)) continue;

    const leagueM = rest.match(
      /^(LSHL|EMHL|PxHL|GB|HAHL|Holiday|Performax|LAHL)\b\s*/i,
    );
    let league = leagueM ? leagueM[1]! : "";
    let title = leagueM ? rest.slice(leagueM[0].length).trim() : rest;

    if (!league) {
      const inlineM = title.match(/\b(LSHL|EMHL|PxHL|HAHL|LAHL)\b/i);
      if (inlineM) league = inlineM[1]!;
    }

    trophies.push({
      year,
      league,
      title,
      isChampion: /Champion/i.test(title),
    });
  }

  return trophies;
}
