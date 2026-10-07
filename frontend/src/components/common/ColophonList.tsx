/**
 * <ColophonList> 题跋列表
 * 挂在拓本上的历代藏家题跋，按纪年先后排；名录认领态（已认领 / 待认领）与
 * 「顶翻纸墨断代」角标在此统一渲染。编目员照录藏家、纪年、跋语。
 * 被拓本登记页与比对页消费。
 */
import { useMemo, useState } from 'react';
import { App as AntdApp, Button, Empty, Form, Input, InputNumber, Popconfirm, Space, Tag, Timeline, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, WarningOutlined } from '@ant-design/icons';
import { useAppDispatch } from '@/stores/store';
import {
  createColophon,
  removeColophon,
  updateColophon,
} from '@/stores/colophonSlice';
import {
  COLOPHON_CLAIM_COLOR,
  COLOPHON_CLAIM_LABEL,
  createEmptyColophonDraft,
  type Colophon,
  type ColophonDraft,
} from '@/types/colophon';
import type { Collector } from '@/types/collector';
import { lifespanText } from '@/types/collector';
import { activeCollectorMap, isColophonClaimed } from '@/utils/review';
import { parseColophonYear } from '@/utils/dating';

export interface ColophonListProps {
  rubbingId: string;
  colophons: Colophon[];
  collectors: Collector[];
  /** 紧凑模式（比对页侧栏） */
  size?: 'default' | 'small';
  /** 是否允许编目员增删改（只读展示时传 false） */
  editable?: boolean;
}

