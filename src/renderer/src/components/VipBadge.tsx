import { useId } from 'react';

export default function VipBadge({ isVip }: { isVip?: boolean }) {
  const maskId = useId();
  if (!isVip) return null;
  return (
    <svg className="vip-song-badge" viewBox="0 0 34 18" role="img" aria-label="VIP歌曲">
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="34" height="18">
          <rect width="34" height="18" fill="white" />
          <text x="17" y="9" textAnchor="middle" dominantBaseline="central" fill="black" style={{ fontFamily: 'Volo VIP Douyu', fontSize: 12 }}>VIP</text>
        </mask>
      </defs>
      <rect width="34" height="18" rx="7" fill="currentColor" mask={`url(#${maskId})`} />
    </svg>
  );
}