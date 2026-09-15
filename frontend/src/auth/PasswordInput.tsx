import { useRef, useState, type InputHTMLAttributes } from "react";

export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return <div className="relative">
    <input {...props} ref={input} type={visible ? "text" : "password"} className={`${props.className ?? "w-full rounded-lg border border-(--color-border) bg-(--color-bg) px-3 py-3"} pr-12`} />
    <button type="button" aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible}
      disabled={props.disabled} className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-current"
      onMouseDown={(event) => event.preventDefault()} onClick={() => { setVisible(!visible); input.current?.focus(); }}>
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
        {visible && <path d="m3 3 18 18" />}
      </svg>
    </button>
  </div>;
}
