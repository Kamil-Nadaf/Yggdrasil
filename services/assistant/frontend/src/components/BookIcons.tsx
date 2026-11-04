import type { ReactNode } from "react";

const P: Record<string, ReactNode> = {
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l5 5" /></>,
  home: <path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />,
  goals: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></>,
  all: <><path d="M5 4v16M10 4v16" /><path d="M14.5 5.5l4.6-1.2 3 15.2-4.6 1.2z" /></>,
  want: <><circle cx="12" cy="12" r="8.5" /><path d="M8.5 12h7M12.5 8.5L16 12l-3.5 3.5" /></>,
  reading: <><path d="M12 6.5C10 5 7.5 4.6 4 5v13c3.5-.4 6 0 8 1.5 2-1.5 4.5-1.9 8-1.5V5c-3.5-.4-6 0-8 1.5z" /><path d="M12 6.5V19.5" /></>,
  finished: <><circle cx="12" cy="12" r="8.5" /><path d="M8.2 12.3l2.5 2.5 5-5.3" /></>,
  epub: <path d="M4 5.5C6.5 4.5 9.5 4.7 12 6.5c2.5-1.8 5.5-2 8-1v13c-2.5-1-5.5-.8-8 1-2.5-1.8-5.5-2-8-1z" />,
  pdf: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M9.5 12h5M9.5 15.5h5" /></>,
  list: <path d="M4 7h16M4 12h16M4 17h16" />,
  plus: <path d="M12 5v14M5 12h14" />,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /></>,
  star: <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9-4.3-4.1 5.9-.8z" />,
  tag: <><path d="M3.5 12.5V4.5h8l9 9-8 8z" /><circle cx="8" cy="9" r="1.2" /></>,
  dupes: <><rect x="8" y="8" width="12" height="12" rx="1.5" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" /></>,
  inbox: <><path d="M4 13l2.5-7h11L20 13v6H4z" /><path d="M4 13h5l1 2h4l1-2h5" /></>,
  sync: <><path d="M19.5 9A7.5 7.5 0 0 0 6 6.5L4 9" /><path d="M4 4.5V9h4.5" /><path d="M4.5 15A7.5 7.5 0 0 0 18 17.5L20 15" /><path d="M20 19.5V15h-4.5" /></>,
  rows: <><rect x="4" y="5" width="16" height="5" rx="1" /><rect x="4" y="14" width="16" height="5" rx="1" /></>,
};

export type BookIconName = keyof typeof P;

export default function BookIcon({ name, size = 20 }: { name: BookIconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  );
}
