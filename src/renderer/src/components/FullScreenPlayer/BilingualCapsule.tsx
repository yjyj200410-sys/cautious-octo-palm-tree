import { useEffect, useId, useRef, useState } from "react";

type BilingualMode =
  | "original"
  | "translation"
  | "original+translation"
  | "translation+original";

type Props = {
  mode: BilingualMode;
  isVisible: boolean;
  onChange: (mode: BilingualMode) => void;
};

const BilingualCapsule = ({ mode, isVisible, onChange }: Props) => {
  const maskId = useId();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [hovered, setHovered] = useState(false);
  const show = isVisible || hovered;
  const translationEnabled = mode !== "original";

  useEffect(() => {
    if (mode === "translation" || mode === "translation+original") {
      onChangeRef.current("original+translation");
    }
  }, [mode]);

  return (
    <button
      type="button"
      className={`fullscreen-translation-toggle relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border border-white/14 bg-black/24 p-1 text-white shadow-[0_12px_36px_rgba(0,0,0,.2)] backdrop-blur-[20px] transition-[opacity,transform] duration-200 active:scale-95 ${
        show ? "opacity-100" : "pointer-events-none translate-y-2 opacity-0"
      }`}
      style={
        {
          WebkitAppRegion: "no-drag",
          appRegion: "no-drag",
        } as React.CSSProperties
      }
      title={translationEnabled ? "关闭歌词翻译" : "显示歌词翻译"}
      aria-label="歌词翻译"
      aria-pressed={translationEnabled}
      onClick={() =>
        onChangeRef.current(translationEnabled ? "original" : "original+translation")
      }
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 40 40"
        aria-hidden="true"
      >
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="40" height="40">
            <rect width="40" height="40" fill="white" />
            <text
              x="20"
              y="20"
              dy=".35em"
              textAnchor="middle"
              fill="black"
              fontFamily="system-ui, sans-serif"
              fontSize="22"
              fontWeight="600"
            >
              译
            </text>
          </mask>
        </defs>
        <text
          x="20"
          y="20"
          dy=".35em"
          textAnchor="middle"
          fill="currentColor"
          fontFamily="system-ui, sans-serif"
          fontSize="22"
          fontWeight="600"
          className="fullscreen-translation-toggle__text"
        >
          译
        </text>
        <g mask={`url(#${maskId})`}>
          <rect
            width="40"
            height="40"
            rx="8"
            fill="currentColor"
            className="fullscreen-translation-toggle__fill"
          />
        </g>
      </svg>
    </button>
  );
};

export default BilingualCapsule;