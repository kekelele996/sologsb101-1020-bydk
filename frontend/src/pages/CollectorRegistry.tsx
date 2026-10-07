/**
 * /collectors 藏家名录与待认领题跋
 * - 名录由考订组维护并整批下发：本页只读展示与「接收一批」，编目台不能手工改；
 *   同名藏家以后发（issuedAt 最大）的生卒年为准，旧版标已废止。
 * - 认不出藏家的题跋集中挂在「待认领」清单，名录补发后自动对上。
 * 消费 Collector、Colophon、Rubbing、Stele；复用 <StatBadge>、<EmptyPanel>。
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CloudUploadOutlined, PlusOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import EmptyPanel from '@/components/common/EmptyPanel';
import StatBadge from '@/components/common/StatBadge';
import { useAppDispatch, useAppSelector } from '@/stores/store';
import { receiveCollectorBatch, selectColophons, selectCollectors } from '@/stores/colophonSlice';
import { selectRubbings } from '@/stores/rubbingSlice';
import { selectSteles } from '@/stores/steleSlice';
import {
  COLLECTOR_SOURCE_COLOR,
  COLLECTOR_SOURCE_LABEL,
  createEmptyCollectorDraft,
  lifespanText,
  type Collector,
  type CollectorDraft,
} from '@/types/collector';
import { activeCollectorMap, isUnclaimedColophon } from '@/utils/review';
import { nextCollectorIssueNo } from '@/utils/db';

interface IngestRow {
  name: string;
  courtesyName?: string;
  birthYear?: number | null;
  deathYear?: number | null;
  note?: string;
}

export default function CollectorRegistry() {
  const { message } = AntdApp.useApp();
  const dispatch = useAppDispatch();
  const collectors = useAppSelector(selectCollectors);
  const colophons = useAppSelector(selectColophons);
  const rubbings = useAppSelector(selectRubbings);
  const steles = useAppSelector(selectSteles);

  const [open, setOpen] = useState(false);
  const [issueNo, setIssueNo] = useState(1);
  const [form] = Form.useForm<{ rows: IngestRow[] }>();

  const activeMap = useMemo(() => activeCollectorMap(collectors), [collectors]);
  const activeList = useMemo(() => Array.from(activeMap.values()).sort((a, b) => a.name.localeCompare(b.name)), [activeMap]);
  const deprecated = useMemo(
    () => collectors.filter((collector) => collector.source === 'deprecated').sort((a, b) => b.issuedAt - a.issuedAt),
    [collectors],
  );

  const unclaimed = useMemo(
    () => colophons.filter((colophon) => isUnclaimedColophon(colophon, collectors)),
    [colophons, collectors],
  );

  const stat = useMemo(
    () => ({
      active: activeList.length,
      deprecated: deprecated.length,
      colophon: colophons.length,
      unclaimed: unclaimed.length,
    }),
    [activeList.length, colophons.length, deprecated.length, unclaimed.length],
  );

  const openReceive = async (): Promise<void> => {
    const next = await nextCollectorIssueNo();
    setIssueNo(next);
    form.setFieldsValue({
      rows: [{ name: '', courtesyName: '', birthYear: null, deathYear: null, note: '' }],
    });
    setOpen(true);
  };

  const submit = async (): Promise<void> => {
    const values = await form.validateFields();
    const rows = (values.rows ?? []).filter((row) => row.name && row.name.trim().length > 0);
    if (rows.length === 0) {
      message.warning('请至少填写一位藏家姓名');
      return;
    }
    const issuedAt = Date.now();
    const drafts: CollectorDraft[] = rows.map((row, index) => ({
      ...createEmptyCollectorDraft(issueNo, issuedAt + index),
      name: row.name.trim(),
      courtesyName: row.courtesyName?.trim() ?? '',
      birthYear: typeof row.birthYear === 'number' ? row.birthYear : null,
      deathYear: typeof row.deathYear === 'number' ? row.deathYear : null,
      note: row.note?.trim() ?? '',
    }));
    try {
      const count = await dispatch(receiveCollectorBatch(drafts)).unwrap();
      message.success(`已接收考订组第 ${issueNo} 批名录，共 ${count} 位；同名旧版自动标废止`);
      setOpen(false);
    } catch (error) {
      message.error(`名录接收失败（已只重试本侧这批）：${error instanceof Error ? error.message : '未知错误'}`);
    }
  };

  const steleTitleOf = (steleId: string): string => steles.find((stele) => stele.id === steleId)?.title ?? steleId;

  const collectorColumns: ColumnsType<Collector> = [
    { title: '姓名', dataIndex: 'name', width: 110, render: (value: string) => <Typography.Text strong>{value}</Typography.Text> },
    { title: '字号', dataIndex: 'courtesyName', width: 100, render: (value: string) => value || '—' },
    {
      title: '生卒年（公元）',
      key: 'lifespan',
      width: 140,
      render: (_value, record) => lifespanText(record),
    },
    { title: '小传', dataIndex: 'note', render: (value: string) => value || '—' },
    { title: '批次', dataIndex: 'issueNo', width: 80, render: (value: number) => `第 ${value} 批` },
    {
      title: '状态',
      dataIndex: 'source',
      width: 100,
      render: (value: Collector['source']) => (
        <Tag color={COLLECTOR_SOURCE_COLOR[value]}>{COLLECTOR_SOURCE_LABEL[value]}</Tag>
      ),
    },
  ];

  const unclaimedColumns: ColumnsType<(typeof unclaimed)[number]> = [
    {
      title: '署名',
      dataIndex: 'collectorName',
      width: 120,
      render: (value: string) => value.trim() || <Tag>署名漶灭</Tag>,
    },
    { title: '纪年原文', dataIndex: 'eraText', width: 170, render: (value: string) => value || '—' },
    {
      title: '核定公元年',
      dataIndex: 'eraYear',
      width: 100,
      render: (value: number | null) => (value === null ? <Tag>未考</Tag> : value),
    },
    { title: '跋语', dataIndex: 'text', ellipsis: true },
    {
      title: '所在拓本',
      dataIndex: 'rubbingId',
      width: 160,
      render: (value: string) => {
        const rubbing = rubbings.find((item) => item.id === value);
        return rubbing ? `《${steleTitleOf(rubbing.steleId)}》第 ${rubbing.versionNo} 版` : '拓本已删除';
      },
    },
  ];

  return (
    <div>
      <div className="gb-page-head">
        <div>
          <h2>藏家名录与待认领题跋</h2>
          <p>名录由考订组维护，编目台只读；同名藏家以后发的生卒年为准。认不出藏家的题跋先挂待认领，名录补发后自动对上。</p>
        </div>
        <Button type="primary" icon={<CloudUploadOutlined />} onClick={() => void openReceive()}>
          接收考订组一批名录
        </Button>
      </div>

      <div className="gb-stat-row">
        <StatBadge label="现行名录" value={stat.active} suffix="位" tone="primary" />
        <StatBadge label="已废止旧版" value={stat.deprecated} suffix="条" tone="info" />
        <StatBadge label="题跋总数" value={stat.colophon} suffix="条" tone="info" />
        <StatBadge label="待认领" value={stat.unclaimed} suffix="条" tone="danger" />
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 14 }}
        message="只读名录"
        description="编目员不能在此改藏家生卒年；考订组后发同名条目时，旧版自动转「已废止」，全台题跋与断代复核一律以新版为准，已照录的跋语不受影响。写库失败只重试本侧这批，不要求考订组重发。"
      />

      <Row gutter={16}>
        <Col xs={24} xl={15}>
          <Card
            className="gb-table-card"
            title={
              <Space>
                <SafetyCertificateOutlined />
                现行藏家名录（考订组）
              </Space>
            }
            styles={{ body: { padding: 0 } }}
          >
            {activeList.length === 0 ? (
              <EmptyPanel
                title="名录还是空的"
                description="接收考订组第一批名录后，题跋上的署名才能对上藏家并显示生卒年。"
                actionText="接收一批名录"
                onAction={() => void openReceive()}
                size="small"
              />
            ) : (
              <Table<Collector>
                rowKey="id"
                size="small"
                pagination={{ pageSize: 8 }}
                columns={collectorColumns}
                dataSource={activeList}
              />
            )}
          </Card>

          {deprecated.length > 0 ? (
            <Card className="gb-table-card" title="已废止旧版（同名以后发为准）" style={{ marginTop: 16 }} styles={{ body: { padding: 0 } }}>
              <Table<Collector>
                rowKey="id"
                size="small"
                pagination={{ pageSize: 4 }}
                columns={collectorColumns}
                dataSource={deprecated}
              />
            </Card>
          ) : null}
        </Col>

        <Col xs={24} xl={9}>
          <Card className="gb-table-card" title="待认领题跋" styles={{ body: { padding: 0 } }}>
            {unclaimed.length === 0 ? (
              <EmptyPanel
                title="没有待认领题跋"
                description="全部题跋署名都已对上现行名录；新登记时署名留空或名录未收，会自动挂到这里。"
                size="small"
              />
            ) : (
              <Table
                rowKey="id"
                size="small"
                pagination={{ pageSize: 8 }}
                columns={unclaimedColumns}
                dataSource={unclaimed}
              />
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        open={open}
        title={`接收考订组名录 · 第 ${issueNo} 批`}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        okText="接收入库"
        cancelText="取消"
        width={820}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            同批同名只保留最后一条；后发批次的同名条自动顶掉旧版生卒年。此处模拟考订组下发，编目台仅做整批接收。
          </Typography.Paragraph>
          <Form.List name="rows">
            {(fields, { add, remove }) => (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                {fields.map((field) => (
                  <Card key={field.key} size="small">
                    <Space size={8} wrap align="baseline">
                      <Form.Item
                        name={[field.name, 'name']}
                        label="姓名"
                        rules={[{ required: true, message: '必填' }]}
                        style={{ marginBottom: 8, width: 120 }}
                      >
                        <Input placeholder="如：端方" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'courtesyName']} label="字号" style={{ marginBottom: 8, width: 110 }}>
                        <Input placeholder="如：匋斋" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'birthYear']} label="生年" style={{ marginBottom: 8, width: 100 }}>
                        <InputNumber min={260} max={2100} controls={false} placeholder="公元" style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item name={[field.name, 'deathYear']} label="卒年" style={{ marginBottom: 8, width: 100 }}>
                        <InputNumber min={260} max={2100} controls={false} placeholder="在世留空" style={{ width: '100%' }} />
                      </Form.Item>
                      {fields.length > 1 ? (
                        <Button danger size="small" type="link" onClick={() => remove(field.name)}>
                          删除
                        </Button>
                      ) : null}
                    </Space>
                    <Form.Item name={[field.name, 'note']} label="小传" style={{ marginBottom: 0 }}>
                      <Input.TextArea rows={1} placeholder="籍贯、室名、藏印源流等" />
                    </Form.Item>
                  </Card>
                ))}
                <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add({ name: '', courtesyName: '', birthYear: null, deathYear: null, note: '' })}>
                  再加一位
                </Button>
              </Space>
            )}
          </Form.List>
        </Form>
      </Modal>
    </div>
  );
}
