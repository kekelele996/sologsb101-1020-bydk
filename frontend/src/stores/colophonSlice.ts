/**
 * 题跋与藏家名录 slice（Redux Toolkit）
 * - 题跋：挂在拓本上的历代藏家跋语，按纪年先后取用；写库失败只重试本侧这批。
 * - 藏家名录：考订组维护下发，编目台只读，slice 不提供任何写入 / 删除 thunk。
 * 同一藏家以考订组后发（issuedAt 最大）的生卒年为准，由展示侧选择器合并。
 */
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { createId, db } from '@/utils/db';
import { writeLocalBatch } from '@/utils/localWrite';
import { sortColophons } from '@/utils/dating';
import type { Colophon, ColophonDraft } from '@/types/colophon';
import type { Collector } from '@/types/collector';
import type { RootState } from './store';

export interface ColophonState {
  items: Colophon[];
  /** 考订组名录（含同 key 的历次下发版本，留痕） */
  collectors: Collector[];
  loading: boolean;
  ready: boolean;
  error: string;
}

const initialState: ColophonState = {
  items: [],
  collectors: [],
  loading: false,
  ready: false,
  error: '',
};

export const loadColophons = createAsyncThunk('colophon/load', async () => {
  const [colophons, collectors] = await Promise.all([db.colophons.toArray(), db.collectors.toArray()]);
  return { colophons: sortColophons(colophons), collectors };
});

export const createColophon = createAsyncThunk('colophon/create', async (draft: ColophonDraft, { dispatch }) => {
  const now = Date.now();
  const row: Colophon = { ...draft, id: createId('cln'), createdAt: now, updatedAt: now };
  // 单条即本侧这批，失败按原样重放这一条
  await writeLocalBatch(() => db.colophons.put(row));
  await dispatch(loadColophons());
  return row;
});

export const updateColophon = createAsyncThunk(
  'colophon/update',
  async (payload: { id: string; patch: Partial<Colophon> }, { dispatch }) => {
    await writeLocalBatch(() =>
      db.colophons.update(payload.id, { ...payload.patch, updatedAt: Date.now() } as never),
    );
    await dispatch(loadColophons());
  },
);

/** 批量提交本侧这批题跋；失败只重放提交时锁定的同一批 */
export const bulkUpsertColophons = createAsyncThunk(
  'colophon/bulkUpsert',
  async (rows: Colophon[], { dispatch }) => {
    if (rows.length === 0) return;
    const batch = rows.map((row) => ({ ...row, updatedAt: Date.now() }));
    await writeLocalBatch(() => db.colophons.bulkPut(batch));
    await dispatch(loadColophons());
  },
);

export const removeColophon = createAsyncThunk('colophon/remove', async (id: string, { dispatch }) => {
  await writeLocalBatch(() => db.colophons.delete(id));
  await dispatch(loadColophons());
});

const colophonSlice = createSlice({
  name: 'colophon',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(loadColophons.pending, (state) => {
        state.loading = true;
      })
      .addCase(loadColophons.fulfilled, (state, action) => {
        state.items = action.payload.colophons;
        state.collectors = action.payload.collectors;
        state.loading = false;
        state.ready = true;
        state.error = '';
      })
      .addCase(loadColophons.rejected, (state, action) => {
        state.loading = false;
        state.ready = true;
        state.error = action.error.message ?? '题跋读取失败';
      });
  },
});

export const selectColophonState = (state: RootState): ColophonState => state.colophon;
export const selectColophons = (state: RootState): Colophon[] => state.colophon.items;
export const selectCollectors = (state: RootState): Collector[] => state.colophon.collectors;

/** 某拓本下的题跋，已按纪年先后排好 */
export function selectColophonsByRubbing(rubbingId: string) {
  return (state: RootState): Colophon[] =>
    state.colophon.items.filter((colophon) => colophon.rubbingId === rubbingId);
}

/**
 * 名录现行条目：同 collectorKey 下 issuedAt 后发的一条为准。
 * 供题跋展示藏家生卒年；编目员录入的跋语原样保留，不随名录变化。
 */
export function selectCurrentCollectors(state: RootState): Map<string, Collector> {
  const map = new Map<string, Collector>();
  state.colophon.collectors.forEach((collector) => {
    const existing = map.get(collector.collectorKey);
    if (!existing || collector.issuedAt > existing.issuedAt) map.set(collector.collectorKey, collector);
  });
  return map;
}

export default colophonSlice.reducer;
