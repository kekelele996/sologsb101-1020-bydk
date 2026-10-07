/**
 * 题跋（Colophon）数据模型
 * 拓本纸卡上历代藏家题跋：一条记藏家、纪年、跋语，挂到拓本上按纪年先后排。
 * 跋语由编目员照录；藏家署名认不出时留空，先挂待认领，待考订组名录补发后再对上。
 */

/** 藏家认领状态：已对上考订组名录 / 待认领（名录未收或署名无考） */
export type ColophonClaim = 'claimed' | 'unclaimed';

export interface Colophon {
  id: string;
  /** 所属拓本 id */
  rubbingId: string;
  /** 题跋藏家署名；认不出为空，先挂待认领 */
  collectorName: string;
  /** 纪年原文，如「康熙五十年」「民国二十三年」「1890 年」 */
  eraText: string;
  /** 核定的公元纪年，用于按纪年排序与断代复核；无法考订为 null（不参与比对） */
  eraYear: number | null;
  /** 跋语：编目员照录原文，考订组更新藏家名录时不改此栏 */
  text: string;
  createdAt: number;
  updatedAt: number;
}

export type ColophonDraft = Omit<Colophon, 'id' | 'createdAt' | 'updatedAt'>;

export const COLOPHON_CLAIM_LABEL: Record<ColophonClaim, string> = {
  claimed: '已认领',
  unclaimed: '待认领',
};

export const COLOPHON_CLAIM_COLOR: Record<ColophonClaim, string> = {
  claimed: '#2f6f4f',
  unclaimed: '#c9963c',
};

export function createEmptyColophonDraft(rubbingId: string): ColophonDraft {
  return {
    rubbingId,
    collectorName: '',
    eraText: '',
    eraYear: null,
    text: '',
  };
}
