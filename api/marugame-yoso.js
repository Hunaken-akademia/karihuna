function pickText(s) {
  if (s == null) return "";
  return String(s).replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function normNum(v) {
  const t = pickText(v).replace(/[−ー]/g, "-");
  if (!t || t === "-") return "";
  const m = t.match(/-?\d+(?:\.\d+)?/);
  return m ? m[0] : "";
}

function parseYoso05(html) {
  const start = html.indexOf('id="yoso03_03"');
  if (start < 0) throw new Error("オリジナル展示データ欄が見つかりません");
  let end = html.indexOf('id="yoso03_04"', start);
  if (end < 0) end = html.length;
  const section = html.slice(start, end);

  const bodies = [...section.matchAll(/<tbody>[\s\S]*?<\/tbody>/gi)].map((m) => m[0]);
  const rows = [];
  for (const body of bodies) {
    const boat = body.match(/<td[^>]*rowspan=["']2["'][^>]*>\s*([1-6])\s*<\/td>/i)?.[1];
    if (!boat) continue;

    // racer_data の後ろにある td が、体重・チルト・展示・一周・まわり足・直線の順に並ぶ
    const marker = body.lastIndexOf('</div>\n        </div>\n    </td>');
    const tail = marker >= 0 ? body.slice(marker) : body;
    const cells = [...tail.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => normNum(m[1]));

    // cells例: [体重, 調整, チルト, 展示, 一周, まわり足, 直線]
    const numeric = cells.filter((x) => x !== "");
    if (numeric.length < 6) continue;
    // 調整が無い艇は [体重, チルト, 展示, 一周, まわり足, 直線]
    const hasAdjust = numeric.length >= 7 && Number(numeric[1]) >= 0 && Number(numeric[1]) <= 5 && Number(numeric[2]) >= -0.5 && Number(numeric[2]) <= 3.0;
    const idx = hasAdjust ? 1 : 0;
    rows.push({
      boat: Number(boat),
      weight: numeric[0] || "",
      tilt: numeric[idx + 1] || "",
      tenji: numeric[idx + 2] || "",
      isshu: numeric[idx + 3] || "",
      mawari: numeric[idx + 4] || "",
      chokusen: numeric[idx + 5] || "",
    });
  }

  rows.sort((a, b) => a.boat - b.boat);
  if (rows.length < 6) throw new Error(`展示データが6艇分ありません（${rows.length}艇分）`);
  return rows.slice(0, 6);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const race = String(req.query.race || "").replace(/\D/g, "");
    const raceNo = Number(race);
    if (!raceNo || raceNo < 1 || raceNo > 12) {
      res.status(400).json({ ok: false, error: "race は 1〜12 を指定してください" });
      return;
    }
    const rr = String(raceNo).padStart(2, "0");
    const url = `https://www.marugameboat.jp/asp/kyogi/15/pc/yoso05${rr}.htm`;
    const r = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; HunakenAcademiaTool/1.0)",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!r.ok) throw new Error(`丸亀公式サイト取得失敗: HTTP ${r.status}`);
    const html = await r.text();
    const rows = parseYoso05(html);
    res.status(200).json({ ok: true, venue: "丸亀", race: raceNo, url, rows, fetchedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}
