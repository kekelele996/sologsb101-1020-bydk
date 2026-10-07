/**
 * 纪年与断代复核工具
 * - 跋文纪年原文（年号 / 民国 / 公元）→ 公元年，用于按纪年排序
 * - 编目员纸墨断代（如「明拓」「清晚期拓」「民国拓」）→ 年代下限
 * - 实物跋文纪年早于纸墨断代下限时，该断代被跋顶翻 → 转待核
 *
 * 只做本台断代复核所需的粗尺度换算（朝代级别），不做朔闰精确推演；
 * 无法解析的纪年返回 null，按「不参与比对」处理，仍照常按原文展示。
 */

/** 朝代 / 时期 → 起始年（下限）。末年不写死，比较时只需「拓本不早于某年」。 */
const ERA_LOWER_BOUNDS: Array<{ pattern: RegExp; lower: number }> = [
  { pattern: /民国/, lower: 1912 },
  { pattern: /清\s*晚|晚清/, lower: 1821 }, // 道光
  { pattern: /清\s*中|清中期|清中/, lower: 1662 }, // 康熙
  { pattern: /清\s*初|清初/, lower: 1644 },
  { pattern: /清/, lower: 1644 },
  { pattern: /明\s*晚|晚明/, lower: 1522 }, // 嘉靖
  { pattern: /明\s*中|明中期/, lower: 1465 }, // 成化
  { pattern: /明\s*初|明初/, lower: 1368 },
  { pattern: /明/, lower: 1368 },
  { pattern: /元/, lower: 1271 },
  { pattern: /南宋|宋/, lower: 960 },
  { pattern: /北宋/, lower: 960 },
  { pattern: /唐/, lower: 618 },
];

/** 常见年号元年（公元），覆盖题跋常见纪年；未列年号无法解析则不参与复核 */
const REIGN_ERAS: Array<{ name: string; firstYear: number; maxNianhao: number }> = [
  // 明
  { name: '洪武', firstYear: 1368, maxNianhao: 31 },
  { name: '建文', firstYear: 1399, maxNianhao: 4 },
  { name: '永乐', firstYear: 1403, maxNianhao: 22 },
  { name: '洪熙', firstYear: 1425, maxNianhao: 1 },
  { name: '宣德', firstYear: 1426, maxNianhao: 10 },
  { name: '正统', firstYear: 1436, maxNianhao: 14 },
  { name: '景泰', firstYear: 1450, maxNianhao: 8 },
  { name: '天顺', firstYear: 1457, maxNianhao: 8 },
  { name: '成化', firstYear: 1465, maxNianhao: 23 },
  { name: '弘治', firstYear: 1488, maxNianhao: 18 },
  { name: '正德', firstYear: 1506, maxNianhao: 16 },
  { name: '嘉靖', firstYear: 1522, maxNianhao: 45 },
  { name: '隆庆', firstYear: 1567, maxNianhao: 6 },
  { name: '万历', firstYear: 1573, maxNianhao: 48 },
  { name: '泰昌', firstYear: 1620, maxNianhao: 1 },
  { name: '天启', firstYear: 1621, maxNianhao: 7 },
  { name: '崇祯', firstYear: 1628, maxNianhao: 17 },
  // 清
  { name: '顺治', firstYear: 1644, maxNianhao: 18 },
  { name: '康熙', firstYear: 1662, maxNianhao: 61 },
  { name: '雍正', firstYear: 1723, maxNianhao: 13 },
  { name: '乾隆', firstYear: 1736, maxNianhao: 60 },
  { name: '嘉庆', firstYear: 1796, maxNianhao: 25 },
  { name: '道光', firstYear: 1821, maxNianhao: 30 },
  { name: '咸丰', firstYear: 1851, maxNianhao: 11 },
  { name: '同治', firstYear: 1862, maxNianhao: 13 },
  { name: '光绪', firstYear: 1875, maxNianhao: 34 },
  { name: '宣统', firstYear: 1909, maxNianhao: 3 },
];

