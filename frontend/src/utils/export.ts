/**
 * 导出工具：整库 JSON 存档、编目卡文本、损泐台账 CSV
 * 全部在浏览器本地完成，不经过任何服务端。
 */
import type { Stele } from '@/types/stele';
import type { Rubbing } from '@/types/rubbing';
import type { Loss } from '@/types/loss';
import type { Seal } from '@/types/seal';
import type { Compare } from '@/types/compare';
import type { Collector } from '@/types/collector';
import type { Colophon } from '@/types/colophon';
import { STELE_FORM_LABEL } from '@/types/stele';
import { INK_TONE_LABEL, RUBBING_METHOD_LABEL, RUBBING_STATE_LABEL } from '@/types/rubbing';
import { LOSS_SEVERITY_LABEL, LOSS_TYPE_LABEL } from '@/types/loss';
import { SEAL_TYPE_LABEL, sealPositionWeight } from '@/types/seal';
import { COMPARE_CONCLUSION_LABEL } from '@/types/compare';
import { colophonCollectorName } from '@/types/colophon';
import { formatLifeSpan } from '@/types/collector';
import { describeChallenge, findChallengingColophon, sortColophons } from './dating';
import { diffLosses, encodeCoord, sortLosses } from './collate';
import type { RubbingSnapshot } from './db';

