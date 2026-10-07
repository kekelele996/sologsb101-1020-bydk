/**
 * 纪年与断代顶核工具
 * - 题跋纪年原文 → 公元年（年号纪年 / 民国纪年 / 公元纪年）
 * - 编目员纸墨断代（明拓 / 清中期拓 …）→ 拓制不早于的下限公元年
 * - 实物跋文纪年早于纸墨断代下限时，该断代站不住：返回顶核的题跋
 *
 * 换算不出纪年的题跋只展示、不参与顶核；推演全部为只读派生，不改写旧断代字段。
 */
import type { Colophon } from '@/types/colophon';
import type { Rubbing } from '@/types/rubbing';
import { colophonCollectorName } from '@/types/colophon';
import type { Collector } from '@/types/collector';

/** 年号元年对应公元年；同名年号取通行纪年（后至元等歧义不另注） */
const REIGN_ERAS: ReadonlyArray<{ name: string; firstYear: number }> = [
  // 清
  { name: '宣统', firstYear: 1909 },
  { name: '光绪', firstYear: 1875 },
  { name: '同治', firstYear: 1862 },
  { name: '咸丰', firstYear: 1851 },
  { name: '道光', firstYear: 1821 },
  { name: '嘉庆', firstYear: 1796 },
  { name: '乾隆', firstYear: 1736 },
  { name: '雍正', firstYear: 1723 },
  { name: '康熙', firstYear: 1662 },
  { name: '顺治', firstYear: 1644 },
  // 明
  { name: '崇祯', firstYear: 1628 },
  { name: '天启', firstYear: 1621 },
  { name: '泰昌', firstYear: 1620 },
  { name: '万历', firstYear: 1573 },
  { name: '隆庆', firstYear: 1567 },
  { name: '嘉靖', firstYear: 1522 },
  { name: '正德', firstYear: 1506 },
  { name: '弘治', firstYear: 1488 },
  { name: '成化', firstYear: 1465 },
  { name: '天顺', firstYear: 1457 },
  { name: '景泰', firstYear: 1450 },
  { name: '正统', firstYear: 1436 },
  { name: '宣德', firstYear: 1426 },
  { name: '洪熙', firstYear: 1425 },
  { name: '永乐', firstYear: 1403 },
  { name: '建文', firstYear: 1399 },
  { name: '洪武', firstYear: 1368 },
  // 元
  { name: '至正', firstYear: 1341 },
  { name: '延祐', firstYear: 1314 },
  { name: '大德', firstYear: 1297 },
  { name: '至元', firstYear: 1264 },
  // 宋
  { name: '景定', firstYear: 1260 },
  { name: '淳祐', firstYear: 1241 },
  { name: '嘉定', firstYear: 1208 },
  { name: '淳熙', firstYear: 1174 },
  { name: '绍兴', firstYear: 1131 },
  { name: '建炎', firstYear: 1127 },
  { name: '宣和', firstYear: 1119 },
  { name: '崇宁', firstYear: 1102 },
  { name: '绍圣', firstYear: 1094 },
  { name: '元祐', firstYear: 1086 },
  { name: '大中祥符', firstYear: 1008 },
  { name: '淳化', firstYear: 990 },
  { name: '建隆', firstYear: 960 },
  // 唐
  { name: '开成', firstYear: 836 },
  { name: '元和', firstYear: 806 },
  { name: '大历', firstYear: 766 },
  { name: '天宝', firstYear: 742 },
  { name: '开元', firstYear: 713 },
  { name: '贞观', firstYear: 627 },
  { name: '武德', firstYear: 618 },
  // 东汉
  { name: '永寿', firstYear: 155 },
  { name: '建和', firstYear: 147 },
];