export default function ColophonList({
  rubbingId,
  colophons,
  collectors,
  size = 'default',
  editable = true,
}: ColophonListProps) {
  const { message } = AntdApp.useApp();
  const dispatch = useAppDispatch();
  const [form] = Form.useForm<ColophonDraft>();
  const [editing, setEditing] = useState<Colophon | null>(null);
  const [adding, setAdding] = useState(false);

  const nameMap = useMemo(() => activeCollectorMap(collectors), [collectors]);

  // 父层传入的已是全库题跋；此处取本拓本并按纪年先后排（无核定纪年的靠后）
  const rows = useMemo(
    () =>
      colophons
        .filter((item) => item.rubbingId === rubbingId)
        .sort((a, b) => {
          if (a.eraYear !== null && b.eraYear !== null) return a.eraYear - b.eraYear;
          if (a.eraYear !== null) return -1;
          if (b.eraYear !== null) return 1;
          return a.createdAt - b.createdAt;
        }),
    [colophons, rubbingId],
  );

  const startAdd = (): void => {
    setEditing(null);
    form.setFieldsValue({ ...createEmptyColophonDraft(rubbingId), eraYear: null });
    setAdding(true);
  };

  const startEdit = (colophon: Colophon): void => {
    setEditing(colophon);
    form.setFieldsValue({
      rubbingId: colophon.rubbingId,
      collectorName: colophon.collectorName,
      eraText: colophon.eraText,
      eraYear: colophon.eraYear,
      text: colophon.text,
    });
    setAdding(true);
  };

  const submit = async (): Promise<void> => {
    const values = await form.validateFields();
    // 纪年原文为主；核定公元年缺省时按原文解析（年号 / 民国 / 公元），解析不出置 null
    const parsed = parseColophonYear(values.eraText ?? '');
    const eraYear = typeof values.eraYear === 'number' ? values.eraYear : parsed;
    const payload: ColophonDraft = {
      rubbingId,
      collectorName: values.collectorName?.trim() ?? '',
      eraText: values.eraText?.trim() ?? '',
      eraYear,
      text: values.text ?? '',
    };
    if (editing) {
      await dispatch(updateColophon({ id: editing.id, patch: payload })).unwrap();
      message.success('已更新题跋');
    } else {
      await dispatch(createColophon(payload)).unwrap();
      message.success(eraYear === null ? '已登记题跋（纪年未考，暂不参与断代复核）' : '已登记题跋');
    }
    setAdding(false);
    setEditing(null);
  };

  const renderForm = (): JSX.Element => (
    <Form form={form} layout="vertical" size="small" style={{ marginTop: 8 }}>
      <Space size={8} wrap style={{ display: 'flex' }}>
        <Form.Item
          name="collectorName"
          label="藏家署名"
          style={{ flex: 1, minWidth: 130 }}
          extra={undefined}
          rules={[{ max: 30 }]}
        >
          <Input placeholder="认不出留空，挂待认领" allowClear list="gb-collector-names" />
        </Form.Item>
        <Form.Item name="eraText" label="纪年原文" style={{ flex: 1, minWidth: 150 }} rules={[{ required: true, message: '请填写纪年' }]}>
          <Input placeholder="如：万历二十三年乙未冬" />
        </Form.Item>
        <Form.Item name="eraYear" label="核定公元年" style={{ width: 120 }} tooltip="可留空，按纪年原文自动换算；换算不出则不参与断代复核">
          <InputNumber min={260} max={2100} placeholder="自动" controls={false} style={{ width: '100%' }} />
        </Form.Item>
      </Space>
      <datalist id="gb-collector-names">
        {Array.from(nameMap.values()).map((collector) => (
          <option key={collector.id} value={collector.name}>
            {collector.courtesyName ? `（${collector.courtesyName}）` : ''}
          </option>
        ))}
      </datalist>
      <Form.Item name="text" label="跋语" rules={[{ required: true, message: '请照录跋语' }]}>
        <Input.TextArea rows={size === 'small' ? 2 : 3} placeholder="照录跋文原文" />
      </Form.Item>
      <Space>
        <Button type="primary" size="small" onClick={() => void submit()}>
          {editing ? '保存修改' : '登记题跋'}
        </Button>
        <Button
          size="small"
          onClick={() => {
            setAdding(false);
            setEditing(null);
          }}
        >
          取消
        </Button>
      </Space>
    </Form>
  );

  if (rows.length === 0 && !adding) {
    return (
      <div>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无题跋（按无跋显示）"
          style={{ margin: size === 'small' ? '4px 0' : '12px 0' }}
        >
          {editable ? (
            <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={startAdd}>
              登记题跋
            </Button>
          ) : null}
        </Empty>
      </div>
    );
  }

  return (
    <div>
      <Timeline
        items={rows.map((colophon) => {
          const claimed = isColophonClaimed(colophon, collectors);
          const collector = claimed ? nameMap.get(colophon.collectorName.trim()) ?? null : null;
          return {
            color: claimed ? '#2f6f4f' : '#c9963c',
            children: (
              <div style={{ marginBottom: size === 'small' ? 2 : 6 }}>
                <Space size={6} wrap>
                  <Tag color={COLOPHON_CLAIM_COLOR[claimed ? 'claimed' : 'unclaimed']}>
                    {claimed ? COLOPHON_CLAIM_LABEL.claimed : COLOPHON_CLAIM_LABEL.unclaimed}
                  </Tag>
                  <Typography.Text strong>{colophon.collectorName.trim() || '署名无考'}</Typography.Text>
                  {collector && collector.courtesyName ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      （{collector.courtesyName}，{lifespanText(collector)}）
                    </Typography.Text>
                  ) : null}
                  <Tag color="gold">{colophon.eraText}</Tag>
                  {colophon.eraYear !== null ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      公元 {colophon.eraYear}
                    </Typography.Text>
                  ) : (
                    <Tag>纪年未考</Tag>
                  )}
                </Space>
                <Typography.Paragraph
                  style={{ margin: '4px 0', fontSize: size === 'small' ? 12 : 13 }}
                  ellipsis={size === 'small' ? { rows: 3, expandable: true, symbol: '展开' } : false}
                >
                  {colophon.text}
                </Typography.Paragraph>
                {editable ? (
                  <Space size={4}>
                    <Button size="small" type="link" icon={<EditOutlined />} onClick={() => startEdit(colophon)}>
                      编辑
                    </Button>
                    <Popconfirm
                      title="删除该题跋"
                      description="删除后会重新复核相关断代标记。"
                      okText="确认"
                      cancelText="取消"
                      onConfirm={() =>
                        void dispatch(removeColophon(colophon.id))
                          .unwrap()
                          .then(() => message.success('已删除题跋'))
                      }
                    >
                      <Button size="small" type="link" danger icon={<DeleteOutlined />}>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                ) : null}
              </div>
            ),
          };
        })}
      />
      {editable && !adding ? (
        <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={startAdd} block>
          登记题跋
        </Button>
      ) : null}
      {adding ? renderForm() : null}
    </div>
  );
}

/** 断代被跋顶翻的提示条：拓本台与比对台共用 */
export function ReviewBanner({ eraText, collectorName }: { eraText?: string | null; collectorName?: string | null }): JSX.Element {
  const who = collectorName?.trim() || '佚名藏家';
  const era = eraText?.trim() || '纪年无考';
  return (
    <Tag icon={<WarningOutlined />} color="warning" style={{ marginInlineStart: 0 }}>
      待核：纸墨断代被「{era} · {who}」跋顶翻
    </Tag>
  );
}
