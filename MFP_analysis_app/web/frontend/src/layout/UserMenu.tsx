import {
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { useTheme, ThemeName } from "../theme/ThemeProvider";

export interface AppUser {
  name: string;
  /** Free-form secondary line — e.g. phone number, email, role. */
  secondary?: string;
  /** Optional avatar URL. When missing we render the initials fallback. */
  avatarUrl?: string;
  /** Optional status dot on the avatar. "online" renders a green dot. */
  presence?: "online" | "away" | "busy" | "offline";
}

/**
 * Sidebar footer: avatar button + popover with user info and menu items.
 *
 * The popover renders via a portal into `document.body`, anchored to the
 * avatar button, so it works in both the pinned sidebar (w-64) and the
 * collapsed rail (w-14) without being clipped by `overflow-hidden`.
 */
export function UserMenu({
  user,
  expanded,
}: {
  user: AppUser;
  expanded: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (triggerRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <div
      className="shrink-0 border-t border-ink-200/40"
      style={{ backgroundColor: "rgb(var(--surface))" }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={expanded ? undefined : `${user.name}${user.secondary ? ` — ${user.secondary}` : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={clsx(
          "flex w-full items-center gap-2.5 transition-colors hover:bg-ink-100/50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
          expanded ? "px-3 py-2.5" : "justify-center px-2 py-2.5",
        )}
      >
        <Avatar user={user} size="sm" withPresence />
        {expanded && (
          <>
            <div className="min-w-0 flex-1 text-left">
              <div className="truncate text-[13px] font-semibold text-ink-900">
                {user.name}
              </div>
              {user.secondary && (
                <div className="truncate text-[11px] text-ink-500">
                  {user.secondary}
                </div>
              )}
            </div>
            <IconChevronUpDown className="h-3.5 w-3.5 shrink-0 text-ink-400" />
          </>
        )}
      </button>

      {open && (
        <UserMenuPopover
          popoverRef={popoverRef}
          anchor={triggerRef}
          user={user}
          onClose={close}
        />
      )}
    </div>
  );
}

// --------------------------- popover (portal) ---------------------------

interface PopoverProps {
  anchor: React.RefObject<HTMLElement>;
  popoverRef: React.RefObject<HTMLDivElement>;
  user: AppUser;
  onClose: () => void;
}

function UserMenuPopover({ anchor, popoverRef, user, onClose }: PopoverProps) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const POPOVER_WIDTH = 296;
  const GAP = 8;

  const position = useCallback(() => {
    const el = anchor.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    // Prefer to open above the trigger (the trigger sits at the bottom of
    // the sidebar); if there isn't room above, fall back to below it.
    const popoverEl = popoverRef.current;
    const popoverHeight = popoverEl?.offsetHeight ?? 420;

    const spaceAbove = rect.top;
    const openUpward = spaceAbove > popoverHeight + GAP + 8;

    let top = openUpward
      ? rect.top - popoverHeight - GAP
      : rect.bottom + GAP;

    // Clamp vertically to the viewport.
    top = Math.max(8, Math.min(top, window.innerHeight - popoverHeight - 8));

    // Anchor horizontally to the trigger's left edge; if the sidebar is in
    // its collapsed state, push the popover to the right of the trigger
    // instead so it doesn't sit on top of the rail.
    let left: number;
    if (rect.width < 80) {
      left = rect.right + GAP;
    } else {
      left = rect.left;
    }

    // Clamp horizontally to the viewport.
    left = Math.max(8, Math.min(left, window.innerWidth - POPOVER_WIDTH - 8));

    setCoords({ top, left });
  }, [anchor, popoverRef]);

  useLayoutEffect(() => {
    position();
    // Second pass once the element is mounted so we can use its real height.
    const id = window.requestAnimationFrame(() => {
      position();
      setMounted(true);
    });
    return () => window.cancelAnimationFrame(id);
  }, [position]);

  useEffect(() => {
    const onResize = () => position();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [position]);

  const handleItemClick = useCallback(
    (_label: string) => {
      // Stubs for now — wire to real actions when those features land.
      onClose();
    },
    [onClose],
  );

  return createPortal(
    <div
      ref={popoverRef}
      role="menu"
      aria-label="User menu"
      style={{
        position: "fixed",
        top: coords?.top ?? -9999,
        left: coords?.left ?? -9999,
        width: POPOVER_WIDTH,
        zIndex: 50,
        backgroundColor: "rgb(var(--surface-raised))",
        border: "1px solid rgb(var(--ink-200) / 0.5)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)",
      }}
      className={clsx(
        "rounded-[10px]",
        "transition-[opacity,transform] duration-150 ease-out",
        mounted ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
      )}
    >
      <div className="flex items-center gap-3 px-3.5 pb-3 pt-3.5">
        <Avatar user={user} size="lg" withPresence />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-ink-900">
            {user.name}
          </div>
          {user.secondary && (
            <div className="truncate text-[12px] text-ink-500">{user.secondary}</div>
          )}
        </div>
      </div>

      <DividerThin />

      <div className="p-1">
        <MenuRow
          onClick={() => handleItemClick("My settings")}
          icon={<IconSliders className="h-[17px] w-[17px] shrink-0 text-ink-500" />}
        >
          <span className="text-[13px] text-ink-800">My settings</span>
        </MenuRow>

        <MenuRow
          onClick={() => handleItemClick("Administration")}
          icon={<IconShield className="h-[17px] w-[17px] shrink-0 text-ink-500" />}
        >
          <span className="text-[13px] text-ink-800">Administration</span>
        </MenuRow>
      </div>

      <DividerThin />

      <div className="p-1">
        <ThemeSubmenu />
      </div>

      <DividerThin />

      <div className="p-1 pb-1.5">
        <MenuRow
          onClick={() => handleItemClick("Sign out")}
          icon={<IconSignOut className="h-[17px] w-[17px] shrink-0 text-red-500" />}
          danger
        >
          <span className="text-[13px] font-medium text-red-500">Sign out</span>
        </MenuRow>
      </div>
    </div>,
    document.body,
  );
}

// --------------------------- shared bits ---------------------------

function DividerThin() {
  return <div className="h-px bg-ink-200/40" role="presentation" />;
}

/**
 * Expandable theme picker rendered inside the user-menu popover.
 *
 * The header row behaves like the other `MenuRow`s (icon + label + chevron)
 * except that:
 *   - the trailing chevron rotates 90° when the section is open,
 *   - the current theme label is shown on the right in ink-500,
 *   - tapping the row toggles the three theme options below it.
 *
 * Picking an option calls `useTheme().setTheme(...)` immediately, which
 * updates `<html data-theme="…">` and persists the choice to localStorage;
 * the popover stays open so the user can see the effect ripple through the
 * app before closing.
 */
function ThemeSubmenu() {
  const { theme, setTheme, themes } = useTheme();
  const [open, setOpen] = useState(false);
  const current = themes.find((t) => t.id === theme) ?? themes[0];

  return (
    <div>
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-[7px] text-left",
          "transition-colors hover:bg-ink-100/60",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
        )}
      >
        <IconTheme className="h-[17px] w-[17px] shrink-0 text-ink-500" />
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink-800">
          Theme
        </span>
        <span className="shrink-0 truncate text-[11px] text-ink-500">
          {current.label}
        </span>
        <IconChevronRight
          className={clsx(
            "h-3.5 w-3.5 shrink-0 text-ink-400 transition-transform duration-150",
            open && "rotate-90",
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Theme"
          className="mt-0.5 flex flex-col gap-px pl-1.5"
        >
          {themes.map((opt) => {
            const active = opt.id === theme;
            return (
              <button
                key={opt.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => setTheme(opt.id)}
                className={clsx(
                  "flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-[6px] text-left",
                  "transition-colors",
                  active
                    ? "bg-brand-500/10 text-brand-600"
                    : "text-ink-800 hover:bg-ink-100/60",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
                )}
              >
                <ThemeSwatch theme={opt.id} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">
                    {opt.label}
                  </span>
                  <span className="block text-[11px] text-ink-500">
                    {opt.description}
                  </span>
                </span>
                {active ? (
                  <IconCheck className="h-3.5 w-3.5 shrink-0 text-brand-600" />
                ) : (
                  <span className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Tiny round "chip" showing what the theme looks like. We draw it from
 * fixed colors (not CSS vars) so the swatch always previews the target
 * theme, regardless of which theme is currently active.
 */
function ThemeSwatch({ theme }: { theme: ThemeName }) {
  const palette: Record<ThemeName, { bg: string; fg: string; accent: string }> = {
    day: { bg: "#ffffff", fg: "#0f1420", accent: "#5573b9" },
    night: { bg: "#001a37", fg: "#d9e6ff", accent: "#7694ce" },
    "night-vision": { bg: "#120606", fg: "#ffafaa", accent: "#d23c3c" },
  };
  const p = palette[theme];
  return (
    <span
      aria-hidden="true"
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-ink-200"
      style={{ backgroundColor: p.bg }}
    >
      <span
        className="h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: p.accent, boxShadow: `inset 0 0 0 1px ${p.fg}22` }}
      />
    </span>
  );
}

function MenuRow({
  children,
  onClick,
  icon,
  hasSubmenu,
  danger,
}: {
  children: ReactNode;
  onClick?: () => void;
  icon?: ReactNode;
  hasSubmenu?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={clsx(
        "flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-[7px] text-left",
        "transition-colors",
        danger ? "hover:bg-red-500/10" : "hover:bg-ink-100/60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hasSubmenu && <IconChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-400" />}
    </button>
  );
}

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  user,
  size,
  withPresence,
}: {
  user: AppUser;
  size: "sm" | "lg";
  withPresence?: boolean;
}) {
  const initials = useMemo(() => initialsFrom(user.name), [user.name]);
  const [imgOk, setImgOk] = useState(true);

  const sizeCls =
    size === "lg"
      ? "h-12 w-12 text-base"
      : "h-8 w-8 text-[11px]";
  const dotCls =
    size === "lg"
      ? "h-3 w-3 border-2 bottom-0 right-0"
      : "h-2.5 w-2.5 border-2 bottom-0 right-0";

  return (
    <div className={clsx("relative shrink-0", sizeCls)}>
      {user.avatarUrl && imgOk ? (
        <img
          src={user.avatarUrl}
          alt={user.name}
          onError={() => setImgOk(false)}
          className="h-full w-full rounded-full object-cover"
        />
      ) : (
        <div
          aria-hidden="true"
          className="flex h-full w-full items-center justify-center rounded-full bg-brand-500 font-semibold text-white"
        >
          {initials}
        </div>
      )}
      {withPresence && user.presence && user.presence !== "offline" && (
        <span
          className={clsx(
            "absolute rounded-full border-white",
            dotCls,
            user.presence === "online" && "bg-emerald-500",
            user.presence === "away" && "bg-amber-500",
            user.presence === "busy" && "bg-red-500",
          )}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

// ------------------------------ icons ------------------------------

function strokeProps(className?: string) {
  return {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

function IconChevronRight({ className }: { className?: string }) {
  return (
    <svg {...strokeProps(className)}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function IconChevronUpDown({ className }: { className?: string }) {
  return (
    <svg {...strokeProps(className)}>
      <path d="M7 9l5 -5 5 5" />
      <path d="M7 15l5 5 5 -5" />
    </svg>
  );
}

function IconSliders({ className }: { className?: string }) {
  return (
    <svg {...strokeProps(className)}>
      <path d="M4 6h10" />
      <path d="M18 6h2" />
      <circle cx="16" cy="6" r="2" />
      <path d="M4 12h2" />
      <path d="M10 12h10" />
      <circle cx="8" cy="12" r="2" />
      <path d="M4 18h8" />
      <path d="M16 18h4" />
      <circle cx="14" cy="18" r="2" />
    </svg>
  );
}

function IconShield({ className }: { className?: string }) {
  return (
    <svg {...strokeProps(className)}>
      <path d="M12 3l8 3v6c0 4.5 -3.2 7.8 -8 9c-4.8 -1.2 -8 -4.5 -8 -9V6l8 -3z" />
      <path d="M9 12l2 2 4 -4" />
    </svg>
  );
}

function IconTheme({ className }: { className?: string }) {
  // Sun-like palette — a circle with short rays, echoing the theme chooser
  // in the reference screenshot.
  return (
    <svg {...strokeProps(className)}>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4 -1.4M17 7l1.4 -1.4" />
    </svg>
  );
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg {...strokeProps(className)}>
      <path d="M5 12l4 4L19 7" />
    </svg>
  );
}

function IconSignOut({ className }: { className?: string }) {
  return (
    <svg {...strokeProps(className)}>
      <path d="M9 21H6a2 2 0 0 1 -2 -2V5a2 2 0 0 1 2 -2h3" />
      <path d="M16 17l5 -5 -5 -5" />
      <path d="M21 12H9" />
    </svg>
  );
}
