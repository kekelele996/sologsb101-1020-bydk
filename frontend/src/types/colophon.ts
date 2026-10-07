/**
 * 题跋（Colophon）数据模型
 * 拓本纸卡上历代藏家题跋一条：藏家、纪年、跋语，挂到拓本上按纪年先后排。
 * 认不出藏家时 collectorKey 置空（待认领），仅录题署与跋语；
 * 跋语一经编目员录入即不变，考订组后发名录只影响展示侧的藏家生卒年。
 */
import type { Collector } from './collector';

export interface Colophon {
  id: string;
  /** 所属拓本 id */
  rubbingId: string;
  /**
   * 认领的藏家归并键（Collector.collectorKey）；
   * null 表示认不出藏家，先挂待认领。
   */
  collectorKey: string | null;
  /** 题署照录：认不出藏家时的题款原文，认领后也保留以备核 */
  collectorText: string;
  /** 纪年原文，如「康熙十九年庚申秋日」「民国二十三年」 */
  dateText: string;
  /**
   * 纪年推定公元年（可由纪年原文换算）；
   * 换算不出为 null，仅展示不参与断代顶核。
   */
  dateYear: number | null;
  /** 跋语原文（编目员录文，名录修订不改此值） */
  text: string;
  createdAt: number;
  updatedAt: number;
}

export type ColophonDraft = Omit<Colophon, 'id' | 'createdAt' | 'updatedAt'>;

export function createEmptyColophonDraft(rubbingId: string): ColophonDraft {
  return {
    rubbingId,
    collectorKey: null,
    collectorText: '',
    dateText: '',
    dateYear: null,
    text: '',
  };
}

/** 名录现行条目（同 key 取 issuedAt 后发）；空名录返回 undefined */
export function pickCurrentCollector(collectors: Collector[], collectorKey: string | null): Collector | undefined {
  if (collectorKey === null) return undefined;
  return collectors
    .filter((collector) => collector.collectorKey === collectorKey)
    .sort((a, b) => b.issuedAt - a.issuedAt)[0];
}

/** 题跋展示名：已认领用考订组现行名录姓名，待认领录题署原文 */
export function colophonCollectorName(colophon: Colophon, collectors: Collector[]): string {
  const current = pickCurrentCollector(collectors, colophon.collectorKey);
  if (current) return current.name;
  return colophon.collectorText.trim() || '待认领藏家';
}
