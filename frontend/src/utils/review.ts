/**
 * 题跋断代复核派生逻辑
 * - 拓本纸墨断代（rubbing.dateGuess）被实物跋文顶翻时的待核标记
 * - 比对台结论涉及的拓本被顶翻时，该条结论同步转待核
 * - 考订组藏家名录现行版本解析（同名以后发 issuedAt 为准）
 * - 题跋认领状态（署名能对上现行名录才算已认领）
 *
 * 编目员照录的 dateGuess 与跋语一律不改，只写待核栏位。
 */
import type { Rubbing } from '@/types/rubbing';
import type { Compare } from '@/types/compare';
import type { Colophon } from '@/types/colophon';
import type { Collector } from '@/types/collector';
import { reviewDateGuess } from './dating';

/** 顶翻断代的跋：保留定位信息，供各台写明「是哪条跋顶的」 */
export interface ReviewMark {
  colophonId: string;
  collectorName: string;
  eraText: string;
  eraYear: number;
}

function toMark(colophon: Colophon): ReviewMark {
  return {
    colophonId: colophon.id,
    collectorName: colophon.collectorName.trim(),
    eraText: colophon.eraText.trim(),
    eraYear: colophon.eraYear as number,
  };
}

/** 某拓本上顶翻纸墨断代的最早跋；没有可顶的跋返回 null */
export function rubbingChallenger(rubbing: Pick<Rubbing, 'dateGuess'>, colophons: Colophon[]): ReviewMark | null {
  const result = reviewDateGuess({ dateGuess: rubbing.dateGuess, colophons });
  if (!result.review || !result.challenger) return null;
  const found = colophons.find((item) => item.id === result.challenger?.id);
  return found ? toMark(found) : null;
}

function reviewFields(mark: ReviewMark | null) {
  return {
    review: mark !== null,
    reviewColophonId: mark?.colophonId ?? null,
    reviewEraText: mark?.eraText ?? null,
    reviewCollectorName: mark?.collectorName || null,
  };
}

/** 拓本待核写库补丁（dateGuess 本身不动） */
export function rubbingReviewPatch(mark: ReviewMark | null): Partial<Rubbing> {
  return reviewFields(mark);
}

/** 比对记录待核写库补丁：A/B 任一侧被跋顶翻即转待核，两侧都有时取纪年更早的跋 */
export function compareReviewPatch(
  compare: Pick<Compare, 'rubbingIdA' | 'rubbingIdB'>,
  markByRubbing: ReadonlyMap<string, ReviewMark | null>,
): Partial<Compare> {
  const markA = markByRubbing.get(compare.rubbingIdA) ?? null;
  const markB = markByRubbing.get(compare.rubbingIdB) ?? null;
  const mark = [markA, markB]
    .filter((item): item is ReviewMark => item !== null)
    .sort((a, b) => a.eraYear - b.eraYear)[0];
  return reviewFields(mark ?? null);
}

/* ------------------------------ 藏家名录 ------------------------------ */

/** 现行名录：同名藏家取考订组后发（issuedAt 最大）的一条；已废止条目不参与 */
export function activeCollectorMap(collectors: Collector[]): Map<string, Collector> {
  const map = new Map<string, Collector>();
  collectors
    .filter((collector) => collector.source === 'research')
    .forEach((collector) => {
      const current = map.get(collector.name);
      if (!current || collector.issuedAt > current.issuedAt) map.set(collector.name, collector);
    });
  return map;
}

/** 按署名解析现行名录条目；空署名或名录未收返回 null（题跋挂待认领） */
export function resolveCollector(
  collectorName: string,
  collectors: Collector[],
): Collector | null {
  const name = collectorName.trim();
  if (name.length === 0) return null;
  return activeCollectorMap(collectors).get(name) ?? null;
}

/** 题跋是否已认领：署名非空且对得上现行名录 */
export function isColophonClaimed(colophon: Pick<Colophon, 'collectorName'>, collectors: Collector[]): boolean {
  return resolveCollector(colophon.collectorName, collectors) !== null;
}

/** 全库待认领题跋统计用过滤条件 */
export function isUnclaimedColophon(
  colophon: Pick<Colophon, 'collectorName'>,
  collectors: Collector[],
): boolean {
  return !isColophonClaimed(colophon, collectors);
}
