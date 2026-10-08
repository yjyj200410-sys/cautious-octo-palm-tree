import { useEffect, useRef, useState } from 'react';

export default function LibrarySearch({
  value,
  onChange
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(Boolean(value));
  const [draft, setDraft] = useState(value);
  const composing = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const close = () => {
    onChange('');
    setDraft('');
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div
      role="search"
      className="library-search"
      data-open={open || Boolean(value)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' && !composing.current) {
          event.preventDefault();
          close();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget) && !draft.trim()) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="library-search-toggle"
        aria-label="搜索歌单内歌曲"
        title="搜索歌单内歌曲"
        aria-expanded={open || Boolean(value)}
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => input.current?.focus());
        }}
      >
        <span className="material-icons-round" aria-hidden="true">
          search
        </span>
      </button>
      <input
        ref={input}
        value={draft}
        tabIndex={open || value ? 0 : -1}
        aria-label="搜索歌单内歌曲"
        placeholder="搜索歌单内歌曲"
        spellCheck={false}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          onChange(event.currentTarget.value);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          if (!composing.current) onChange(event.target.value);
        }}
      />
      {(open || value) && (
        <button
          type="button"
          className="library-search-close"
          aria-label={draft ? '清除搜索' : '收起搜索'}
          title={draft ? '清除搜索' : '收起搜索'}
          onClick={() => {
            if (!draft) return close();
            setDraft('');
            onChange('');
            input.current?.focus();
          }}
        >
          <span className="material-icons-round" aria-hidden="true">
            close
          </span>
        </button>
      )}
    </div>
  );
}
