/**
 * IndexedDB 持久化层（Dexie 封装）
 * - 数据结构版本号与升级迁移逻辑（v1 → v2：Loss 增加 charNo 与复合索引；v2 → v3：新增题跋与考订组藏家名录）
 * - 七张业务表的增删改查与整库导入导出
 * - 首次打开自动播种四层互相引用的演示数据（幂等）
 * 纯前端应用：不依赖任何后端服务或数据库。
 */
import Dexie, { type Table } from 'dexie';
import type { Stele } from '@/types/stele';
import type { Rubbing } from '@/types/rubbing';
import type { Loss } from '@/types/loss';
import type { Seal } from '@/types/seal';
import type { Compare } from '@/types/compare';
import type { Collector } from '@/types/collector';
import type { Colophon } from '@/types/colophon';
import { sortLosses } from './collate';
import { writeLocalBatch } from './localWrite';

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
  /** 历代藏家题跋，挂在拓本上 */
  colophons!: Table<Colophon, string>;
  /** 考订组维护下发的藏家名录（编目台只读） */
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

    // v3：新增题跋表与考订组藏家名录表。
    // 旧库升级时两表为空即「按无跋显示」，不做任何历史回填；名录也等考订组重新下发。
    this.version(DB_SCHEMA_VERSION).stores({
      steles: 'id, title, era, form, location, updatedAt',
      rubbings: 'id, steleId, versionNo, method, inkTone, state, updatedAt',
      losses: 'id, rubbingId, lineNo, charNo, [rubbingId+lineNo+charNo], type, severity, updatedAt',
      seals: 'id, rubbingId, sealType, position, updatedAt',
      compares: 'id, steleId, rubbingIdA, rubbingIdB, conclusion, date, updatedAt',
      colophons: 'id, rubbingId, collectorKey, updatedAt',
      collectors: 'id, collectorKey, name, issuedAt, updatedAt',
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

  const compares: Compare[] = [
    { id: 'cmp_0101', steleId: 'stele_01', rubbingIdA: 'rub_0101', rubbingIdB: 'rub_0102', diffCount: 3, conclusion: 'early', operator: '傅砚', date: '2026-03-06', createdAt: now - day * 5, updatedAt: now - day * 5 },
    { id: 'cmp_0201', steleId: 'stele_02', rubbingIdA: 'rub_0201', rubbingIdB: 'rub_0202', diffCount: 1, conclusion: 'late', operator: '傅砚', date: '2026-03-08', createdAt: now - day * 3, updatedAt: now - day * 3 },
  ];

  // 考订组藏家名录：端方保留两条下发版本，以 issuedAt 后发的一条（生卒 1861–1911）为现行
  const collectors: Collector[] = [
    {
      id: 'col_duan_v1',
      collectorKey: 'c_duanfang',
      name: '端方',
      birthYear: null,
      deathYear: 1911,
      courtesyNote: '字午桥，号匋斋，托忒克氏',
      issuedAt: now - day * 120,
      source: '考订组《近代藏家生卒初考》',
      createdAt: now - day * 120,
      updatedAt: now - day * 120,
    },
    {
      id: 'col_duan_v2',
      collectorKey: 'c_duanfang',
      name: '端方',
      birthYear: 1861,
      deathYear: 1911,
      courtesyNote: '字午桥，号匋斋，托忒克氏',
      issuedAt: now - day * 14,
      source: '考订组《近代藏家生卒订补》',
      createdAt: now - day * 14,
      updatedAt: now - day * 14,
    },
    {
      id: 'col_miao',
      collectorKey: 'c_miaoquansun',
      name: '缪荃孙',
      birthYear: 1844,
      deathYear: 1919,
      courtesyNote: '字炎之，号艺风，堂号艺风堂',
      issuedAt: now - day * 90,
      source: '考订组《艺风堂交游年表》',
      createdAt: now - day * 90,
      updatedAt: now - day * 90,
    },
    {
      id: 'col_zhu',
      collectorKey: 'c_zhuyizun',
      name: '朱彝尊',
      birthYear: 1629,
      deathYear: 1709,
      courtesyNote: '字锡鬯，号竹垞',
      issuedAt: now - day * 88,
      source: '考订组《曝书亭藏碑录》',
      createdAt: now - day * 88,
      updatedAt: now - day * 88,
    },
  ];

  // 题跋按纪年先后展示；rub_0201 的康熙跋纪年早于「清中期拓」断代下限，会顶核断代
  const colophons: Colophon[] = [
    {
      id: 'cln_010101',
      rubbingId: 'rub_0101',
      collectorKey: null,
      collectorText: '古吴王氏',
      dateText: '万历三十四年丙午夏五月',
      dateYear: null,
      text: '纸墨苍润，字口完好，明拓之佳者，宝藏之。',
      createdAt: now - day * 42,
      updatedAt: now - day * 42,
    },
    {
      id: 'cln_010102',
      rubbingId: 'rub_0101',
      collectorKey: 'c_duanfang',
      collectorText: '匋斋',
      dateText: '光绪二十年甲午秋八月',
      dateYear: null,
      text: '礼器旧本，余于京师得之，与簠斋藏本可互证。',
      createdAt: now - day * 30,
      updatedAt: now - day * 30,
    },
    {
      id: 'cln_020101',
      rubbingId: 'rub_0201',
      collectorKey: 'c_zhuyizun',
      collectorText: '竹垞',
      dateText: '康熙十九年庚申秋日',
      dateYear: null,
      text: '石门颂旧搨，拓手颇精，崖文未甚泐，携归曝书亭。',
      createdAt: now - day * 32,
      updatedAt: now - day * 32,
    },
    {
      id: 'cln_020201',
      rubbingId: 'rub_0202',
      collectorKey: 'c_duanfang',
      collectorText: '匋斋',
      dateText: '光绪十七年辛卯冬',
      dateYear: null,
      text: '晚拓一纸，石花较前本为多，留以校勘。',
      createdAt: now - day * 20,
      updatedAt: now - day * 20,
    },
  ];

  await db.transaction('rw', [db.steles, db.rubbings, db.losses, db.seals, db.compares, db.colophons, db.collectors], async () => {
    await db.steles.bulkPut(steles);
    await db.rubbings.bulkPut(rubbings);
    await db.losses.bulkPut(losses);
    await db.seals.bulkPut(seals);
    await db.compares.bulkPut(compares);
    await db.collectors.bulkPut(collectors);
    await db.colophons.bulkPut(colophons);
  });
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
  /** v3 起：历代藏家题跋 */
  colophons: Colophon[];
  /** v3 起：考订组藏家名录 */
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

/** 校验导入文件结构，返回错误文案（空串表示通过） */
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

/**
 * 旧结构备份归一化：v1/v2 备份没有题跋与名录集合，按空集合处理——
 * 旧数据导入后即「按无跋显示」，不臆造题跋，名录等考订组重新下发。
 */
export function normalizeSnapshot(input: RubbingSnapshot): RubbingSnapshot {
  return {
    ...input,
    colophons: Array.isArray(input.colophons) ? input.colophons : [],
    collectors: Array.isArray(input.collectors) ? input.collectors : [],
  };
}

const ALL_TABLES = [
  db.steles,
  db.rubbings,
  db.losses,
  db.seals,
  db.compares,
  db.colophons,
  db.collectors,
] as const;

export async function clearAllTables(): Promise<void> {
  await db.transaction('rw', ALL_TABLES, async () => {
    await Promise.all(ALL_TABLES.map((table) => table.clear()));
  });
}

export async function importSnapshot(rawSnapshot: RubbingSnapshot): Promise<void> {
  // 旧版备份缺题跋 / 名录集合时补空集合，按无跋升级
  const snapshot = normalizeSnapshot(rawSnapshot);
  await clearAllTables();
  // 写库失败只重试本侧这批：逐表为一个批次提交，失败批次按原样重放，不扩大到其它表
  await writeLocalBatch(async () => {
    await db.transaction('rw', ALL_TABLES, async () => {
      await db.steles.bulkPut(snapshot.steles);
      await db.rubbings.bulkPut(snapshot.rubbings);
      await db.losses.bulkPut(snapshot.losses);
      await db.seals.bulkPut(snapshot.seals);
      await db.compares.bulkPut(snapshot.compares);
      await db.colophons.bulkPut(snapshot.colophons);
      await db.collectors.bulkPut(snapshot.collectors);
    });
  });
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

/** 级联删除碑刻 → 拓本 → 损泐 / 钤印 / 题跋 / 比对（名录为考订组维护，不随本侧删除） */
export async function removeSteleCascade(steleId: string): Promise<void> {
  const rubbingIds = (await db.rubbings.where('steleId').equals(steleId).toArray()).map((row) => row.id);
  await db.transaction('rw', ALL_TABLES, async () => {
    if (rubbingIds.length > 0) {
      await db.losses.where('rubbingId').anyOf(rubbingIds).delete();
      await db.seals.where('rubbingId').anyOf(rubbingIds).delete();
      await db.colophons.where('rubbingId').anyOf(rubbingIds).delete();
    }
    await db.rubbings.where('steleId').equals(steleId).delete();
    await db.compares.where('steleId').equals(steleId).delete();
    await db.steles.delete(steleId);
  });
}

/** 级联删除拓本 → 损泐 / 钤印 / 题跋 / 涉及的比对记录 */
export async function removeRubbingCascade(rubbingId: string): Promise<void> {
  await db.transaction('rw', [db.rubbings, db.losses, db.seals, db.colophons, db.compares], async () => {
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
