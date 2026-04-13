"use client";

import { useId, type ReactNode } from "react";

type Props = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** Slightly smaller box + label for dense UIs (e.g. day chips). */
  size?: "sm" | "md";
};

export function ClasherCheckbox({
  checked,
  onChange,
  children,
  disabled,
  className = "",
  id: idProp,
  size = "md",
}: Props) {
  const uid = useId();
  const id = idProp ?? uid;

  const box =
    size === "sm"
      ? "h-4 w-4 rounded-sm shadow-[1px_1px_0_0_#18181b] peer-checked:shadow-[1px_1px_0_0_#18181b]"
      : "h-[18px] w-[18px] rounded shadow-[2px_2px_0_0_#18181b] peer-checked:shadow-[2px_2px_0_0_#18181b]";

  const icon = size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5";

  const labelText =
    size === "sm" ? "text-xs font-medium text-zinc-800" : "text-sm font-medium text-zinc-800";

  return (
    <label
      htmlFor={id}
      className={`group inline-flex cursor-pointer items-center gap-3 select-none ${
        disabled ? "cursor-not-allowed opacity-45" : ""
      } ${className}`}
    >
      <input
        id={id}
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className={`flex shrink-0 items-center justify-center border-2 border-zinc-900 bg-white transition-colors group-hover:bg-zinc-50 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-indigo-500 peer-checked:border-zinc-900 peer-checked:bg-indigo-600 peer-checked:group-hover:bg-indigo-600 peer-checked:[&_svg]:opacity-100 peer-disabled:bg-zinc-100 ${box}`}
      >
        <svg
          viewBox="0 0 12 10"
          className={`${icon} text-white opacity-0 transition-opacity duration-150`}
          stroke="currentColor"
          fill="none"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M1 5l3 3 7-7" />
        </svg>
      </span>
      {children != null ? (
        <span className={labelText}>{children}</span>
      ) : null}
    </label>
  );
}
