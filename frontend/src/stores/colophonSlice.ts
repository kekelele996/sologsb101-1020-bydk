/**
 * 题跋与藏家名录 slice（Redux Toolkit）
 * - 题跋：编目台增删改，按纪年先后展示；写库失败由 db 层只重试本侧这批
 * - 藏家名录：考订组维护、整批接收，编目台只读；同名以后发生卒年为准
 */
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import {
  createId,
  db,
  ingestCollectorBatch,
  localBulkPutWithRetry,
  recomputeReviews,
} from '@/utils/db';
import { colophonEraOrder } from '@/utils/dating';
import type { Colophon, ColophonDraft } from '@/types/colophon';
import type { Collector, CollectorDraft } from '@/types/collector';
import { loadRubbings } from './rubbingSlice';
import { loadLosses } from './lossSlice';

export interface ColophonState {
  colophons: Colophon[];
  collectors: Collector[];
  loading: boolean;
  ready: boolean;
  error: string;
}

const initialState: ColophonState = {
  colophons: [],
  collectors: [],
  loading: false,
  ready: false,
  error: '',
};

export const loadColophons = createAsyncThunk('colophon/load', async () => {
  const [colophons, collectors] = await Promise.all([db.colophons.toArray(), db.collectors.toArray()]);
  colophons.sort(colophonEraOrder);
  collectors.sort((a, b) => (a.issuedAt === b.issuedAt ? a.name.localeCompare(b.name) : b.issuedAt - a.issuedAt));
  return { colophons, collectors };
});

export const createColophon = createAsyncThunk('colophon/create', async (draft: ColophonDraft, { dispatch }) => {
  const now = Date.now();
  const row: Colophon = { ...draft, id: createId('colo'), createdAt: now, updatedAt: now };
  // 写库失败只重试这一条，不波及其他拓本
  await localBulkPutWithRetry(db.colophons, [row]);
  await recomputeReviews([row.rubbingId]);
  await Promise.all([dispatch(loadColophons()), dispatch(loadRubbings()), dispatch(loadLosses())]);
  return row;
});

export const updateColophon = createAsyncThunk(
  'colophon/update',
  async (payload: { id: string; patch: Partial<Colophon> }, { dispatch, getState }) => {
    const state = getState() as { colophon: ColophonState };
    const previous = state.colophon.colophons.find((item) => item.id === payload.id);
    await db.colophons.update(payload.id, { ...payload.patch, updatedAt: Date.now() } as never);
    const rubbingIds = [previous?.rubbingId, payload.patch.rubbingId].filter(
      (value): value is string => typeof value === 'string',
    );
    await recomputeReviews(Array.from(new Set(rubbingIds)));
    await Promise.all([dispatch(loadColophons()), dispatch(loadRubbings()), dispatch(loadLosses())]);
  },
);

export const removeColophon = createAsyncThunk('colophon/remove', async (id: string, { dispatch, getState }) => {
  const state = getState() as { colophon: ColophonState };
  const previous = state.colophon.colophons.find((item) => item.id === id);
  await db.colophons.delete(id);
  if (previous) await recomputeReviews([previous.rubbingId]);
  await Promise.all([dispatch(loadColophons()), dispatch(loadRubbings()), dispatch(loadLosses())]);
});

/** 接收考订组名录批次；返回写入条数 */
export const receiveCollectorBatch = createAsyncThunk('collector/receive', async (drafts: CollectorDraft[], { dispatch }) => {
  const count = await ingestCollectorBatch(drafts);
  await dispatch(loadColophons());
  return count;
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
        state.colophons = action.payload.colophons;
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

export const selectColophons = (state: { colophon: ColophonState }): Colophon[] => state.colophon.colophons;
export const selectCollectors = (state: { colophon: ColophonState }): Collector[] => state.colophon.collectors;

export default colophonSlice.reducer;
