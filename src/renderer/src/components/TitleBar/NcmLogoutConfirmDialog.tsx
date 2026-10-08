import { useState } from 'react';

import ManagementDialog from '../ManagementDialog';

interface Props {
  open: boolean;
  nickname: string;
  mode?: 'logout' | 'remove';
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export default function NcmLogoutConfirmDialog({ open, nickname, mode = 'logout', onClose, onConfirm }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const close = () => {
    if (pending) return;
    setError('');
    onClose();
  };

  const handleConfirm = async () => {
    if (pending) return;
    setError('');
    setPending(true);
    try {
      await onConfirm();
    } catch {
      setError('操作失败，请稍后重试');
    } finally {
      setPending(false);
    }
  };

  return (
    <ManagementDialog
      open={open}
      onClose={close}
      label={mode === 'remove' ? '确认移除已保存账号' : '确认退出网易云账号'}
      className="ncm-logout-dialog w-[min(360px,calc(100vw-32px))]"
    >
      <div className="ncm-logout-content">
        <span className="ncm-logout-mark material-icons-round-outlined" aria-hidden="true">
          logout
        </span>
        <h2 className="ncm-logout-title">
          {mode === 'remove' ? '移除已保存账号？' : '退出网易云账号？'}
        </h2>
        <p className="ncm-logout-description">
          {mode === 'remove'
            ? `将从本机移除「${nickname}」的登录信息。之后需要重新扫码添加。`
            : `将退出「${nickname}」并移除本机保存的登录信息。其他账号不受影响。`}
        </p>
        {error && <p className="ncm-account-error mt-2 text-xs" role="alert">{error}</p>}
      </div>
      <div className="ncm-logout-actions">
        <button type="button" className="ncm-logout-cancel" onClick={close} disabled={pending}>
          取消
        </button>
        <button
          type="button"
          className="ncm-logout-confirm"
          onClick={() => void handleConfirm()}
          disabled={pending}
        >
          {pending ? '正在处理…' : mode === 'remove' ? '移除账号' : '退出登录'}
        </button>
      </div>
    </ManagementDialog>
  );
}
