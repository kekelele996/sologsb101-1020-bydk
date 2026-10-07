/**
 * 藏家名录（Collector）数据模型
 * 由考订组维护并下发，编目台只读：题跋登记时据名录认领藏家。
 * 同一藏家（collectorKey 相同）以考订组后发（issuedAt 更大）的一条为准，
 * 历史版本保留留痕；编目员录入的跋语不受名录修订影响。
 */

export interface Collector {
  id: string;
  /** 藏家归并键：同名同人同键，多条版本按 issuedAt 取后发 */
  collectorKey: string;
  /** 藏家姓名（考订组考订名） */
  name: string;
  /** 生年（公元纪年，考订无定论可留 null） */
  birthYear: number | null;
  /** 卒年（公元纪年，考订无定论可留 null） */
  deathYear: number | null;
  /** 字号 / 斋馆名等备注，如「号匋斋」 */
  courtesyNote: string;
  /** 考订组下发时间（毫秒）；同 key 下该值最大的一条为现行名录 */
  issuedAt: number;
  /** 考订来源说明 */
  source: string;
  createdAt: number;
  updatedAt: number;
}

export type CollectorDraft = Omit<Collector, 'id' | 'createdAt' | 'updatedAt'>;

export function createEmptyCollectorDraft(collectorKey = ''): CollectorDraft {
  return {
    collectorKey,
    name: '',
    birthYear: null,
    deathYear: null,
    courtesyNote: '',
    issuedAt: Date.now(),
    source: '',
  };
}

/** 生卒年展示：1861–1911 / 1861– / ?–1911 / 生卒待考 */
export function formatLifeSpan(birthYear: number | null, deathYear: number | null): string {
  const birth = typeof birthYear === 'number' ? String(birthYear) : '?';
  const death = typeof deathYear === 'number' ? String(deathYear) : '?';
  if (birth === '?' && death === '?') return '生卒待考';
  return `${birth}–${death}`;
}