/** 中文数目字（年号年序在六十以内，覆盖到「六十」即可） */
const CN_DIGITS: Record<string, number> = {
  元: 1,
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

/** 解析年序：元年 / 十九 / 二十 / 二十三 / 35 */
export function parseYearNumber(text: string): number | null {
  const trimmed = text.trim();
  if (/^\d{1,3}$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  if (trimmed === '元年' || trimmed === '元') return 1;
  if (!trimmed.endsWith('年')) return null;
  const body = trimmed.slice(0, -1);
  if (/^\d{1,3}$/.test(body)) return Number.parseInt(body, 10);
  if (/^[元一二两三四五六七八九十]+$/.test(body)) {
    if (body === '十') return 10;
    const tensIndex = body.indexOf('十');
    if (tensIndex >= 0) {
      const tensChar = tensIndex === 0 ? '一' : body[tensIndex - 1];
      const onesChar = body[tensIndex + 1];
      const tens = tensChar ? (CN_DIGITS[tensChar] ?? NaN) : NaN;
      const ones = onesChar ? (CN_DIGITS[onesChar] ?? 0) : 0;
      if (Number.isFinite(tens)) return tens * 10 + ones;
      return null;
    }
    return CN_DIGITS[body] ?? null;
  }
  return null;
}

/**
 * 题跋纪年原文 → 公元年。
 * 支持「康熙十九年」「民国二十三年」「1935 年」；只给年号无年序时取年号元年（偏保守）。
 * 识别不出返回 null。
 */
export function parseDateTextToYear(raw: string): number | null {
  const text = raw.replace(/\s+/g, '');
  if (text.length === 0) return null;

  // 公元纪年
  const western = /(\d{3,4})\s*年?/.exec(text);
  if (/公元|西历|公历/.test(text) && western) return Number.parseInt(western[1] as string, 10);

  // 民国纪年：民国元年 = 1912，民国 n 年 = 1911 + n
  const republic = /民国\s*(元|[一二两三四五六七八九十]{1,3}|\d{1,3})\s*年/.exec(text);
  if (republic) {
    const n = parseYearNumber(`${republic[1]}年`);
    if (n !== null) return 1911 + n;
  }
  if (/民国/.test(text)) return 1912;

  // 年号纪年：年号名长的优先匹配（如「大中祥符」先于其它二字年号）
  const eras = [...REIGN_ERAS].sort((a, b) => b.name.length - a.name.length);
  for (const era of eras) {
    const matched = new RegExp(`${era.name}([元一二两三四五六七八九十]{1,3}|\\d{1,3})?年`).exec(text);
    if (matched) {
      const n = matched[1] ? parseYearNumber(`${matched[1]}年`) : 1;
      if (n !== null) return era.firstYear + n - 1;
    }
    if (text.includes(era.name)) return era.firstYear;
  }

  // 形如「1935 年」的裸公元纪年兜底
  if (western && !/[唐宋元明清民国汉魏隋晋南北朝五代辽金]/.test(text)) {
    return Number.parseInt(western[1] as string, 10);
  }
  return null;
}

/**
 * 编目员纸墨断代 → 拓制时间不早于的下限公元年。
 * 越具体的断代下限越晚；宽泛或无法识别（旧拓等）返回 null，表示无法被顶核。
 */
export function paperInkFloorYear(dateGuess: string): number | null {
  const text = dateGuess.replace(/\s+/g, '');
  if (text.length === 0) return null;

  // 先看具体年号纪年（如「乾隆拓」）
  const eraYear = parseDateTextToYear(text);
  const hasGenericDynasty = /[唐宋元明清民国汉魏隋晋]/.test(text);
  if (eraYear !== null && !hasGenericDynasty) return eraYear;

  if (/民国/.test(text)) return 1912;
  if (/清/.test(text)) {
    if (/晚|末|光绪|宣统|同治|咸丰/.test(text)) return 1821;
    if (/中期|中|乾隆|嘉庆|道光|雍正/.test(text)) return 1736;
    if (/早|初|前期|康熙|顺治|清初/.test(text)) return 1644;
    return 1644; // 笼统「清拓」：入清即可能
  }
  if (/明/.test(text)) {
    if (/晚|末|崇祯|天启|万历|泰昌|隆庆/.test(text)) return 1573;
    if (/中期|中|成化|弘治|正德|嘉靖|正统|景泰|天顺/.test(text)) return 1436;
    if (/早|初|前期|洪武|永乐|宣德|洪熙|建文/.test(text)) return 1368;
    return 1368; // 笼统「明拓」
  }
  if (/元/.test(text)) return 1271;
  if (/宋/.test(text)) return 960;
  if (/唐/.test(text)) return 618;
  // 「旧拓」「古拓」等无具体朝代指向，无法立下限
  return null;
}

/** 题跋公元年：优先用编目员核定的 dateYear，缺省时由纪年原文换算 */
export function colophonYearValue(colophon: Colophon): number | null {
  if (typeof colophon.dateYear === 'number') return colophon.dateYear;
  return parseDateTextToYear(colophon.dateText);
}

/** 题跋按纪年先后排：可系年的升序在前，无法系年的按录入先后附后 */
export function sortColophons(colophons: Colophon[]): Colophon[] {
  return [...colophons].sort((a, b) => {
    const yearA = colophonYearValue(a);
    const yearB = colophonYearValue(b);
    if (yearA === null && yearB === null) return a.createdAt - b.createdAt;
    if (yearA === null) return 1;
    if (yearB === null) return -1;
    if (yearA !== yearB) return yearA - yearB;
    return a.createdAt - b.createdAt;
  });
}

export interface DatingChallenge {
  /** 顶核断代的那条（纪年最早的）题跋 */
  colophon: Colophon;
  /** 题跋纪年公元年 */
  colophonYear: number;
  /** 被顶的纸墨断代下限公元年 */
  floorYear: number;
  /** 题跋藏家展示名（待认领时为题署原文） */
  collectorName: string;
}

/**
 * 实物跋文早于纸墨断代：纪年最早且早于断代下限的题跋顶核。
 * 待认领藏家的跋同样是实物证据，参与顶核。
 */
export function findChallengingColophon(
  rubbing: Rubbing,
  colophons: Colophon[],
  collectors: Collector[],
): DatingChallenge | null {
  const floorYear = paperInkFloorYear(rubbing.dateGuess);
  if (floorYear === null) return null;
  const challenge = sortColophons(colophons.filter((item) => item.rubbingId === rubbing.id))
    .map((colophon) => ({ colophon, year: colophonYearValue(colophon) }))
    .filter((item): item is { colophon: Colophon; year: number } => item.year !== null && item.year < floorYear)[0];
  if (!challenge) return null;
  return {
    colophon: challenge.colophon,
    colophonYear: challenge.year,
    floorYear,
    collectorName: colophonCollectorName(challenge.colophon, collectors),
  };
}

/** 顶核说明文案：写明是哪条跋顶的 */
export function describeChallenge(challenge: DatingChallenge): string {
  const dateLabel = challenge.colophon.dateText.trim() || `${challenge.colophonYear} 年`;
  return `被${challenge.collectorName}「${dateLabel}」题跋顶核（跋系 ${challenge.colophonYear} 年，早于纸墨断代下限 ${challenge.floorYear} 年）`;
}

/** 拓本维度的断代顶核映射，便于列表 / 比对台共享 */
export function buildChallengeMap(
  rubbings: Rubbing[],
  colophons: Colophon[],
  collectors: Collector[],
): Map<string, DatingChallenge> {
  const map = new Map<string, DatingChallenge>();
  rubbings.forEach((rubbing) => {
    const challenge = findChallengingColophon(rubbing, colophons, collectors);
    if (challenge) map.set(rubbing.id, challenge);
  });
  return map;
}
