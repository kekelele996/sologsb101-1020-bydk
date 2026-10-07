/**
 * IndexedDB 持久化层（Dexie 封装）
 * - 数据结构版本号与升级迁移逻辑
 *   v1 → v2：Loss 增加 charNo 与复合索引，并按行号顺序重建历史字位记录
 *   v2 → v3：新增 colophons（题跋）与 collectors（考订组藏家名录）两表；
 *            旧数据升级后两表为空，按「无跋」显示，原断代一律不转待核
 * - 七张业务表的增删改查与整库导入导出
 * - 首次打开自动播种三层互相引用的演示数据（幂等）
 * 纯前端应用：不依赖任何后端服务或数据库。
 */
import Dexie, { type Table } from 'dexie';
import type { Stele } from '@/types/stele';
import type { Rubbing } from '@/types/rubbing';
import type { Loss } from '@/types/loss';
import type { Seal } from '@/types/seal';
import type { Compare } from '@/types/compare';
import type { Colophon } from '@/types/colophon';
import type { Collector, CollectorDraft } from '@/types/collector';
import { sortLosses } from './collate';
import { rubbingChallenger, compareReviewPatch } from './review';

/** 数据库名（README 与导出文件均使用该名称） */
export const DB_NAME = 'gbrubbing';

/** 当前数据结构版本号 */
export const DB_SCHEMA_VERSION = 3;

/** localStorage 侧少量元数据键 */
export const LS_KEYS = {
  dbVersion: 'gbrubbing:db-version',
  lastBackupAt: 'gbrubbing:last-backup-at',
  uiPrefs: 'gbrubbing:ui-prefs',
} as const;

export interface UiPrefs {
  lastSteleId: string | null;
  lastRubbingId: string | null;
}

export const DEFAULT_UI_PREFS: UiPrefs = { lastSteleId: null, lastRubbingId: null };

export function readUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(LS_KEYS.uiPrefs);
    if (!raw) return { ...DEFAULT_UI_PREFS };
    const parsed = JSON.parse(raw) as Partial<UiPrefs>;
    return {
      lastSteleId: typeof parsed.lastSteleId === 'string' ? parsed.lastSteleId : null,
      lastRubbingId: typeof parsed.lastRubbingId === 'string' ? parsed.lastRubbingId : null,
    };
  } catch {
    return { ...DEFAULT_UI_PREFS };
  }
}

