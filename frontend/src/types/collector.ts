/**
 * 藏家名录（Collector）数据模型
 * 由考订组维护并下发：编目台只读，不能改；同一藏家（同名）以后发（issuedAt 更大）的
 * 生卒年为准。编目员照录的题跋原文不受名录更新影响。
 */

/** 名录条目来源：考订组（权威）/ 考订组已废止（被后发同名条目顶掉） */
export type CollectorSource = 'research' | 'deprecated';

export interface Collector {
  id: string;
  /** 藏家姓名（署名）；同名条目以 issuedAt 最大者为现行 */
  name: string;
  /** 字号 / 别名，供编目员辨认署名 */
  courtesyName: string;
  /** 生年（公元，可考才填） */
  birthYear: number | null;
  /** 卒年（公元，可考才填；在世为 null） */
  deathYear: number | null;
  /** 小传 / 备注 */
  note: string;
  /** 考订组发布批次，自增；同名下取最大者 */
  issueNo: number;
  /** 发布时间戳，后发以此为准 */
  issuedAt: number;
  /** 来源状态：现行 / 已被后发同名条目废止 */
  source: CollectorSource;
  createdAt: number;
  updatedAt: number;
}

export type CollectorDraft = Omit<Collector, 'id' | 'createdAt' | 'updatedAt'>;

export const COLLECTOR_SOURCE_LABEL: Record<CollectorSource, string> = {
  research: '考订组',
  deprecated: '已废止',
};

export const COLLECTOR_SOURCE_COLOR: Record<CollectorSource, string> = {
  research: '#2f6f4f',
  deprecated: '#8c8c8c',
};

export function createEmptyCollectorDraft(issueNo: number, issuedAt: number): CollectorDraft {
  return {
    name: '',
    courtesyName: '',
    birthYear: null,
    deathYear: null,
    note: '',
    issueNo,
    issuedAt,
    source: 'research',
  };
}

/** 生卒年展示文案，如「1861—1911」「1861—」「生卒待考」 */
export function lifespanText(collector: Pick<Collector, 'birthYear' | 'deathYear'>): string {
  const { birthYear, deathYear } = collector;
  if (birthYear === null && deathYear === null) return '生卒待考';
  return `${birthYear === null ? '?' : birthYear}—${deathYear === null ? '' : deathYear}`;
}
