'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, GripHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Gap kept between the panel and its container's edges. */
const MARGIN = 12;

interface Position {
  x: number;
  y: number;
}

/** What is remembered per panel: where it sits, and whether it is rolled up. */
interface PanelState extends Position {
  collapsed: boolean;
}

/**
 * A floating panel the reader can pick up and put somewhere else.
 *
 * It exists because the thing underneath matters. A sector list pinned to the
 * edge of a map covers whichever part of the town happens to be behind it, and
 * the parcel a clerk needs to see is as likely to be there as anywhere — on a
 * fixed rail the only remedy is to pan the map, which moves the thing they were
 * looking at. Letting the panel move instead is the smaller adjustment.
 *
 * Pointer events rather than mouse events, so a finger on a tablet drags it the
 * same way a mouse does; this portal is used at a counter as often as at a
 * desk. `setPointerCapture` is what keeps a fast drag from escaping the handle
 * — without it, moving the pointer faster than React re-renders drops the
 * gesture the moment the cursor leaves the few pixels of the grip.
 *
 * It also rolls up to just its bar, which is the answer when the question is
 * "what is under it *everywhere*" rather than "what is under it here".
 *
 * Both — where it sits and whether it is rolled up — are remembered per
 * `storageKey`. They are working preferences, and restoring them costs one
 * localStorage read.
 */