export function writeUiPrefs(prefs: UiPrefs): void {
  try {
    localStorage.setItem(LS_KEYS.uiPrefs, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export function stampDbVersion(): void {
  try {
    localStorage.setItem(LS_KEYS.dbVersion, String(DB_SCHEMA_VERSION));
  } catch {
    /* ignore */
  }
}

export function readLastBackupAt(): string | null {
  try {
    return localStorage.getItem(LS_KEYS.lastBackupAt);
  } catch {
    return null;
  }
}

export function writeLastBackupAt(value: string): void {
  try {
    localStorage.setItem(LS_KEYS.lastBackupAt, value);
  } catch {
    /* ignore */
  }
}

class RubbingDatabase extends Dexie {
  steles!: Table<Stele, string>;
  rubbings!: Table<Rubbing, string>;
  losses!: Table<Loss, string>;
  seals!: Table<Seal, string>;
  compares!: Table<Compare, string>;
  colophons!: Table<Colophon, string>;
  collectors!: Table<Collector, string>;

  constructor() {
    super(DB_NAME);

    // v1：初版结构（历史字位记录仅有 lineNo）
    this.version(1).stores({
      steles: 'id, title, era, form, updatedAt',
      rubbings: 'id, steleId, versionNo, method, state, updatedAt',
      losses: 'id, rubbingId, lineNo, type, severity, updatedAt',
      seals: 'id, rubbingId, sealType, updatedAt',
      compares: 'id, steleId, rubbingIdA, rubbingIdB, conclusion, updatedAt',
    });

    // v2：Loss 增加 charNo 与 [rubbingId+lineNo+charNo] 复合索引，并按行号顺序重建历史字位记录
    this.version(2)
      .stores({
        steles: 'id, title, era, form, location, updatedAt',
        rubbings: 'id, steleId, versionNo, method, inkTone, state, updatedAt',
        losses: 'id, rubbingId, lineNo, charNo, [rubbingId+lineNo+charNo], type, severity, updatedAt',
        seals: 'id, rubbingId, sealType, position, updatedAt',
        compares: 'id, steleId, rubbingIdA, rubbingIdB, conclusion, date, updatedAt',
      })
      .upgrade(async (tx) => {
        const table = tx.table<Loss>('losses');
        const all = await table.toArray();
        const byRubbing = new Map<string, Loss[]>();
        all.forEach((loss) => {
          byRubbing.set(loss.rubbingId, [...(byRubbing.get(loss.rubbingId) ?? []), loss]);
        });
        const rebuilt: Loss[] = [];
        byRubbing.forEach((list) => {
          // 按行号排序后，为缺失 charNo 的历史记录在行内顺序补位
          const sorted = [...list].sort((a, b) => a.lineNo - b.lineNo);
          const counter = new Map<number, number>();
          sorted.forEach((loss) => {
            const used = counter.get(loss.lineNo) ?? 0;
            const charNo = typeof loss.charNo === 'number' && loss.charNo > 0 ? loss.charNo : used + 1;
            counter.set(loss.lineNo, Math.max(used, charNo));
            rebuilt.push({ ...loss, charNo, updatedAt: Date.now() });
          });
        });
        await table.bulkPut(sortLosses(rebuilt));
      });

    // v3：接入题跋与考订组藏家名录；旧拓本无待核栏位（undefined 即按无跋、非待核显示）
    this.version(DB_SCHEMA_VERSION)
      .stores({
        steles: 'id, title, era, form, location, updatedAt',
        rubbings: 'id, steleId, versionNo, method, inkTone, state, updatedAt',
        losses: 'id, rubbingId, lineNo, charNo, [rubbingId+lineNo+charNo], type, severity, updatedAt',
        seals: 'id, rubbingId, sealType, position, updatedAt',
        compares: 'id, steleId, rubbingIdA, rubbingIdB, conclusion, date, updatedAt',
        colophons: 'id, rubbingId, eraYear, updatedAt',
        collectors: 'id, name, issueNo, issuedAt, source, updatedAt',
      })
      .upgrade(async () => {
        // 旧数据升级后 colophons / collectors 两表为空：全部拓本按无跋显示，
        // 既有纸墨断代与比对结论原样保留、不转待核（待核栏位缺省即非待核）。
      });
  }
}

export const db = new RubbingDatabase();

/** 生成主键：短前缀 + 时间戳 + 随机串 */
export function createId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

/** 打开数据库并在首次使用时播种演示数据（幂等） */
export async function initDatabase(): Promise<void> {
  await db.open();
  stampDbVersion();
  if ((await db.steles.count()) === 0) {
    await seedDatabase();
  }
}

/* ------------------------------ 播种数据 ------------------------------ */
/* 三层互相引用：Stele → Rubbing →（Loss / Seal）＋ Stele → Compare */

export async function seedDatabase(): Promise<void> {
  const now = Date.now();
  const day = 86400000;

  const steles: Stele[] = [
    {
      id: 'stele_01',
      title: '礼器碑',
      era: '东汉永寿二年',
      location: '山东曲阜孔庙',
      form: 'stele',
      sizeCm: '227×93',
      calligrapher: '佚名（隶书）',
      createdAt: now - day * 60,
      updatedAt: now - day * 3,
    },
    {
      id: 'stele_02',
      title: '石门颂',
      era: '东汉建和二年',
      location: '陕西汉中石门',
      form: 'cliff',
      sizeCm: '261×205',
      calligrapher: '王升（隶书）',
      createdAt: now - day * 48,
      updatedAt: now - day * 2,
    },
    {
      id: 'stele_03',
      title: '颜勤礼碑',
      era: '唐大历十四年',
      location: '陕西西安碑林',
      form: 'stele',
      sizeCm: '268×92',
      calligrapher: '颜真卿（楷书）',
      createdAt: now - day * 36,
      updatedAt: now - day,
    },
  ];

  const rubbings: Rubbing[] = [
    { id: 'rub_0101', steleId: 'stele_01', versionNo: 1, method: 'rub', paperType: '宣纸', inkTone: 'thick', sizeCm: '210×88', collectionNo: 'TB-0101', dateGuess: '明拓', state: 'cataloged', createdAt: now - day * 50, updatedAt: now - day * 10 },
    { id: 'rub_0102', steleId: 'stele_01', versionNo: 2, method: 'cicada', paperType: '棉连纸', inkTone: 'light', sizeCm: '208×86', collectionNo: 'TB-0102', dateGuess: '清拓', state: 'toCompare', createdAt: now - day * 44, updatedAt: now - day * 6 },
    { id: 'rub_0201', steleId: 'stele_02', versionNo: 1, method: 'pat', paperType: '皮纸', inkTone: 'thick', sizeCm: '250×196', collectionNo: 'TB-0201', dateGuess: '清中期拓', state: 'cataloged', createdAt: now - day * 40, updatedAt: now - day * 5 },
    { id: 'rub_0202', steleId: 'stele_02', versionNo: 2, method: 'rub', paperType: '棉连纸', inkTone: 'light', sizeCm: '248×194', collectionNo: 'TB-0202', dateGuess: '清晚期拓', state: 'toCatalog', createdAt: now - day * 34, updatedAt: now - day * 4 },
    { id: 'rub_0301', steleId: 'stele_03', versionNo: 1, method: 'rub', paperType: '净皮宣', inkTone: 'thick', sizeCm: '260×90', collectionNo: 'TB-0301', dateGuess: '民国拓', state: 'toCatalog', createdAt: now - day * 20, updatedAt: now - day * 2 },
  ];

  const losses: Loss[] = [
    { id: 'loss_010101', rubbingId: 'rub_0101', lineNo: 3, charNo: 7, type: 'blur', severity: 'light', note: '「壽」字右下漫漶', createdAt: now - day * 30, updatedAt: now - day * 30 },
    { id: 'loss_010102', rubbingId: 'rub_0101', lineNo: 5, charNo: 2, type: 'stoneFlower', severity: 'medium', note: '石花漫及「年」字', createdAt: now - day * 30, updatedAt: now - day * 29 },
    { id: 'loss_010103', rubbingId: 'rub_0101', lineNo: 9, charNo: 11, type: 'missing', severity: 'heavy', note: '「禮」字缺末笔', createdAt: now - day * 28, updatedAt: now - day * 28 },
    { id: 'loss_010201', rubbingId: 'rub_0102', lineNo: 3, charNo: 7, type: 'blur', severity: 'medium', note: '晚拓，「壽」字已损', createdAt: now - day * 24, updatedAt: now - day * 24 },
    { id: 'loss_010202', rubbingId: 'rub_0102', lineNo: 9, charNo: 11, type: 'missing', severity: 'heavy', note: '「禮」字全缺', createdAt: now - day * 24, updatedAt: now - day * 22 },
    { id: 'loss_010203', rubbingId: 'rub_0102', lineNo: 12, charNo: 4, type: 'crack', severity: 'medium', note: '碑面斜裂一道', createdAt: now - day * 22, updatedAt: now - day * 22 },
    { id: 'loss_020101', rubbingId: 'rub_0201', lineNo: 2, charNo: 5, type: 'crack', severity: 'light', note: '崖面细裂', createdAt: now - day * 18, updatedAt: now - day * 18 },
    { id: 'loss_020201', rubbingId: 'rub_0202', lineNo: 2, charNo: 5, type: 'crack', severity: 'light', note: '崖面细裂（同前）', createdAt: now - day * 20, updatedAt: now - day * 20 },
    { id: 'loss_020202', rubbingId: 'rub_0202', lineNo: 6, charNo: 3, type: 'blur', severity: 'medium', note: '晚拓，「頌」字已漫漶', createdAt: now - day * 18, updatedAt: now - day * 18 },
    { id: 'loss_030101', rubbingId: 'rub_0301', lineNo: 4, charNo: 3, type: 'blur', severity: 'heavy', note: '民国拓，字口已平', createdAt: now - day * 10, updatedAt: now - day * 10 },
  ];

  const seals: Seal[] = [
    { id: 'seal_0101', rubbingId: 'rub_0101', sealText: '端方藏碑', position: '右下角', transcription: '端方（匋斋）收藏印', sealType: 'collection', createdAt: now - day * 40, updatedAt: now - day * 40 },
    { id: 'seal_0102', rubbingId: 'rub_0101', sealText: '匋斋鉴赏', position: '左下角', transcription: '端方鉴赏印', sealType: 'appraisal', createdAt: now - day * 40, updatedAt: now - day * 40 },
    { id: 'seal_0103', rubbingId: 'rub_0102', sealText: '艺风堂', position: '卷尾', transcription: '缪荃孙艺风堂藏书印', sealType: 'collection', createdAt: now - day * 30, updatedAt: now - day * 30 },
    { id: 'seal_0201', rubbingId: 'rub_0201', sealText: '石门旧拓', position: '左上角', transcription: '藏家自钤印', sealType: 'author', createdAt: now - day * 26, updatedAt: now - day * 26 },
  ];

  // 考订组藏家名录：端方有两版同名片，后发（issueNo 2）生卒年为准，旧版标已废止
  const collectors: Collector[] = [
    { id: 'col_duanfang_1', name: '端方', courtesyName: '匋斋', birthYear: 1860, deathYear: 1910, note: '旧版生卒，已被后发条目更正', issueNo: 1, issuedAt: now - day * 20, source: 'deprecated', createdAt: now - day * 20, updatedAt: now - day * 2 },
    { id: 'col_duanfang_2', name: '端方', courtesyName: '匋斋', birthYear: 1861, deathYear: 1911, note: '清末大臣，富藏金石碑版', issueNo: 2, issuedAt: now - day * 2, source: 'research', createdAt: now - day * 2, updatedAt: now - day * 2 },
    { id: 'col_miao', name: '缪荃孙', courtesyName: '艺风', birthYear: 1844, deathYear: 1919, note: '艺风堂主人，藏书家、金石学家', issueNo: 1, issuedAt: now - day * 20, source: 'research', createdAt: now - day * 20, updatedAt: now - day * 20 },
    { id: 'col_wangdong', name: '王冬记', courtesyName: '雪窗', birthYear: 1558, deathYear: 1620, note: '明万历间藏家，室名雪窗', issueNo: 1, issuedAt: now - day * 15, source: 'research', createdAt: now - day * 15, updatedAt: now - day * 15 },
    { id: 'col_weng', name: '翁方纲', courtesyName: '覃溪', birthYear: 1733, deathYear: 1818, note: '清乾嘉间金石学家', issueNo: 1, issuedAt: now - day * 15, source: 'research', createdAt: now - day * 15, updatedAt: now - day * 15 },
    { id: 'col_liang', name: '梁鼎芬', courtesyName: '节庵', birthYear: 1859, deathYear: 1919, note: '晚清学者、藏书家', issueNo: 1, issuedAt: now - day * 15, source: 'research', createdAt: now - day * 15, updatedAt: now - day * 15 },
  ];

  // 题跋：按纪年先后展示；万历二十三年（1595）跋早于 rub_0102 纸墨断代「清拓」（1644）→ 顶翻
  const colophons: Colophon[] = [
    { id: 'colo_0101_1', rubbingId: 'rub_0101', collectorName: '翁方纲', eraText: '乾隆六十年乙卯秋', eraYear: 1795, text: '礼器碑韩敕造，隶法瘦劲如铁，此本毡蜡不苟，覃溪审定。', createdAt: now - day * 32, updatedAt: now - day * 32 },
    { id: 'colo_0101_2', rubbingId: 'rub_0101', collectorName: '端方', eraText: '光绪三十一年乙巳', eraYear: 1905, text: '匋斋藏本，与关中初拓对勘，「壽」字尚存右下波磔。', createdAt: now - day * 12, updatedAt: now - day * 12 },
    { id: 'colo_0102_1', rubbingId: 'rub_0102', collectorName: '王冬记', eraText: '万历二十三年乙未冬', eraYear: 1595, text: '礼器碑阴拓精妙绝伦，余得于燕市，什袭藏之，雪窗王冬记。', createdAt: now - day * 28, updatedAt: now - day * 28 },
    { id: 'colo_0102_2', rubbingId: 'rub_0102', collectorName: '端方', eraText: '光绪三十年甲辰', eraYear: 1904, text: '此本纸墨虽旧，万历间已有王雪窗藏跋，清拓之说恐误，匋斋记。', createdAt: now - day * 13, updatedAt: now - day * 13 },
    { id: 'colo_0201_1', rubbingId: 'rub_0201', collectorName: '梁鼎芬', eraText: '宣统二年庚戌', eraYear: 1910, text: '石门颂摩崖拓本，崖痕细裂处与近拓正同，节庵借观题记。', createdAt: now - day * 11, updatedAt: now - day * 11 },
    { id: 'colo_0301_1', rubbingId: 'rub_0301', collectorName: '', eraText: '壬戌孟春', eraYear: null, text: '墨缘斋偶得，拓亦不恶，姑存之。（署名漶灭，待考）', createdAt: now - day * 9, updatedAt: now - day * 9 },
    { id: 'colo_0301_2', rubbingId: 'rub_0301', collectorName: '墨缘居士', eraText: '民国二十五年丙子', eraYear: 1936, text: '颜勤礼碑近拓也，取备一家。墨缘居士书于沪上。', createdAt: now - day * 8, updatedAt: now - day * 8 },
  ];

  // 据题跋统一复核：纸墨断代照原样保留，只补待核栏位
  const markByRubbing = new Map<string, ReturnType<typeof rubbingChallenger>>();
  const seededRubbings = rubbings.map((rubbing) => {
    const mark = rubbingChallenger(
      rubbing,
      colophons.filter((colophon) => colophon.rubbingId === rubbing.id),
    );
    markByRubbing.set(rubbing.id, mark);
    return { ...rubbing, ...(mark ? rubbingReviewFields(mark) : {}) };
  });

  const compares: Compare[] = [
    {
      id: 'cmp_0101', steleId: 'stele_01', rubbingIdA: 'rub_0101', rubbingIdB: 'rub_0102', diffCount: 3,
      conclusion: 'early', operator: '傅砚', date: '2026-03-06',
      ...compareReviewPatch({ rubbingIdA: 'rub_0101', rubbingIdB: 'rub_0102' }, markByRubbing),
      createdAt: now - day * 5, updatedAt: now - day * 5,
    },
    {
      id: 'cmp_0201', steleId: 'stele_02', rubbingIdA: 'rub_0201', rubbingIdB: 'rub_0202', diffCount: 1,
      conclusion: 'late', operator: '傅砚', date: '2026-03-08',
      ...compareReviewPatch({ rubbingIdA: 'rub_0201', rubbingIdB: 'rub_0202' }, markByRubbing),
      createdAt: now - day * 3, updatedAt: now - day * 3,
    },
  ];

  await db.transaction('rw', [db.steles, db.rubbings, db.losses, db.seals, db.compares, db.colophons, db.collectors], async () => {
    await db.steles.bulkPut(steles);
    await db.rubbings.bulkPut(seededRubbings);
    await db.losses.bulkPut(losses);
    await db.seals.bulkPut(seals);
    await db.compares.bulkPut(compares);
    await db.colophons.bulkPut(colophons);
    await db.collectors.bulkPut(collectors);
  });
}

/** 待核栏位补丁（播种复用） */
function rubbingReviewFields(mark: NonNullable<ReturnType<typeof rubbingChallenger>>): Partial<Rubbing> {
  return {
    dateGuessReview: true,
    reviewColophonId: mark.colophonId,
    reviewEraText: mark.eraText,
    reviewCollectorName: mark.collectorName,
  };
}

/* ------------------------------ 整库导入导出 ------------------------------ */

export interface RubbingSnapshot {
  app: typeof DB_NAME;
  schemaVersion: number;
  exportedAt: string;
  steles: Stele[];
  rubbings: Rubbing[];
  losses: Loss[];
  seals: Seal[];
  compares: Compare[];
  colophons: Colophon[];
  collectors: Collector[];
}

export async function exportSnapshot(): Promise<RubbingSnapshot> {
  const [steles, rubbings, losses, seals, compares, colophons, collectors] = await Promise.all([
    db.steles.toArray(),
    db.rubbings.toArray(),
    db.losses.toArray(),
    db.seals.toArray(),
    db.compares.toArray(),
    db.colophons.toArray(),
    db.collectors.toArray(),
  ]);
  return {
    app: DB_NAME,
    schemaVersion: DB_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    steles,
    rubbings,
    losses,
    seals,
    compares,
    colophons,
    collectors,
  };
}

/** 校验导入文件结构，返回错误文案（空串表示通过）。旧备份缺题跋两表时补空集，按无跋导入 */
export function validateSnapshot(input: unknown): string {
  if (typeof input !== 'object' || input === null) return '文件内容不是合法的 JSON 对象';
  const snapshot = input as Partial<RubbingSnapshot>;
  if (snapshot.app !== DB_NAME) return `备份文件不属于本项目（app=${String(snapshot.app)}）`;
  const keys: Array<keyof RubbingSnapshot> = ['steles', 'rubbings', 'losses', 'seals', 'compares'];
  for (const key of keys) {
    if (!Array.isArray(snapshot[key])) return `备份文件缺少 ${String(key)} 集合`;
  }
  return '';
}

/** 归一化旧版备份：题跋 / 名录两表缺失时按空集处理（升级后按无跋显示） */
export function normalizeSnapshot(input: RubbingSnapshot): RubbingSnapshot {
  return {
    ...input,
    colophons: Array.isArray(input.colophons) ? input.colophons : [],
    collectors: Array.isArray(input.collectors) ? input.collectors : [],
  };
}

export async function clearAllTables(): Promise<void> {
  await db.transaction(
    'rw',
    [db.steles, db.rubbings, db.losses, db.seals, db.compares, db.colophons, db.collectors],
    async () => {
      await Promise.all([
        db.steles.clear(),
        db.rubbings.clear(),
        db.losses.clear(),
        db.seals.clear(),
        db.compares.clear(),
        db.colophons.clear(),
        db.collectors.clear(),
      ]);
    },
  );
}

export async function importSnapshot(raw: RubbingSnapshot): Promise<void> {
  const snapshot = normalizeSnapshot(raw);
  await clearAllTables();
  await db.transaction(
    'rw',
    [db.steles, db.rubbings, db.losses, db.seals, db.compares, db.colophons, db.collectors],
    async () => {
      await db.steles.bulkPut(snapshot.steles);
      await db.rubbings.bulkPut(snapshot.rubbings);
      await db.losses.bulkPut(snapshot.losses);
      await db.seals.bulkPut(snapshot.seals);
      await db.compares.bulkPut(snapshot.compares);
      await db.colophons.bulkPut(snapshot.colophons);
      await db.collectors.bulkPut(snapshot.collectors);
    },
  );
}

export async function resetDatabase(): Promise<void> {
  await clearAllTables();
  await seedDatabase();
}

export async function countAll(): Promise<Record<string, number>> {
  const [steles, rubbings, losses, seals, compares, colophons, collectors] = await Promise.all([
    db.steles.count(),
    db.rubbings.count(),
    db.losses.count(),
    db.seals.count(),
    db.compares.count(),
    db.colophons.count(),
    db.collectors.count(),
  ]);
  return { steles, rubbings, losses, seals, compares, colophons, collectors };
}

/** 级联删除碑刻 → 拓本 → 损泐 / 钤印 / 题跋 / 比对 */
export async function removeSteleCascade(steleId: string): Promise<void> {
  const rubbingIds = (await db.rubbings.where('steleId').equals(steleId).toArray()).map((row) => row.id);
  await db.transaction(
    'rw',
    [db.steles, db.rubbings, db.losses, db.seals, db.compares, db.colophons],
    async () => {
      if (rubbingIds.length > 0) {
        await db.losses.where('rubbingId').anyOf(rubbingIds).delete();
        await db.seals.where('rubbingId').anyOf(rubbingIds).delete();
        await db.colophons.where('rubbingId').anyOf(rubbingIds).delete();
      }
      await db.rubbings.where('steleId').equals(steleId).delete();
      await db.compares.where('steleId').equals(steleId).delete();
      await db.steles.delete(steleId);
    },
  );
}

/** 级联删除拓本 → 损泐 / 钤印 / 题跋 / 涉及的比对记录 */
export async function removeRubbingCascade(rubbingId: string): Promise<void> {
  await db.transaction('rw', [db.rubbings, db.losses, db.seals, db.compares, db.colophons], async () => {
    await db.losses.where('rubbingId').equals(rubbingId).delete();
    await db.seals.where('rubbingId').equals(rubbingId).delete();
    await db.colophons.where('rubbingId').equals(rubbingId).delete();
    const compares = await db.compares.toArray();
    const affected = compares.filter((row) => row.rubbingIdA === rubbingId || row.rubbingIdB === rubbingId);
    if (affected.length > 0) await db.compares.bulkDelete(affected.map((row) => row.id));
    await db.rubbings.delete(rubbingId);
  });
}

/** 重排某碑刻下拓本的版本序号，保证连续 */
export async function renumberRubbings(steleId: string): Promise<void> {
  const rows = await db.rubbings.where('steleId').equals(steleId).toArray();
  const sorted = [...rows].sort((a, b) => (a.versionNo === b.versionNo ? a.createdAt - b.createdAt : a.versionNo - b.versionNo));
  await db.rubbings.bulkPut(sorted.map((row, index) => ({ ...row, versionNo: index + 1, updatedAt: Date.now() })));
}

/* --------------------- 题跋断代复核重算（本侧写库） --------------------- */

/**
 * 题跋或纸墨断代变化后重算待核栏位：
 * 重写涉及拓本的 dateGuessReview* 栏位，并把引用这些拓本的比对记录一并重算。
 * 编目员的 dateGuess、比对结论 conclusion 与跋语均不改。
 */
export async function recomputeReviews(affectedRubbingIds: string[]): Promise<void> {
  const ids = new Set(affectedRubbingIds);
  if (ids.size === 0) return;
  const [allRubbings, allColophons, allCompares] = await Promise.all([
    db.rubbings.toArray(),
    db.colophons.toArray(),
    db.compares.toArray(),
  ]);
  const markByRubbing = new Map<string, ReturnType<typeof rubbingChallenger>>();
  const rubbingRows: Rubbing[] = [];
  allRubbings.forEach((rubbing) => {
    const mark = rubbingChallenger(
      rubbing,
      allColophons.filter((colophon) => colophon.rubbingId === rubbing.id),
    );
    markByRubbing.set(rubbing.id, mark);
    if (ids.has(rubbing.id)) {
      rubbingRows.push({ ...rubbing, ...rubbingPatchForMark(mark), updatedAt: Date.now() });
    }
  });
  const compareRows: Compare[] = allCompares
    .filter((compare) => ids.has(compare.rubbingIdA) || ids.has(compare.rubbingIdB))
    .map((compare) => ({ ...compare, ...compareReviewPatch(compare, markByRubbing), updatedAt: Date.now() }));
  await localBulkPutWithRetry(db.rubbings, rubbingRows);
  await localBulkPutWithRetry(db.compares, compareRows);
}

function rubbingPatchForMark(mark: ReturnType<typeof rubbingChallenger>): Partial<Rubbing> {
  return {
    dateGuessReview: mark !== null,
    reviewColophonId: mark?.colophonId ?? null,
    reviewEraText: mark?.eraText ?? null,
    reviewCollectorName: mark?.collectorName || null,
  };
}

/**
 * 本侧批量写库：写失败后只重试本侧这一批（IndexedDB 本地事务，不涉及任何对端），
 * 仍失败则抛出最后一次错误，由调用侧提示；不重放整库、不触考订组重发。
 */
export async function localBulkPutWithRetry<T>(
  table: Table<T, string>,
  rows: T[],
  retries = 2,
): Promise<void> {
  if (rows.length === 0) return;
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await table.bulkPut(rows);
      return;
    } catch (error) {
      lastError = error;
      // 仅短暂退避后重试本批
      await new Promise((resolve) => setTimeout(resolve, 60 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('本地写库失败');
}

/**
 * 接收考订组下发的一批藏家名录（编目台只读名录，不能手工改）：
 * 同批同名只保留最后一条；旧版同名片一律标已废止，新条目以后发 issueNo / issuedAt 为准。
 * 整批一次事务落库，失败只重试本侧这批，不要求考订组重发。
 */
export async function ingestCollectorBatch(drafts: CollectorDraft[]): Promise<number> {
  if (drafts.length === 0) return 0;
  const run = async (): Promise<number> =>
    db.transaction('rw', db.collectors, async () => {
      // 同批同名以后一条为准
      const byName = new Map<string, CollectorDraft>();
      drafts.forEach((draft) => byName.set(draft.name.trim(), draft));
      const names = Array.from(byName.keys());
      const existing = await db.collectors.where('name').anyOf(names).toArray();
      const now = Date.now();
      const deprecated: Collector[] = existing
        .filter((row) => row.source === 'research')
        .map((row) => ({ ...row, source: 'deprecated', updatedAt: now }));
      const incoming: Collector[] = Array.from(byName.values()).map((draft) => {
        const now2 = Date.now();
        return {
          ...draft,
          name: draft.name.trim(),
          id: createId('col'),
          source: 'research' as const,
          createdAt: now2,
          updatedAt: now2,
        };
      });
      await db.collectors.bulkPut(deprecated);
      await db.collectors.bulkPut(incoming);
      return incoming.length;
    });

  let lastError: unknown = null;
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 60 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('藏家名录接收失败');
}

/** 下一考订组发布批次号（现行条目最大 issueNo + 1） */
export async function nextCollectorIssueNo(): Promise<number> {
  const rows = await db.collectors.toArray();
  return rows.reduce((max, row) => Math.max(max, row.issueNo), 0) + 1;
}
