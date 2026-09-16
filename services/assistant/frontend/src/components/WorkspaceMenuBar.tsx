import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Generic menu-bar/sidebar primitives shared by the LaTeX Editor and the
 * Notes workspaces (Quick Notes / Documentation / Meeting Minutes) so the
 * 3-zone layout (menu bar + collapsible sidebar + editor body) isn't
 * reimplemented per view. LaTeX-specific menu content (Compile, git History,
 * templates) still lives in LatexMenuBar.tsx — this file only owns the shell.
 */

export type MenuId = string | null;

export type MenuItem =
  | {
      type: "item";
      label: string;
      shortcut?: string;
      disabled?: boolean;
      hint?: string;
      onClick: () => void;
    }
  | { type: "sep" };

export interface MenuConfig {
  id: string;
  label: string;
  items?: MenuItem[];
  panel?: ReactNode;
  align?: "left" | "right";
}

/**
 * Format-bar only: keep the editor focused.
 * Do not use on menus / Save / Share — preventDefault on pointerdown swallows
 * click, which Safari needs for file pickers and which makes buttons look dead.
 */
export function pressKeepFocus(handler: () => void) {
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const el = e.currentTarget as HTMLButtonElement;
      if (el.disabled) return;
      e.preventDefault();
      handler();
    },
  };
}

export function MenuDropdown({
  id,
  label,
  open,
  onOpen,
  items,
  align = "left",
  panel,
}: {
  id: MenuId;
  label: string;
  open: MenuId;
  onOpen: (id: MenuId) => void;
  items?: MenuItem[];
  align?: "left" | "right";
  panel?: ReactNode;
}) {
  const active = open === id;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!active || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const width = 240;
    let left = align === "right" ? r.right - width : r.left;
    left = Math.min(Math.max(8, left), window.innerWidth - width - 8);
    setPos({ top: r.bottom + 4, left });
  }, [active, align]);

  return (
    <div className={`latex-menu${active ? " open" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="latex-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={active}
        onClick={() => onOpen(active ? null : id)}
        onMouseEnter={() => {
          if (open) onOpen(id);
        }}
      >
        {label}
      </button>
      {active &&
        createPortal(
          <div
            className="latex-menu-dropdown"
            role="menu"
            style={{ top: pos.top, left: pos.left }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {panel
              ? panel
              : items?.map((item, i) =>
                  item.type === "sep" ? (
                    <div key={`sep-${i}`} className="latex-menu-sep" />
                  ) : (
                    <button
                      key={item.label}
                      type="button"
                      role="menuitem"
                      className="latex-menu-item"
                      disabled={item.disabled}
                      title={item.disabled ? item.hint : item.shortcut}
                      onClick={() => {
                        if (item.disabled) return;
                        item.onClick();
                        onOpen(null);
                      }}
                    >
                      <span>{item.label}</span>
                      {(item.disabled ? item.hint : item.shortcut) && (
                        <span className="latex-menu-shortcut">
                          {item.disabled ? item.hint : item.shortcut}
                        </span>
                      )}
                    </button>
                  )
                )}
          </div>,
          document.body
        )}
    </div>
  );
}

/** The [Editor] [Split] [View]/[PDF] segmented toggle on the right of the menu bar. */
export function ViewModeToggle<T extends string>({
  modes,
  active,
  onChange,
}: {
  modes: { id: T; label: string; title?: string }[];
  active: T;
  onChange: (mode: T) => void;
}) {
  return (
    <div className="latex-layout-seg" role="group" aria-label="Layout">
      {modes.map((m) => (
        <button
          key={m.id}
          type="button"
          className={`latex-layout-btn${active === m.id ? " active" : ""}`}
          title={m.title ?? m.label}
          aria-pressed={active === m.id}
          onClick={() => onChange(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** The standalone [Files] toggle button to the left of the layout segment. */
export function FilesToggleButton({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`latex-files-toggle${collapsed ? "" : " active"}`}
      title={collapsed ? "Show file tree" : "Hide file tree"}
      aria-pressed={!collapsed}
      onClick={onToggle}
    >
      Files
    </button>
  );
}

/**
 * Full menu-bar shell: File/Edit/Insert/View/Format/… dropdowns on the left,
 * an inline-editable filename + status message centered, and a right-side
 * action slot (Files toggle, layout segment, Save/Share/Compile buttons).
 * Manages its own open/close + outside-click/Escape state.
 */
export function WorkspaceMenuBar({
  menus,
  centerSlot,
  rightSlot,
  onMenuOpen,
}: {
  menus: MenuConfig[];
  centerSlot?: ReactNode;
  rightSlot?: ReactNode;
  onMenuOpen?: (id: MenuId) => void;
}) {
  const [open, setOpen] = useState<MenuId>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  function setOpenAndNotify(id: MenuId) {
    setOpen(id);
    onMenuOpen?.(id);
  }

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Node;
      // Bail only for a menu trigger (its own onClick toggles it) or a click
      // inside an open dropdown (item selection closes itself). Every other
      // click in the bar — Share/Save/Files toggle/layout segment/filename —
      // closes any open menu, same as an outside click.
      if (t instanceof Element && t.closest(".latex-menu")) return;
      if (t instanceof Element && t.closest(".latex-menu-dropdown")) return;
      setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="latex-menubar-wrap" ref={barRef}>
      <div className="latex-menubar">
        {menus.map((m) => (
          <MenuDropdown
            key={m.id}
            id={m.id}
            label={m.label}
            open={open}
            onOpen={setOpenAndNotify}
            items={m.items}
            align={m.align}
            panel={m.panel}
          />
        ))}
      </div>
      <div className="latex-toolbar-center">{centerSlot}</div>
      <div className="latex-toolbar-right">{rightSlot}</div>
    </div>
  );
}
