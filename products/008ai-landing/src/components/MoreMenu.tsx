"use client";

import { useEffect, useRef, useState } from "react";
import { MoreVertical } from "lucide-react";

const MENU_ITEMS = [
  { label: "Buy Lifetime Pass", href: "#pricing" },
  { label: "Login / Account", href: "/admin" },
  { label: "Terms of Service", href: "#terms" },
  { label: "Privacy Policy", href: "#privacy" },
];

/**
 * 右上角“⋮”菜单：同页平滑跳转（target="_self" 默认）。
 */
export default function MoreMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="More options"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-pink-200/70 bg-white/70 text-ink backdrop-blur transition hover:border-pink-400 hover:bg-pink-50"
      >
        <MoreVertical className="h-5 w-5" />
      </button>
      {open && (
        <div className="absolute right-0 top-14 w-56 overflow-hidden rounded-2xl border border-pink-200/60 bg-white/95 p-1.5 shadow-xl shadow-pink-100/60 backdrop-blur-xl">
          {MENU_ITEMS.map((item) => (
            <a
              key={item.label}
              href={item.href}
              onClick={() => setOpen(false)}
              className="flex items-center rounded-xl px-4 py-2.5 text-sm font-semibold text-ink transition hover:bg-pink-50 hover:text-pink-600"
            >
              {item.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