export function DraggablePanel({
  storageKey,
  title,
  children,
  className,
  /** Extra controls in the drag bar, beside the title. */
  actions,
}: {
  storageKey: string;
  title: string;
  children: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(null);
  /**
   * Rolled up to just its bar.
   *
   * Moving the panel answers "what is under it here"; collapsing answers "what
   * is under it everywhere", which is the question when reading the map rather
   * than working a sector. Dragging it off-screen would do the same job and
   * lose the panel, so this is the one that can be undone.
   */
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  /** The container's viewport origin, captured once per drag. */
  const parentOrigin = useRef<Position>({ x: 0, y: 0 });
  /** Where inside the panel the pointer went down, so it does not jump. */
  const grabOffset = useRef<Position>({ x: 0, y: 0 });

  /**
   * Keeps the panel inside its container.
   *
   * Applied on drag *and* on resize, because a panel parked against the right
   * edge of a wide window is off-screen entirely once that window is narrowed —
   * and a panel nobody can reach cannot be dragged back.
   */
  const clamp = useCallback((next: Position): Position => {
    const panel = panelRef.current;
    const parent = panel?.offsetParent as HTMLElement | null;
    if (!panel || !parent) return next;
    return {
      x: Math.min(Math.max(next.x, MARGIN), Math.max(parent.clientWidth - panel.offsetWidth - MARGIN, MARGIN)),
      y: Math.min(Math.max(next.y, MARGIN), Math.max(parent.clientHeight - panel.offsetHeight - MARGIN, MARGIN)),
    };
  }, []);

  // Initial placement: the remembered spot, or the container's reading-start
  // corner. Measured in an effect because it needs the rendered width, and
  // resolved to physical x/y so the drag maths never has to ask about
  // direction again.
  useEffect(() => {
    const panel = panelRef.current;
    const parent = panel?.offsetParent as HTMLElement | null;
    if (!panel || !parent) return;

    let restored: Position | null = null;
    try {
      const raw = localStorage.getItem(`mechanization.panel.${storageKey}`);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof (parsed as Position).x === 'number' &&
        typeof (parsed as Position).y === 'number'
      ) {
        restored = parsed as Position;
        // Absent in entries written before this panel could collapse, so it is
        // read defensively rather than assumed present.
        if (typeof (parsed as PanelState).collapsed === 'boolean') {
          setCollapsed((parsed as PanelState).collapsed);
        }
      }
    } catch {
      /* fall through to the default corner */
    }

    const isRtl = getComputedStyle(panel).direction === 'rtl';
    setPosition(
      clamp(
        restored ?? {
          x: isRtl ? parent.clientWidth - panel.offsetWidth - MARGIN : MARGIN,
          y: MARGIN,
        },
      ),
    );
  }, [storageKey, clamp]);

  useEffect(() => {
    const onResize = () => setPosition((current) => (current ? clamp(current) : current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp]);

  /** One entry holds both facts, so neither write can clobber the other. */
  const remember = useCallback(
    (at: Position, isCollapsed: boolean) => {
      try {
        localStorage.setItem(
          `mechanization.panel.${storageKey}`,
          JSON.stringify({ ...at, collapsed: isCollapsed } satisfies PanelState),
        );
      } catch {
        /* the panel still behaves as asked for this page load */
      }
    },
    [storageKey],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Only the primary button drags; a right-click should open a menu, not
    // pick the panel up.
    if (event.button !== 0) return;
    const panel = panelRef.current;
    const parent = panel?.offsetParent as HTMLElement | null;
    if (!panel || !parent) return;

    const parentBox = parent.getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    grabOffset.current = {
      x: event.clientX - panelBox.left,
      y: event.clientY - panelBox.top,
    };
    // Stored so `onPointerMove` does not re-measure the container on every
    // frame of the drag.
    parentOrigin.current = { x: parentBox.left, y: parentBox.top };

    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };


  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setPosition(
      clamp({
        x: event.clientX - parentOrigin.current.x - grabOffset.current.x,
        y: event.clientY - parentOrigin.current.y - grabOffset.current.y,
      }),
    );
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // Written on release rather than on every move: a drag is a hundred
    // pointer events, and a hundred synchronous localStorage writes is the
    // one thing that would make this gesture feel slow.
    setPosition((current) => {
      if (current) remember(current, collapsed);
      return current;
    });
  };


  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    if (position) remember(position, next);
    /*
     * Re-clamped after the height changes, on the next frame so the new height
     * has been laid out. Expanding a panel parked low on the map would
     * otherwise push its body below the bottom edge, out of reach — the same
     * problem the resize handler exists to prevent, arriving from the other
     * direction.
     */
    requestAnimationFrame(() => {
      setPosition((current) => (current ? clamp(current) : current));
    });
  };

  return (
    <div
      ref={panelRef}
      className={cn(
        'absolute z-20 flex max-h-[calc(100%-1.5rem)] w-72 flex-col overflow-hidden rounded-xl border bg-card shadow-lg',
        // Hidden until measured, so it does not appear in the corner and jump.
        position ? 'visible' : 'invisible',
        dragging && 'select-none shadow-2xl ring-2 ring-primary/30',
        className,
      )}
      style={{ left: position?.x ?? 0, top: position?.y ?? 0 }}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={cn(
          'flex shrink-0 items-center gap-2 border-b bg-muted/40 px-3 py-2',
          dragging ? 'cursor-grabbing' : 'cursor-grab',
          // The browser's own panning would otherwise win on a touch screen and
          // scroll the page instead of moving the panel.
          'touch-none',
        )}
      >
        <GripHorizontal className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</p>
        {/*
          `stopPropagation` on pointer-down, not a later sibling: a button
          inside the drag surface would otherwise begin a one-pixel drag on
          press and swallow the click that was meant for it.
        */}
        <div
          className="flex shrink-0 items-center gap-1"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {actions}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'إظهار المحتوى' : 'إخفاء المحتوى'}
            title={collapsed ? 'إظهار المحتوى' : 'إخفاء المحتوى'}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {/* Open eye means "shown, press to hide" — the same pairing the
                password fields in this portal already use. */}
            {collapsed ? (
              <Eye className="size-4" aria-hidden />
            ) : (
              <EyeOff className="size-4" aria-hidden />
            )}
          </button>
        </div>
      </div>

      {/*
        Unmounted rather than hidden. The body of this panel is a live list —
        collapsing it should stop it costing anything, and a `hidden` subtree
        still holds every row's DOM and every handler on it.
      */}
      {collapsed ? null : children}
    </div>
  );
}
