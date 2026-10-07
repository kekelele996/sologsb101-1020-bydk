/**
 * <ReviewTag> 断代待核标记
 * 实物跋文纪年早于编目员纸墨断代时，断代结论转待核，此标签统一展示并写明是哪条跋顶的。
 * 被拓本登记、碑刻台账、版本比对页与编目卡导出消费。
 */
import { Tooltip, Typography } from 'antd';
import type { DatingChallenge } from '@/utils/dating';
import { describeChallenge } from '@/utils/dating';

export interface ReviewTagProps {
  challenge: DatingChallenge;
  /** 紧凑模式：只出标记，悬停看顶核跋说明 */
  compact?: boolean;
}

export function ReviewTag({ challenge, compact = true }: ReviewTagProps) {
  if (compact) {
    return (
      <Tooltip title={describeChallenge(challenge)}>
        <Typography.Text type="danger" style={{ fontSize: 12, borderBottom: '1px dashed #b03a2e', cursor: 'help' }}>
          断代待核
        </Typography.Text>
      </Tooltip>
    );
  }
  return (
    <Typography.Text type="danger" style={{ fontSize: 12 }}>
      断代待核：{describeChallenge(challenge)}
    </Typography.Text>
  );
}

export default ReviewTag;
