import { useEffect, useState } from 'react';
import { ncmApi } from '../../api/ncm-client';
import type { UserProfile } from '../../api/ncm-client';
import { useNcmUser } from '../../contexts/NcmUserContext';
import ManagementDialog from '../ManagementDialog';

const POLL_INTERVAL = 2000;

type LoginPhase = 'loading' | 'ready' | 'scanned' | 'success' | 'network' | 'error';

interface Props {
  open: boolean;
  onClose: () => void;
}

const phaseContent: Record<LoginPhase, { icon: string; text: string }> = {
  loading: { icon: 'progress_activity', text: '正在生成二维码…' },
  ready: { icon: 'qr_code_scanner', text: '请使用网易云音乐 App 扫码' },
  scanned: { icon: 'phone_android', text: '扫描成功，请在手机上确认' },
  success: { icon: 'check_circle', text: '登录成功' },
  network: { icon: 'wifi_off', text: '网络连接不稳定，正在重试' },
  error: { icon: 'error_outline', text: '登录未完成，请刷新二维码重试' },
};

export default function LoginDialog({ open, onClose }: Props) {
  const { login } = useNcmUser();
  const [qrimg, setQrimg] = useState('');
  const [phase, setPhase] = useState<LoginPhase>('loading');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    let polling = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;

    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = undefined;
    };

    const checkLogin = async (key: string) => {
      if (cancelled || polling) return;
      polling = true;

      try {
        const result = await ncmApi.loginQrCheck(key);
        if (cancelled) return;

        switch (result.code) {
          case 800:
            stopPolling();
            setPhase('loading');
            setQrimg('');
            setRefreshKey((value) => value + 1);
            break;
          case 801:
            setPhase('ready');
            break;
          case 802:
            setPhase('scanned');
            break;
          case 803: {
            stopPolling();
            const cookie = result.cookie || '';

            try {
              const status = await ncmApi.loginStatus(cookie);
              if (cancelled) return;
              const profile = status?.data?.profile as UserProfile | undefined;
              if (status?.data?.code !== 200 || !profile?.userId) {
                throw new Error('NCM profile is unavailable');
              }
              await login(cookie, profile);
              setPhase('success');
              closeTimer = setTimeout(onClose, 500);
            } catch {
              if (!cancelled) setPhase('error');
            }
            break;
          }
          default:
            stopPolling();
            setPhase('error');
        }
      } catch {
        if (!cancelled) setPhase('network');
      } finally {
        polling = false;
      }
    };

    const createQr = async () => {
      setQrimg('');
      setPhase('loading');

      try {
        const keyResult = await ncmApi.loginQrKey();
        if (cancelled) return;
        const key = keyResult?.data?.unikey;
        if (!key) throw new Error('Missing QR key');

        const qrResult = await ncmApi.loginQrCreate(key);
        if (cancelled) return;
        const image = qrResult?.data?.qrimg;
        if (!image) throw new Error('Missing QR image');

        setQrimg(image);
        setPhase('ready');
        pollTimer = setInterval(() => void checkLogin(key), POLL_INTERVAL);
      } catch {
        if (!cancelled) setPhase('error');
      }
    };

    void createQr();
    return () => {
      cancelled = true;
      stopPolling();
      if (closeTimer) clearTimeout(closeTimer);
    };
  }, [open, refreshKey, login, onClose]);

  const canRefresh = phase !== 'loading' && phase !== 'success';

  return (
    <ManagementDialog
      open={open}
      onClose={onClose}
      label="登录网易云音乐"
      className="ncm-login-dialog w-[min(360px,calc(100vw-32px))]"
    >
      <div className="ncm-login-header">
        <span className="ncm-login-mark material-icons-round-outlined" aria-hidden="true">
          music_note
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="ncm-login-title">登录网易云音乐</h2>
          <p className="ncm-login-subtitle">用手机 App 扫码，继续同步你的音乐</p>
        </div>
        <button
          type="button"
          className="ncm-login-close"
          onClick={onClose}
          aria-label="关闭扫码登录"
          title="关闭"
        >
          <span className="material-icons-round" aria-hidden="true">close</span>
        </button>
      </div>

      <div className="ncm-login-content">
        <div className="ncm-login-qr-frame">
          {qrimg ? (
            <img className="ncm-login-qr" src={qrimg} alt="网易云音乐登录二维码" />
          ) : (
            <div className="ncm-login-qr-placeholder" aria-hidden="true">
              <span className="material-icons-round-outlined">qr_code_2</span>
            </div>
          )}
        </div>
        <div
          className="ncm-login-status"
          data-phase={phase}
          role={phase === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          <span className="material-icons-round-outlined" aria-hidden="true">
            {phaseContent[phase].icon}
          </span>
          <span>{phaseContent[phase].text}</span>
        </div>
        <p className="ncm-login-hint">
          {phase === 'error' ? '检查网络连接后刷新二维码' : '二维码过期后会自动更新'}
        </p>
      </div>

      <div className="ncm-login-footer">
        <button
          type="button"
          className="ncm-login-refresh"
          onClick={() => setRefreshKey((value) => value + 1)}
          disabled={!canRefresh}
        >
          <span className="material-icons-round-outlined" aria-hidden="true">refresh</span>
          刷新二维码
        </button>
      </div>
    </ManagementDialog>
  );
}
