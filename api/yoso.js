const CACHE_MS = 3 * 60 * 1000;
const cacheStore = globalThis.__HUNAKEN_YOSO_CACHE__ || new Map();
globalThis.__HUNAKEN_YOSO_CACHE__ = cacheStore;

function decodeEntities(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&minus;|&#8722;/g, "-")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function pickText(s) {
  return decodeEntities(s)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textLinesFromHtml(s) {
  return decodeEntities(s)
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(td|th|tr|p|li|dt|dd|div|span|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\t\r]+/g, "\n")
    .split(/\n+/)
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function normNum(v) {
  const t = pickText(v).replace(/[−ー─]/g, "-");
  if (!t || t === "-" || t === "―") return "";
  const m = t.match(/-?\d+(?:\.\d+)?/);
  return m ? m[0] : "";
}

function yyyymmdd(dateStr) {
  const s = String(dateStr || "").replace(/\D/g, "");
  if (/^\d{8}$/.test(s)) return s;
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

const JCD = {
  "桐生": "01", "戸田": "02", "江戸川": "03", "平和島": "04", "多摩川": "05", "浜名湖": "06",
  "蒲郡": "07", "常滑": "08", "津": "09", "三国": "10", "びわこ": "11", "住之江": "12",
  "尼崎": "13", "鳴門": "14", "丸亀": "15", "児島": "16", "宮島": "17", "徳山": "18",
  "下関": "19", "若松": "20", "芦屋": "21", "福岡": "22", "唐津": "23", "大村": "24",
};

function windKeyFromDirectionAndSpeed(direction, speedValue) {
  const speed = Number(speedValue || 0);
  const dir = String(direction || "").replace("向い風", "向かい風");
  if (!speed || speed <= 0) return "無風";
  if (!dir) return "";
  if (dir.includes("左横風")) return `左横風${speed >= 3 ? "3m以上" : `${Math.round(speed)}m`}`;
  if (dir.includes("右横風")) return `右横風${speed >= 3 ? "3m以上" : `${Math.round(speed)}m`}`;
  if (dir.includes("向かい風")) return `向かい風${speed >= 5 ? "5m以上" : `${Math.round(speed)}m`}`;
  if (dir.includes("追い風")) return `追い風${speed >= 5 ? "5m以上" : `${Math.round(speed)}m`}`;
  return "";
}

function directionFromText(raw) {
  const t = pickText(raw);
  if (/左\s*横\s*風/.test(t)) return "左横風";
  if (/右\s*横\s*風/.test(t)) return "右横風";
  if (/向\s*(?:かい)?\s*風|向い風/.test(t)) return "向かい風";
  if (/追\s*い?\s*風/.test(t)) return "追い風";
  return "";
}

function directionFromImgToken(html) {
  const raw = String(html || "");
  const low = raw.toLowerCase();

  const direct = directionFromText(raw);
  if (direct) return { direction: direct, raw: direct, confidence: "text" };
  if (/left[-_\s]?cross|cross[-_\s]?left|hidari|leftside|wind[_-]?l/.test(low)) return { direction: "左横風", raw: "left-cross", confidence: "attr" };
  if (/right[-_\s]?cross|cross[-_\s]?right|migi|rightside|wind[_-]?r/.test(low)) return { direction: "右横風", raw: "right-cross", confidence: "attr" };
  if (/head[-_\s]?wind|mukai|against|wind[_-]?u/.test(low)) return { direction: "向かい風", raw: "headwind", confidence: "attr" };
  if (/tail[-_\s]?wind|oi[-_\s]?kaze|oikaze|following|wind[_-]?d/.test(low)) return { direction: "追い風", raw: "tailwind", confidence: "attr" };

  const around = (() => {
    const i = raw.search(/風速|weather1|水面気象|is-wind|wind|kaze/i);
    if (i < 0) return raw;
    return raw.slice(Math.max(0, i - 3500), i + 6500);
  })();
  const m = around.match(/(?:wind|kaze|weather|direction|dir)[-_]?(?:no|num|icon|arrow|image)?[-_]?0?([1-8])\b/i)
    || around.match(/0?([1-8])[-_](?:wind|kaze|weather|direction|dir|arrow)/i)
    || around.match(/is-wind([1-8])\b/i)
    || around.match(/weather1_([1-8])\b/i);
  if (m) {
    const n = Number(m[1]);
    // 8方向画像を4分類に丸める。ずれがある場合は windRaw に番号が出るので後で調整可能。
    const map = {
      1: "追い風", 2: "右横風", 3: "右横風", 4: "向かい風",
      5: "向かい風", 6: "左横風", 7: "左横風", 8: "追い風",
    };
    return { direction: map[n] || "", raw: `wind-${n}`, confidence: "number" };
  }
  return { direction: "", raw: "", confidence: "none" };
}

function parseWeather(html) {
  const text = pickText(html);
  const windSpeed = text.match(/風速\s*([0-9]+(?:\.[0-9]+)?)\s*m/i)?.[1] || "";
  const temp = text.match(/気温\s*([0-9]+(?:\.[0-9]+)?)\s*℃/)?.[1] || "";
  const waterTemp = text.match(/水温\s*([0-9]+(?:\.[0-9]+)?)\s*℃/)?.[1] || "";
  const wave = text.match(/波高\s*([0-9]+(?:\.[0-9]+)?)\s*cm/)?.[1] || "";

  const idx = html.search(/水面気象|風速|weather1|気象/i);
  const section = idx >= 0 ? html.slice(Math.max(0, idx - 3500), idx + 6500) : html;
  const dir = directionFromImgToken(section);
  const windKey = windKeyFromDirectionAndSpeed(dir.direction, windSpeed);
  return {
    windSpeed,
    windDirection: dir.direction,
    windKey,
    windRaw: dir.raw,
    windConfidence: dir.confidence,
    temp,
    waterTemp,
    wave,
  };
}

function isNumText(x) {
  return /^-?\d+(?:\.\d+)?$/.test(String(x || "").replace(/kg$/i, ""));
}
function n(x) { return Number(String(x || "").replace(/kg$/i, "")); }
function inRange(x, a, b) { const v = n(x); return Number.isFinite(v) && v >= a && v <= b; }

function pickDisplayValues(nums) {
  const cleaned = nums.map((x) => String(x).replace(/kg$/i, "")).filter(isNumText);
  for (let i = 0; i < cleaned.length; i++) {
    // 基本: 体重, チルト, 展示, 一周, まわり足, 直線 [,調整]
    if (inRange(cleaned[i], 45, 60) && inRange(cleaned[i + 1], -1, 3.5) && inRange(cleaned[i + 2], 6, 7.8) && inRange(cleaned[i + 3], 30, 45) && inRange(cleaned[i + 4], 4, 8) && inRange(cleaned[i + 5], 5, 9)) {
      return { weight: cleaned[i], tilt: cleaned[i + 1], tenji: cleaned[i + 2], isshu: cleaned[i + 3], mawari: cleaned[i + 4], chokusen: cleaned[i + 5] };
    }
    // 調整が体重とチルトの間にある場合: 体重, 調整, チルト, 展示, 一周, まわり足, 直線
    if (inRange(cleaned[i], 45, 60) && inRange(cleaned[i + 1], 0, 5) && inRange(cleaned[i + 2], -1, 3.5) && inRange(cleaned[i + 3], 6, 7.8) && inRange(cleaned[i + 4], 30, 45) && inRange(cleaned[i + 5], 4, 8) && inRange(cleaned[i + 6], 5, 9)) {
      return { weight: cleaned[i], tilt: cleaned[i + 2], tenji: cleaned[i + 3], isshu: cleaned[i + 4], mawari: cleaned[i + 5], chokusen: cleaned[i + 6] };
    }
    // 調整が展示と一周の間にある場合: 体重, チルト, 展示, 調整, 一周, まわり足, 直線
    if (inRange(cleaned[i], 45, 60) && inRange(cleaned[i + 1], -1, 3.5) && inRange(cleaned[i + 2], 6, 7.8) && inRange(cleaned[i + 3], 0, 5) && inRange(cleaned[i + 4], 30, 45) && inRange(cleaned[i + 5], 4, 8) && inRange(cleaned[i + 6], 5, 9)) {
      return { weight: cleaned[i], tilt: cleaned[i + 1], tenji: cleaned[i + 2], isshu: cleaned[i + 4], mawari: cleaned[i + 5], chokusen: cleaned[i + 6] };
    }
  }
  return null;
}

function parseDisplayRowsByLines(html, venue) {
  const lines = textLinesFromHtml(html);
  const headerIdx = lines.findIndex((line) => /展示タイム|オリジナル展示|まわり足|直線|一周/.test(line));
  const searchFrom = headerIdx >= 0 ? headerIdx : 0;
  const rows = [];
  const boatStarts = [];

  for (let i = searchFrom; i < lines.length; i++) {
    const b = Number(lines[i]);
    if (b >= 1 && b <= 6) {
      const ahead = lines.slice(i + 1, i + 10).join(" ");
      // 級別/登録番号や選手名行が続く場所を優先。単なる前走成績のR/進入は除外。
      if (/[AB][12]?|\d{4}|\/|支部|年齢/.test(ahead) && lines[i - 1] !== "R") {
        if (!boatStarts.some((x) => x.boat === b)) boatStarts.push({ boat: b, idx: i });
      }
    }
  }

  for (let boat = 1; boat <= 6; boat++) {
    const cur = boatStarts.find((x) => x.boat === boat);
    if (!cur) continue;
    const next = boatStarts.find((x) => x.boat === boat + 1);
    const block = lines.slice(cur.idx + 1, next ? next.idx : lines.length);
    const nums = block.map((line) => line.replace(/kg$/i, "")).filter(isNumText).filter((line) => n(line) >= -1 && n(line) <= 60);
    const picked = pickDisplayValues(nums);
    if (!picked) continue;
    rows.push({ boat, course: boat, ...picked });
  }

  rows.sort((a, b) => a.boat - b.boat);
  if (rows.length < 6) throw new Error(`${venue}の展示データが6艇分ありません（${rows.length}艇分）`);
  return rows.slice(0, 6);
}

function parseHeiwajimaYoso05(html) {
  try {
    return parseMarugameYoso05(html);
  } catch (e) {
    return parseDisplayRowsByLines(html, "平和島");
  }
}

function parseKojimaYoso05(html) {
  try {
    return parseMarugameYoso05(html);
  } catch (e) {
    return parseDisplayRowsByLines(html, "児島");
  }
}


function parseSuminoeSt02(html) {
  const lines = textLinesFromHtml(html);
  const raw = lines.join("\n");

  const courseMap = {};
  const courseMatch = raw.match(/進入コース[\s\S]{0,80}?\[1回目\]\s*([1-6])([1-6])([1-6])[\.・\s]*([1-6])([1-6])([1-6])/);
  if (courseMatch) {
    courseMatch.slice(1).forEach((boat, idx) => { courseMap[Number(boat)] = idx + 1; });
  }

  const headerIdx = lines.findIndex((line) => /体重/.test(line) && /チルト/.test(line) && /展示/.test(line));
  const searchFrom = headerIdx >= 0 ? headerIdx : 0;
  const boatStarts = [];

  for (let i = searchFrom; i < lines.length; i++) {
    const b = Number(lines[i]);
    if (Number.isInteger(b) && b >= 1 && b <= 6) {
      const ahead = lines.slice(i + 1, i + 8).join(" ");
      if (/^[AB][12]?\/\d{4}/.test(String(lines[i + 1] || "")) && /支部|年齢|期\/|\/.*\/\d+/.test(ahead) && !boatStarts.some((x) => x.boat === b)) {
        boatStarts.push({ boat: b, idx: i });
      }
    }
  }

  const rows = [];
  for (let boat = 1; boat <= 6; boat++) {
    const cur = boatStarts.find((x) => x.boat === boat);
    if (!cur) continue;
    const next = boatStarts.find((x) => x.boat === boat + 1);
    const block = lines.slice(cur.idx + 1, next ? next.idx : lines.length);
    const nums = [];
    for (const line of block) {
      const t = String(line || "").replace(/kg$/i, "").trim();
      if (isNumText(t)) nums.push(t);
    }

    let picked = null;
    for (let i = 0; i < nums.length; i++) {
      // 住之江 st02: 体重, チルト, 展示, 一周, まわり足 [, 調整]
      if (inRange(nums[i], 40, 70) && inRange(nums[i + 1], -1, 3.5) && inRange(nums[i + 2], 5.5, 7.8) && inRange(nums[i + 3], 30, 45) && inRange(nums[i + 4], 4, 15)) {
        picked = {
          weight: nums[i],
          tilt: nums[i + 1],
          tenji: nums[i + 2],
          isshu: nums[i + 3],
          mawari: nums[i + 4],
          chokusen: "",
        };
        break;
      }
    }
    if (!picked) continue;
    rows.push({ boat, course: courseMap[boat] || boat, ...picked });
  }

  rows.sort((a, b) => a.boat - b.boat);
  if (rows.length < 6) throw new Error(`住之江の展示データが6艇分ありません（${rows.length}艇分）`);
  return rows.slice(0, 6);
}

function parseMarugameYoso05(html) {
  try {
    const start = html.indexOf('id="yoso03_03"');
    if (start < 0) throw new Error("section not found");
    let end = html.indexOf('id="yoso03_04"', start);
    if (end < 0) end = html.length;
    const section = html.slice(start, end);

    const bodies = [...section.matchAll(/<tbody>[\s\S]*?<\/tbody>/gi)].map((m) => m[0]);
    const rows = [];
    for (const body of bodies) {
      const boat = body.match(/<td[^>]*rowspan=["']2["'][^>]*>\s*([1-6])\s*<\/td>/i)?.[1];
      if (!boat) continue;

      const marker = body.lastIndexOf('</div>\n        </div>\n    </td>');
      const tail = marker >= 0 ? body.slice(marker) : body;
      const cells = [...tail.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => normNum(m[1])).filter(Boolean);
      const picked = pickDisplayValues(cells);
      if (!picked) continue;
      rows.push({ boat: Number(boat), course: Number(boat), ...picked });
    }

    rows.sort((a, b) => a.boat - b.boat);
    if (rows.length >= 6) return rows.slice(0, 6);
  } catch (e) {
    // 下のテキスト解析にフォールバック
  }
  return parseDisplayRowsByLines(html, "丸亀");
}

function parseGamagoriRecomend(html) {
  const preRows = {};
  const preRe = /<td[^>]*rowspan=["']2["'][^>]*class=["'][^"']*cho_waku[^"']*r([1-6])[^"']*["'][^>]*>[\s\S]*?<\/td>\s*<td[^>]*class=["'][^"']*cho_time[^"']*["'][^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class=["'][^"']*cho_weight[^"']*["'][^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*class=["'][^"']*cho_tilt[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = preRe.exec(html)) !== null) {
    const boat = Number(m[1]);
    if (!preRows[boat]) {
      preRows[boat] = { boat, weight: normNum(m[3]), tilt: normNum(m[4]) };
    }
  }

  const key = "オリジナル展示タイム";
  let start = html.indexOf(key);
  if (start < 0) start = html.indexOf("<!--展示情報/オリジナル展示タイム-->");
  if (start < 0) throw new Error("蒲郡のオリジナル展示タイム欄が見つかりません");
  let end = html.indexOf('<div id="come2"', start);
  if (end < 0) end = html.indexOf('<!--高橋', start);
  if (end < 0) end = html.length;
  const section = html.slice(start, end);

  const rows = [];
  const rowRe = /<tr>[\s\S]*?<td[^>]*class=["'][^"']*cho_course[^"']*["'][^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class=["'][^"']*cho_waku[^"']*r([1-6])[^"']*["'][^>]*>([\s\S]*?)<\/td>([\s\S]*?)<\/tr>/gi;
  while ((m = rowRe.exec(section)) !== null) {
    const course = Number(normNum(m[1]) || "");
    const boat = Number(m[2] || normNum(m[3]) || "");
    if (!boat) continue;
    const vals = [...m[4].matchAll(/<td[^>]*class=["'][^"']*ori_time[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi)].map((x) => normNum(x[1]));
    if (vals.length < 4) continue;
    rows.push({
      boat,
      course: course || boat,
      weight: preRows[boat]?.weight || "",
      tilt: preRows[boat]?.tilt || "",
      tenji: vals[0] || "",
      isshu: vals[1] || "",
      mawari: vals[2] || "",
      chokusen: vals[3] || "",
    });
  }

  rows.sort((a, b) => a.boat - b.boat);
  if (rows.length < 6) throw new Error(`蒲郡の展示データが6艇分ありません（${rows.length}艇分）`);
  return rows.slice(0, 6);
}

function parseShimonosekiCyokuzen(html) {
  return parseDisplayRowsByLines(html, "下関");
}

function parseMikuniCyokuzen(html) {
  return parseDisplayRowsByLines(html, "三国");
}

function parseHamanakoCyokuzen(html) {
  return parseDisplayRowsByLines(html, "浜名湖");
}

function parseTokonameCyokuzen(html) {
  return parseDisplayRowsByLines(html, "常滑");
}

function parseNarutoCyokuzen(html) {
  return parseDisplayRowsByLines(html, "鳴門");
}

function parseBiwakoCyokuzen(html) {
  try {
    return parseKaratsuCyokuzen(html);
  } catch (e) {
    return parseDisplayRowsByLines(html, "びわこ");
  }
}

function parseFukuokaCyokuzen(html) {
  try {
    return parseKaratsuCyokuzen(html);
  } catch (e) {
    return parseDisplayRowsByLines(html, "福岡");
  }
}

function parseKaratsuCyokuzen(html) {
  const rawLines = textLinesFromHtml(html);
  const raw = rawLines.join("\n");
  const tableStart = raw.search(/展示情報[\s\S]{0,250}枠[\s\S]{0,80}体重[\s\S]{0,80}チルト[\s\S]{0,80}展示/);
  const work = tableStart >= 0 ? raw.slice(tableStart) : raw;
  const tableEnd = work.search(/一周・まわり足・直線タイム|※展示評価|選手コメント|からつ専属/);
  const section = tableEnd >= 0 ? work.slice(0, tableEnd) : work;

  const rows = [];
  const rowRe = /(?:^|\n)\s*([1-6])\s*\n+\s*(4\d\.\d|5\d\.\d|6[0-2]\.\d)\s*\n+\s*(-?\d\.\d)\s*\n+\s*([67]\.\d{2})\s*\n+\s*([3-4]\d\.\d{2})\s*\n+\s*([4-7]\.\d{2})\s*\n+\s*([5-9]\.\d{2})/g;
  let m;
  while ((m = rowRe.exec(section)) !== null) {
    const boat = Number(m[1]);
    if (rows.some((r) => r.boat === boat)) continue;
    rows.push({
      boat,
      course: boat,
      weight: m[2],
      tilt: m[3],
      tenji: m[4],
      isshu: m[5],
      mawari: m[6],
      chokusen: m[7],
    });
  }

  // HTMLのセル区切りが詰まっている場合のフォールバック
  if (rows.length < 6) {
    const nums = section.match(/-?\d+(?:\.\d+)?/g) || [];
    const found = [];
    for (let i = 0; i < nums.length; i++) {
      const boat = Number(nums[i]);
      if (!(boat >= 1 && boat <= 6) || found.some((r) => r.boat === boat)) continue;
      const picked = pickDisplayValues(nums.slice(i + 1, i + 10));
      if (picked) found.push({ boat, course: boat, ...picked });
    }
    if (found.length >= 6) {
      found.sort((a, b) => a.boat - b.boat);
      return found.slice(0, 6);
    }
  }

  rows.sort((a, b) => a.boat - b.boat);
  if (rows.length < 6) throw new Error(`唐津の展示データが6艇分ありません（${rows.length}艇分）`);
  return rows.slice(0, 6);
}


function splitOddsCells(line) {
  const s = String(line || "").trim();
  if (!s) return [];
  return s.includes("\t")
    ? s.split("\t").map((c) => c.trim()).filter(Boolean)
    : s.split(/[ 　]+/).map((c) => c.trim()).filter(Boolean);
}

function isBoatNoText(x) {
  return /^[1-6]$/.test(String(x || "").trim());
}

function isOddsNoText(x) {
  return /^\d+(?:\.\d+)?$/.test(String(x || "").replace(/,/g, "").trim());
}

function toOddsNo(x) {
  return Number(String(x || "").replace(/,/g, "").trim());
}

function parseOddsTextLines(rawLines) {
  const usable = rawLines.map((l) => String(l || "").trim()).filter(Boolean);
  const out = {};
  let first = null;
  let second = null;

  for (let li = 0; li < usable.length; li++) {
    const line = usable[li];
    if (/更新ボタン|レース情報|Copyright|All Rights Reserved|TOP\b/.test(line)) {
      if (Object.keys(out).length >= 10) break;
    }
    const cells = splitOddsCells(line);
    if (!cells.length) continue;

    const isHeader = (
      cells.length >= 2
        && isBoatNoText(cells[0])
        && !isOddsNoText(cells[1])
        && !/合成|単勝|複勝|3連単|2連単|3連複|拡連複|人気|高配当|更新|締切|MENU/.test(line)
    ) || (
      // 住之江など: 1着艇番号だけが単独行、その次の行に選手名が来る形式
      cells.length === 1
        && isBoatNoText(cells[0])
        && usable[li + 1]
        && !isBoatNoText(usable[li + 1])
        && !isOddsNoText(usable[li + 1])
        && !/合成|単勝|複勝|3連単|2連単|3連複|拡連複|人気|高配当|更新|締切|MENU|予選/.test(usable[li + 1])
    );

    if (isHeader) {
      first = Number(cells[0]);
      second = null;
      continue;
    }
    if (!first) continue;

    if (cells.length >= 3 && isBoatNoText(cells[0]) && isBoatNoText(cells[1]) && isOddsNoText(cells[2])) {
      second = Number(cells[0]);
      const third = Number(cells[1]);
      const o = toOddsNo(cells[2]);
      if (second !== first && third !== first && third !== second && o > 0) out[`${first}-${second}-${third}`] = o;
      for (let i = 3; i + 1 < cells.length; i += 2) {
        const t = Number(cells[i]);
        const oo = toOddsNo(cells[i + 1]);
        if (second && t >= 1 && t <= 6 && t !== first && t !== second && oo > 0) out[`${first}-${second}-${t}`] = oo;
      }
      continue;
    }

    if (second && cells.length >= 2 && isBoatNoText(cells[0]) && isOddsNoText(cells[1])) {
      const third = Number(cells[0]);
      const o = toOddsNo(cells[1]);
      if (third !== first && third !== second && o > 0) out[`${first}-${second}-${third}`] = o;
      for (let i = 2; i + 1 < cells.length; i += 2) {
        const t = Number(cells[i]);
        const oo = toOddsNo(cells[i + 1]);
        if (t >= 1 && t <= 6 && t !== first && t !== second && oo > 0) out[`${first}-${second}-${t}`] = oo;
      }
    }
  }
  return out;
}

function parseGridOddsTextLines(rawLines) {
  const blocks = [];
  let cur = null;
  for (const line of rawLines) {
    const cells = splitOddsCells(line);
    if (!cells.length) continue;
    const isHeader = (cells.length >= 2
      && isBoatNoText(cells[0])
      && !/^[\d.]/.test(cells[1])
      && !/合成|単勝|複勝|3連単|2連単|3連複|拡連複|人気|高配当|更新/.test(line))
      || (cells.length === 1 && isBoatNoText(cells[0]));
    if (isHeader) {
      if (cur) blocks.push(cur);
      cur = { first: Number(cells[0]), rows: [] };
    } else if (cur && !/合成|単勝|複勝/.test(line)) {
      cur.rows.push(cells);
    }
  }
  if (cur) blocks.push(cur);

  const out = {};
  for (const blk of blocks) {
    const first = blk.first;
    const rows = blk.rows;
    if (!rows.length) continue;
    const colSeconds = [];
    const r0 = rows[0];
    for (let i = 0; i + 2 < r0.length; i += 3) {
      const sec = Number(r0[i]);
      const third = Number(r0[i + 1]);
      const o = toOddsNo(r0[i + 2]);
      if ([sec, third].every((x) => x >= 1 && x <= 6) && o > 0) {
        colSeconds.push(sec);
        if (third !== first && third !== sec) out[`${first}-${sec}-${third}`] = o;
      }
    }
    for (let ri = 1; ri < rows.length; ri++) {
      const toks = rows[ri];
      for (let ci = 0; ci < colSeconds.length; ci++) {
        const third = Number(toks[ci * 2]);
        const o = toOddsNo(toks[ci * 2 + 1]);
        const sec = colSeconds[ci];
        if (third >= 1 && third <= 6 && o > 0 && third !== first && third !== sec) out[`${first}-${sec}-${third}`] = o;
      }
    }
  }
  return out;
}

function parseGroupedOddsTextLines(rawLines) {
  const lines = rawLines.map((l) => String(l || "").trim()).filter(Boolean);
  const blocks = [];

  const isNameLike = (line) => {
    const cells = splitOddsCells(line);
    return line && !isOddsNoText(line) && !(cells.length === 1 && isBoatNoText(cells[0])) && !/3連単|2連単|3連複|人気|締切|予選|オッズ|結果/.test(line);
  };

  for (let i = 0; i < lines.length; i++) {
    const cells = splitOddsCells(lines[i]);
    let first = null;
    let start = -1;

    if (cells.length === 1 && isBoatNoText(cells[0]) && isNameLike(lines[i + 1] || "")) {
      first = Number(cells[0]);
      start = i + 1;
    } else if (cells.length >= 2 && isBoatNoText(cells[0]) && !isOddsNoText(cells[1]) && !/3連単|2連単|3連複|人気|締切/.test(lines[i])) {
      first = Number(cells[0]);
      start = i;
    }

    if (!first) continue;

    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const cc = splitOddsCells(lines[j]);
      if (cc.length === 1 && isBoatNoText(cc[0]) && isNameLike(lines[j + 1] || "")) { end = j; break; }
      if (cc.length >= 2 && isBoatNoText(cc[0]) && !isOddsNoText(cc[1]) && !/3連単|2連単|3連複|人気|締切/.test(lines[j])) { end = j; break; }
    }
    blocks.push({ first, lines: lines.slice(start, end) });
    i = end - 1;
  }

  const out = {};
  for (const blk of blocks) {
    const nums = [];
    for (const line of blk.lines) {
      for (const c of splitOddsCells(line)) {
        if (isOddsNoText(c)) nums.push(toOddsNo(c));
      }
    }

    let i = 0;
    while (i < nums.length) {
      const sec = nums[i++];
      if (!(Number.isInteger(sec) && sec >= 1 && sec <= 6) || sec === blk.first) continue;
      for (let k = 0; k < 4 && i + 1 < nums.length; k++) {
        const third = nums[i++];
        const odds = nums[i++];
        if (Number.isInteger(third) && third >= 1 && third <= 6 && third !== blk.first && third !== sec && odds > 0) {
          out[`${blk.first}-${sec}-${third}`] = odds;
        }
      }
    }
  }
  return out;
}


function parseOddsFromHtml(html) {
  const lines = textLinesFromHtml(html);
  const seq = parseOddsTextLines(lines);
  const grid = parseGridOddsTextLines(lines);
  const grouped = parseGroupedOddsTextLines(lines);
  const candidates = [seq, grid, grouped];
  return candidates.sort((a, b) => Object.keys(b).length - Object.keys(a).length)[0] || {};
}

function buildOddsUrls(venue, raceNo, dateStr) {
  const ymd = yyyymmdd(dateStr);
  const r = Number(raceNo);
  const jcd = JCD[venue];
  const urls = [];

  if (venue === "丸亀") {
    const rr = String(r).padStart(2, "0");
    urls.push(`https://www.marugameboat.jp/asp/kyogi/15/pc/odds01${rr}.htm`);
  }

  if (venue === "蒲郡") {
    const rr = String(r).padStart(2, "0");
    urls.push(`https://www.gamagori-kyotei.com/asp/gamagori/kyogi/kyogihtml/ozz3rentanpuku/ozz3rentanpuku${ymd}07${rr}.htm`);
  }

  if (venue === "下関") {
    urls.push(`https://www.boatrace-shimonoseki.jp/modules/yosou/group-odds-result.php?day=${ymd}&race=${r}&if=1`);
  }

  if (venue === "住之江") {
    const rr = String(r).padStart(2, "0");
    urls.push(`https://www.boatrace-suminoe.jp/asp/kyogi/12/pc/odds01${rr}.htm`);
  }

  if (venue === "三国") {
    urls.push(`https://www.boatrace-mikuni.jp/modules/yosou/group-odds-result.php?day=${ymd}&race=${r}&if=1`);
  }

  if (venue === "唐津") {
    urls.push(`https://www.boatrace-karatsu.jp/sp/index.php?page=yosou-odds&race=${r}`);
    urls.push(`https://www.boatrace-karatsu.jp/sp/index.php?page=odds&race=${r}`);
    urls.push(`https://www.boatrace-karatsu.jp/sp/index.php?page=yosou-odds3t&race=${r}`);
    urls.push(`https://www.boatrace-karatsu.jp/sp/index.php?page=yosou-cyokuzen&race=${r}`);
  }

  if (venue === "鳴門") {
    urls.push(`https://www.n14.jp/modules/yosou/group-odds-result.php?day=${ymd}&race=${r}&if=1`);
  }

  if (venue === "児島") {
    const rr = String(r).padStart(2, "0");
    urls.push(`https://www.kojimaboat.jp/asp/kyogi/16/pc/odds01${rr}.htm`);
    urls.push(`https://www.kojimaboat.jp/asp/kyogi/16/sp/odds01${rr}.htm`);
  }

  if (venue === "福岡") {
    urls.push(`https://www.boatrace-fukuoka.com/sp/index.php?page=yosou-odds&race=${r}`);
    urls.push(`https://www.boatrace-fukuoka.com/sp/index.php?page=yosou-odds#start_position`);
  }

  if (venue === "平和島") {
    const rr = String(r).padStart(2, "0");
    urls.push(`https://www.heiwajima.gr.jp/asp/kyogi/04/pc/odds01${rr}.htm`);
    urls.push(`https://www.heiwajima.gr.jp/asp/kyogi/04/sp/odds01${rr}.htm`);
  }

  if (venue === "びわこ") {
    urls.push(`https://www.boatrace-biwako.jp/sp/index.php?page=yosou-odds&race=${r}`);
    urls.push(`https://www.boatrace-biwako.jp/sp/index.php?page=yosou-odds#start_position`);
  }

  if (venue === "常滑") {
    urls.push(`https://www.boatrace-tokoname.jp/modules/yosou/group-odds-result.php?day=${ymd}&race=${r}&if=1`);
  }

  if (venue === "浜名湖") {
    urls.push(`https://www.boatrace-hamanako.jp/modules/yosou/group-odds-result.php?day=${ymd}&race=${r}&if=1`);
  }

  if (jcd) {
    urls.push(`https://www.boatrace.jp/owpc/pc/race/odds3t?rno=${r}&jcd=${jcd}&hd=${ymd}`);
  }

  return urls;
}

async function fetchOddsForVenue(venue, raceNo, dateStr) {
  if (!["丸亀", "蒲郡", "下関", "住之江", "三国", "唐津", "鳴門", "児島", "福岡", "平和島", "びわこ", "常滑", "浜名湖"].includes(venue)) return null;
  const errors = [];
  for (const url of buildOddsUrls(venue, raceNo, dateStr)) {
    try {
      const html = await fetchHtml(url);
      const odds = parseOddsFromHtml(html);
      const count = Object.keys(odds).length;
      if (count >= 10) return { ok: true, url, count, odds };
      errors.push(`${url} => ${count}点`);
    } catch (e) {
      errors.push(`${url} => ${e.message || e}`);
    }
  }
  return { ok: false, error: errors.join(" / ") };
}

function buildUrl(venue, raceNo, dateStr) {
  const rr = String(raceNo).padStart(2, "0");
  const ymd = yyyymmdd(dateStr);
  if (venue === "丸亀") return `https://www.marugameboat.jp/asp/kyogi/15/pc/yoso05${rr}.htm`;
  if (venue === "平和島") return `https://www.heiwajima.gr.jp/asp/kyogi/04/pc/yoso05${rr}.htm`;
  if (venue === "児島") return `https://www.kojimaboat.jp/asp/kyogi/16/pc/yoso05${rr}.htm`;
  if (venue === "蒲郡") return `https://www.gamagori-kyotei.com/asp/gamagori/sp/kyogi/kyogihtml/recomend/recomend${ymd}07${rr}.htm`;
  if (venue === "住之江") return `https://www.boatrace-suminoe.jp/asp/kyogi/12/pc/st02${rr}.htm`;
  if (venue === "下関") return `https://www.boatrace-shimonoseki.jp/modules/yosou/group-cyokuzen.php?day=${ymd}&race=${Number(raceNo)}&if=1`;
  if (venue === "三国") return `https://www.boatrace-mikuni.jp/modules/yosou/group-cyokuzen.php?day=${ymd}&race=${Number(raceNo)}&if=1`;
  if (venue === "鳴門") return `https://www.n14.jp/modules/yosou/group-cyokuzen.php?day=${ymd}&race=${Number(raceNo)}&if=1`;
  if (venue === "常滑") return `https://www.boatrace-tokoname.jp/modules/yosou/group-cyokuzen.php?day=${ymd}&race=${Number(raceNo)}&if=1`;
  if (venue === "浜名湖") return `https://www.boatrace-hamanako.jp/modules/yosou/group-cyokuzen.php?day=${ymd}&race=${Number(raceNo)}&if=1`;
  if (venue === "唐津") return `https://www.boatrace-karatsu.jp/sp/index.php?page=yosou-cyokuzen&race=${Number(raceNo)}`;
  if (venue === "福岡") return `https://www.boatrace-fukuoka.com/sp/index.php?page=yosou-cyokuzen&race=${Number(raceNo)}`;
  if (venue === "びわこ") return `https://www.boatrace-biwako.jp/sp/index.php?page=yosou-cyokuzen&race=${Number(raceNo)}`;
  throw new Error(`${venue || "未選択"}はまだ展示等自動取得未対応です`);
}

function buildOfficialBeforeInfoUrl(venue, raceNo, dateStr) {
  const jcd = JCD[venue];
  if (!jcd) return "";
  const ymd = yyyymmdd(dateStr);
  return `https://www.boatrace.jp/owpc/pc/race/beforeinfo?jcd=${jcd}&rno=${Number(raceNo)}&hd=${ymd}`;
}

function parseByVenue(venue, html) {
  if (venue === "丸亀") return parseMarugameYoso05(html);
  if (venue === "平和島") return parseHeiwajimaYoso05(html);
  if (venue === "児島") return parseKojimaYoso05(html);
  if (venue === "蒲郡") return parseGamagoriRecomend(html);
  if (venue === "住之江") return parseSuminoeSt02(html);
  if (venue === "下関") return parseShimonosekiCyokuzen(html);
  if (venue === "三国") return parseMikuniCyokuzen(html);
  if (venue === "鳴門") return parseNarutoCyokuzen(html);
  if (venue === "常滑") return parseTokonameCyokuzen(html);
  if (venue === "浜名湖") return parseHamanakoCyokuzen(html);
  if (venue === "唐津") return parseKaratsuCyokuzen(html);
  if (venue === "福岡") return parseFukuokaCyokuzen(html);
  if (venue === "びわこ") return parseBiwakoCyokuzen(html);
  throw new Error(`${venue || "未選択"}はまだ展示等自動取得未対応です`);
}

async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; HunakenAcademiaTool/1.0; +https://hunaken-academia.vercel.app)",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "referer": "https://www.boatrace.jp/",
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}

function validRows(rows) {
  return Array.isArray(rows) && rows.length >= 6 && rows.every((r) => r.boat && r.tenji && r.isshu && r.mawari);
}

function pruneCache() {
  const now = Date.now();
  for (const [k, v] of cacheStore.entries()) {
    if (!v || now - v.savedAt > CACHE_MS * 4) cacheStore.delete(k);
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=180, stale-while-revalidate=60");
  try {
    const venue = String(req.query.venue || "");
    const race = String(req.query.race || "").replace(/\D/g, "");
    const raceNo = Number(race);
    if (!raceNo || raceNo < 1 || raceNo > 12) {
      res.status(400).json({ ok: false, error: "race は 1〜12 を指定してください" });
      return;
    }

    const date = String(req.query.date || "");
    const ymd = yyyymmdd(date);
    const key = `${venue}:${raceNo}:${ymd}`;
    pruneCache();
    const cached = cacheStore.get(key);
    if (cached && Date.now() - cached.savedAt < CACHE_MS) {
      res.status(200).json({ ...cached.data, cached: true, cacheTtlSec: Math.max(0, Math.ceil((CACHE_MS - (Date.now() - cached.savedAt)) / 1000)) });
      return;
    }

    const url = buildUrl(venue, raceNo, ymd);
    const html = await fetchHtml(url).catch((e) => {
      throw new Error(`${venue}公式サイト取得失敗: ${e.message || e}`);
    });
    const rows = parseByVenue(venue, html);
    if (!validRows(rows)) throw new Error(`${venue}の展示・一周・まわり足・直線が6艇分そろいませんでした`);

    let weather = parseWeather(html);
    const weatherUrl = buildOfficialBeforeInfoUrl(venue, raceNo, ymd);
    if (weatherUrl) {
      try {
        const officialHtml = await fetchHtml(weatherUrl);
        const officialWeather = parseWeather(officialHtml);
        // 空欄や「風向き不明なのに無風扱い」は上書きしない
        weather = {
          ...weather,
          ...Object.fromEntries(Object.entries(officialWeather).filter(([k, v]) => {
            if (v === "" || v == null) return false;
            if (k === "windKey" && v === "無風" && officialWeather.windDirection === "" && Number(officialWeather.windSpeed || 0) > 0) return false;
            return true;
          })),
        };
      } catch (e) {
        weather = { ...weather, weatherError: e.message || String(e) };
      }
    }

    let oddsInfo = null;
    try {
      oddsInfo = await fetchOddsForVenue(venue, raceNo, ymd);
    } catch (e) {
      oddsInfo = { ok: false, error: e.message || String(e) };
    }

    const payload = {
      ok: true,
      venue,
      race: raceNo,
      date: ymd,
      url,
      weatherUrl: weatherUrl || null,
      rows,
      weather,
      odds: oddsInfo?.ok ? oddsInfo.odds : null,
      oddsCount: oddsInfo?.ok ? oddsInfo.count : 0,
      oddsUrl: oddsInfo?.ok ? oddsInfo.url : null,
      oddsError: oddsInfo && !oddsInfo.ok ? oddsInfo.error : "",
      cached: false,
      cacheTtlSec: Math.floor(CACHE_MS / 1000),
      fetchedAt: new Date().toISOString(),
    };
    cacheStore.set(key, { savedAt: Date.now(), data: payload });
    res.status(200).json(payload);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}