const CN_DIGITS: Record<string, number> = {
  〇: 0,
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** 中文数字（≤ 999，题跋纪年常见范围）→ 阿拉伯数字；失败返回 null */
export function cnToNumber(text: string): number | null {
  // 廿 / 卅 / 卌 为合文数字，先折算为「二十 / 三十 / 四十」
  const trimmed = text.trim().replace(/卄|廿/g, '二十').replace(/卅/g, '三十').replace(/卌/g, '四十');
  if (trimmed.length === 0) return null;
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  let result = 0;
  let section = 0;
  let any = false;
  for (const char of trimmed) {
    if (char in CN_DIGITS) {
      section = CN_DIGITS[char] as number;
      any = true;
    } else if (char === '十') {
      result += (section === 0 ? 1 : section) * 10;
      section = 0;
      any = true;
    } else if (char === '百') {
      result += (section === 0 ? 1 : section) * 100;
      section = 0;
      any = true;
    } else {
      return null;
    }
  }
  result += section;
  return any ? result : null;
}

/**
 * 跋文纪年原文 → 公元年。
 * 支持「康熙五十年」「乾隆卅一年」（卄/卅/卌 折算）、「民国二十三年」、「光绪三十年甲辰」等带干支后缀、
 * 以及「1890 年」「1890」。识别不出返回 null。
 */
export function parseColophonYear(eraText: string): number | null {
  const raw = eraText.trim();
  if (raw.length === 0) return null;

  // 民国纪年：民国 N 年 = 1911 + N
  if (/民\s*[国國]\s*元\s*年/.test(raw)) return 1912;
  const republic = /民\s*[国國]\s*([〇零一二两三四五六七八九十百\d]+)\s*年?/.exec(raw);
  if (republic) {
    const nian = cnToNumber(republic[1] as string);
    if (nian !== null && nian >= 1 && nian <= 38) return 1911 + nian;
  }

  const normalized = raw.replace(/卄|廿/g, '二十').replace(/卅/g, '三十').replace(/卌/g, '四十');
  for (const reign of REIGN_ERAS) {
    const matched = new RegExp(`${reign.name}\\s*([〇零一二两三四五六七八九十百\\d]+)\\s*年`).exec(normalized);
    if (matched) {
      const nian = cnToNumber(matched[1] as string);
      if (nian !== null && nian >= 1 && nian <= reign.maxNianhao) {
        return reign.firstYear + nian - 1;
      }
    }
    // 「康熙元年」
    if (new RegExp(`${reign.name}\\s*元\\s*年`).test(normalized)) return reign.firstYear;
  }

  // 公元纪年兜底：取第一个 3-4 位数字（限定 260—2100，排除碑刻行号等噪声）
  const western = /(?:公元)?\s*(\d{3,4})\s*年?/.exec(raw);
  if (western) {
    const year = Number.parseInt(western[1] as string, 10);
    if (year >= 260 && year <= 2100) return year;
  }

  return null;
}

/**
 * 编目员纸墨断代 → 该拓本不早于的公元年（年代下限）。
 * 「明拓」→ 1368；「清晚期拓」→ 1821。只有朝代词、无法定时段的取朝代起始年。
 * 解析不出（空 / 「待考」）返回 null，表示该断代不参与跋文复核。
 */
export function dateGuessLowerBound(dateGuess: string): number | null {
  const text = dateGuess.trim();
  if (text.length === 0 || /待考|不詳|不详|未知/.test(text)) return null;
  for (const { pattern, lower } of ERA_LOWER_BOUNDS) {
    if (pattern.test(text)) return lower;
  }
  // 纯公元年描述，如「约 1880 年拓」
  const year = /(\d{3,4})\s*年/.exec(text);
  if (year) {
    const value = Number.parseInt(year[1] as string, 10);
    if (value >= 260 && value <= 2100) return value;
  }
  return null;
}

export interface DatingCheckInput {
  /** 编目员按纸墨给的断代，保留不改 */
  dateGuess: string;
  /** 该拓本上的跋文（至少含核定公元年） */
  colophons: ReadonlyArray<{ id: string; collectorName: string; eraText: string; eraYear: number | null }>;
}

export interface DatingCheckResult {
  /** 纸墨断代的年代下限（无考为 null） */
  lowerBound: number | null;
  /** 顶翻该断代的那条跋（纪年最早且早于下限） */
  challenger: DatingCheckInput['colophons'][number] | null;
  /** 是否转为待核：存在核定纪年早于纸墨断代下限的跋 */
  review: boolean;
}

/**
 * 断代复核：编目员看纸墨给的断代照旧保留；实物跋文纪年比它早时，断代站不住，转待核。
 * 顶断者取纪年最早的可考跋，并写明是哪条跋顶的。
 */
export function reviewDateGuess(input: DatingCheckInput): DatingCheckResult {
  const lowerBound = dateGuessLowerBound(input.dateGuess);
  const datable = input.colophons
    .filter((item): item is NonNullable<typeof item> => item.eraYear !== null)
    .sort((a, b) => (a.eraYear as number) - (b.eraYear as number));
  if (lowerBound === null || datable.length === 0) {
    return { lowerBound, challenger: null, review: false };
  }
  const earliest = datable[0] as DatingCheckInput['colophons'][number];
  const review = (earliest.eraYear as number) < lowerBound;
  return { lowerBound, challenger: review ? earliest : null, review };
}

/** 排序用：跋文按纪年先后排；无核定纪年的排在有纪年之后，再以录入时间兜底 */
export function colophonEraOrder(
  a: { eraYear: number | null; createdAt: number },
  b: { eraYear: number | null; createdAt: number },
): number {
  if (a.eraYear !== null && b.eraYear !== null) {
    return a.eraYear === b.eraYear ? a.createdAt - b.createdAt : a.eraYear - b.eraYear;
  }
  if (a.eraYear !== null) return -1;
  if (b.eraYear !== null) return 1;
  return a.createdAt - b.createdAt;
}