export function download(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function stampSuffix(): string {
  const date = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export function exportSnapshotJson(snapshot: RubbingSnapshot): string {
  const filename = `gbrubbing-backup-${stampSuffix()}.json`;
  download(filename, JSON.stringify(snapshot, null, 2), 'application/json;charset=utf-8');
  return filename;
}

function csvCell(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 编目卡：一块碑刻 + 其拓本 + 损泐 + 钤印 + 题跋 + 比对结论 */
export function buildCatalogCard(
  stele: Stele,
  rubbings: Rubbing[],
  losses: Loss[],
  seals: Seal[],
  compares: Compare[],
  colophons: Colophon[] = [],
  collectors: Collector[] = [],
): string {
  const lines: string[] = [];
  lines.push(`【碑帖编目卡】${stele.title}`);
  lines.push(`年代：${stele.era || '待考'}　形制：${STELE_FORM_LABEL[stele.form]}　尺寸：${stele.sizeCm || '未测'}`);
  lines.push(`所在地：${stele.location || '未记'}　书者：${stele.calligrapher || '佚名'}`);
  lines.push(`拓本数：${rubbings.length}　损泐字位：${losses.length} 条　钤印：${seals.length} 方　题跋：${colophons.length} 条`);
  lines.push('');

  [...rubbings]
    .sort((a, b) => a.versionNo - b.versionNo)
    .forEach((rubbing) => {
      const rubbingLosses = sortLosses(losses.filter((loss) => loss.rubbingId === rubbing.id));
      const rubbingSeals = seals
        .filter((seal) => seal.rubbingId === rubbing.id)
        .sort((a, b) => sealPositionWeight(a.position) - sealPositionWeight(b.position));
      const rubbingColophons = sortColophons(colophons.filter((colophon) => colophon.rubbingId === rubbing.id));
      const challenge = findChallengingColophon(rubbing, colophons, collectors);
      const datingCell = rubbing.dateGuess || '年代待考';
      lines.push(
        `第 ${rubbing.versionNo} 版　${RUBBING_METHOD_LABEL[rubbing.method]}　${INK_TONE_LABEL[rubbing.inkTone]}　${rubbing.paperType}　${rubbing.sizeCm || '尺寸未记'}　收藏号 ${rubbing.collectionNo || '未编'}　${
          challenge ? `纸墨断代 ${datingCell}【待核：${describeChallenge(challenge)}】` : datingCell
        }　${RUBBING_STATE_LABEL[rubbing.state]}`,
      );
      lines.push(`　损泐字位（${rubbingLosses.length} 条）：`);
      if (rubbingLosses.length === 0) lines.push('　　无');
      rubbingLosses.forEach((loss) => {
        lines.push(
          `　　${encodeCoord(loss.lineNo, loss.charNo)}　${LOSS_TYPE_LABEL[loss.type]}·${LOSS_SEVERITY_LABEL[loss.severity]}　${loss.note || ''}`,
        );
      });
      lines.push(`　钤印（${rubbingSeals.length} 方）：`);
      if (rubbingSeals.length === 0) lines.push('　　无');
      rubbingSeals.forEach((seal) => {
        lines.push(`　　${seal.position}　${seal.sealText}　${SEAL_TYPE_LABEL[seal.sealType]}　${seal.transcription || ''}`);
      });
      lines.push(`　题跋（${rubbingColophons.length} 条，按纪年先后）：`);
      if (rubbingColophons.length === 0) lines.push('　　无');
      rubbingColophons.forEach((colophon) => {
        const name = colophonCollectorName(colophon, collectors);
        const life = colophon.collectorKey ? `（${formatLifeSpanByName(collectors, colophon)}）` : '';
        const claim = colophon.collectorKey ? '' : '〔待认领〕';
        const yearSuffix = typeof colophon.dateYear === 'number' ? `〔约 ${colophon.dateYear} 年〕` : '';
        lines.push(`　　${name}${life}${claim}　${colophon.dateText || '纪年待考'}${yearSuffix}　${colophon.text}`);
      });
      lines.push('');
    });

  const steleCompares = compares.filter((compare) => compare.steleId === stele.id);
  lines.push(`版本比对记录（${steleCompares.length} 条）：`);
  if (steleCompares.length === 0) lines.push('　无');
  const rubbingById = new Map(rubbings.map((rubbing) => [rubbing.id, rubbing]));
  steleCompares.forEach((compare) => {
    const a = rubbingById.get(compare.rubbingIdA);
    const b = rubbingById.get(compare.rubbingIdB);
    // 比对任一方的纸墨断代被实物跋顶核，该比对结论一并转待核，写明顶核跋
    const challengeA = a ? findChallengingColophon(a, colophons, collectors) : null;
    const challengeB = b ? findChallengingColophon(b, colophons, collectors) : null;
    const challenge = challengeA ?? challengeB;
    lines.push(
      `　${compare.date}　A：第 ${a?.versionNo ?? '?'} 版　B：第 ${b?.versionNo ?? '?'} 版　差异 ${compare.diffCount} 字　结论 ${
        COMPARE_CONCLUSION_LABEL[compare.conclusion]
      }${challenge ? `【待核：${describeChallenge(challenge)}】` : ''}　操作人 ${compare.operator || '未填'}`,
    );
  });
  return lines.join('\n');
}

/** 编目卡用：现行名录生卒年展示（同藏家取考订组后发条目） */
function formatLifeSpanByName(collectors: Collector[], colophon: Colophon): string {
  const current = collectors
    .filter((collector) => collector.collectorKey === colophon.collectorKey)
    .sort((c1, c2) => c2.issuedAt - c1.issuedAt)[0];
  return current ? formatLifeSpan(current.birthYear, current.deathYear) : '生卒待考';
}

/** 导出编目卡为文本文件 */
export function exportCatalogCard(
  stele: Stele,
  rubbings: Rubbing[],
  losses: Loss[],
  seals: Seal[],
  compares: Compare[],
  colophons: Colophon[] = [],
  collectors: Collector[] = [],
): string {
  const filename = `${stele.title}-编目卡-${stampSuffix()}.txt`;
  download(
    filename,
    buildCatalogCard(stele, rubbings, losses, seals, compares, colophons, collectors),
    'text/plain;charset=utf-8',
  );
  return filename;
}

export interface ExportContext {
  steles: Stele[];
  rubbings: Rubbing[];
  losses: Loss[];
  seals: Seal[];
  compares: Compare[];
  colophons: Colophon[];
  collectors: Collector[];
}

/** 全部碑刻的编目卡合订文本 */
export function buildAllCatalogCards(context: ExportContext): string {
  if (context.steles.length === 0) return '当前没有碑刻档案。';
  return context.steles
    .map((stele) =>
      buildCatalogCard(
        stele,
        context.rubbings.filter((rubbing) => rubbing.steleId === stele.id),
        context.losses,
        context.seals,
        context.compares,
        context.colophons,
        context.collectors,
      ),
    )
    .join('\n\n————————————————\n\n');
}

/** 损泐台账 CSV（碑刻 / 拓本 / 字位 / 类型 / 程度） */
export function exportLossLedgerCsv(context: ExportContext): string {
  const header = ['碑名', '拓本版本', '拓法', '行号', '字位', '坐标', '损泐类型', '严重程度', '释文备注'];
  const lines: string[] = [header.map(csvCell).join(',')];
  context.steles.forEach((stele) => {
    const rubbings = context.rubbings
      .filter((rubbing) => rubbing.steleId === stele.id)
      .sort((a, b) => a.versionNo - b.versionNo);
    rubbings.forEach((rubbing) => {
      sortLosses(context.losses.filter((loss) => loss.rubbingId === rubbing.id)).forEach((loss) => {
        lines.push(
          [
            stele.title,
            `第 ${rubbing.versionNo} 版`,
            RUBBING_METHOD_LABEL[rubbing.method],
            loss.lineNo,
            loss.charNo,
            encodeCoord(loss.lineNo, loss.charNo),
            LOSS_TYPE_LABEL[loss.type],
            LOSS_SEVERITY_LABEL[loss.severity],
            loss.note,
          ]
            .map(csvCell)
            .join(','),
        );
      });
    });
  });
  const filename = `碑帖损泐台账-${stampSuffix()}.csv`;
  download(filename, `\uFEFF${lines.join('\n')}`, 'text/csv;charset=utf-8');
  return filename;
}

/** 差异清单文本（比对页复制用） */
export function buildDiffText(
  stele: Stele,
  rubbingA: Rubbing | undefined,
  rubbingB: Rubbing | undefined,
  lossesA: Loss[],
  lossesB: Loss[],
): string {
  const result = diffLosses(lossesA, lossesB);
  const lines: string[] = [
    `【版本差异清单】${stele.title}`,
    `A：第 ${rubbingA?.versionNo ?? '?'} 版（${rubbingA ? RUBBING_METHOD_LABEL[rubbingA.method] : '未知'}）　B：第 ${rubbingB?.versionNo ?? '?'} 版（${
      rubbingB ? RUBBING_METHOD_LABEL[rubbingB.method] : '未知'
    }）`,
    `差异合计 ${result.diffCount} 字：仅 A ${result.onlyACount} / 仅 B ${result.onlyBCount} / 程度不同 ${result.severityDiffCount}`,
    '',
  ];
  result.rows
    .filter((row) => row.diffKind !== 'same')
    .forEach((row) => {
      lines.push(
        `${encodeCoord(row.lineNo, row.charNo)}　A：${
          row.lossA ? `${LOSS_TYPE_LABEL[row.lossA.type]}·${LOSS_SEVERITY_LABEL[row.lossA.severity]}` : '无损泐'
        }　B：${
          row.lossB ? `${LOSS_TYPE_LABEL[row.lossB.type]}·${LOSS_SEVERITY_LABEL[row.lossB.severity]}` : '无损泐'
        }`,
      );
    });
  return lines.join('\n');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
