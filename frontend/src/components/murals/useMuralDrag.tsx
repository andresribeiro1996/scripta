import { KeyboardSensor, PointerSensor, useDraggable, useSensor, useSensors, type DragMoveEvent, type Modifier } from "@dnd-kit/core";
import { GRID_COLUMNS, moveMuralBlock, type BlockLayout, type MuralBlock } from "@scripta/shared";
import { useCallback, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";

export function useMuralDrag(blocks: MuralBlock[], canvas: RefObject<HTMLDivElement | null>, onDrop?: (id: string, layout: BlockLayout) => void, scale = 1, onDragChange?: (dragging: boolean) => void) {
  const [drop, setDrop] = useState<{ id: string; layout: BlockLayout } | null>(null);
  const origin = useRef<MuralBlock | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { scrollBehavior: "auto", coordinateGetter: (event, { currentCoordinates }) => {
      const stepX = ((canvas.current?.getBoundingClientRect().width ?? 1200) - 10 * scale) / GRID_COLUMNS;
      const stepY = 38 * scale;
      const steps: Record<string, [number, number]> = { ArrowLeft: [-stepX, 0], ArrowRight: [stepX, 0], ArrowUp: [0, -stepY], ArrowDown: [0, stepY] };
      const step = steps[event.code];
      if (!step) return;
      event.preventDefault();
      return { x: currentCoordinates.x + step[0], y: currentCoordinates.y + step[1] };
    } })
  );
  function candidate(event: DragMoveEvent) {
    const block = origin.current;
    const canvasRect = canvas.current?.getBoundingClientRect();
    const blockRect = (event.active.data.current?.node as RefObject<HTMLDivElement | null> | undefined)?.current?.getBoundingClientRect();
    if (!block || !canvasRect || !blockRect) return null;
    const stepX = (canvasRect.width / scale - 10) / GRID_COLUMNS;
    return {
      id: block.id,
      layout: {
        ...block.layout,
        x: Math.max(0, Math.min(GRID_COLUMNS - block.layout.w, Math.round(((blockRect.left - canvasRect.left) / scale - 10) / stepX))),
        y: Math.max(0, Math.round(((blockRect.top - canvasRect.top) / scale - 10) / 38))
      }
    };
  }
  const preview = drop ? moveMuralBlock(blocks, drop.id, drop.layout) : blocks;
  return {
    drop: drop ? { ...drop, layout: preview.find((block) => block.id === drop.id)!.layout } : null,
    blocks: preview.map((block) => block.id === drop?.id ? { ...block, layout: blocks.find((item) => item.id === block.id)!.layout } : block),
    context: {
      sensors,
      modifiers: [(({ transform, activeNodeRect }) => {
        const bounds = canvas.current?.getBoundingClientRect();
        if (!bounds || !activeNodeRect) return transform;
        return { ...transform, x: Math.max(bounds.left + 10 * scale - activeNodeRect.left, Math.min(bounds.right - 10 * scale - activeNodeRect.right, transform.x)) };
      }) satisfies Modifier],
      autoScroll: { threshold: { x: 0, y: 0.15 }, layoutShiftCompensation: false },
      onDragStart: ({ active }: { active: { id: string | number } }) => {
        onDragChange?.(true);
        origin.current = blocks.find((block) => block.id === active.id) ?? null;
        if (origin.current) setDrop({ id: origin.current.id, layout: origin.current.layout });
      },
      onDragMove: (event: DragMoveEvent) => {
        const next = candidate(event);
        setDrop((previous) => previous?.id === next?.id && previous?.layout.x === next?.layout.x && previous?.layout.y === next?.layout.y ? previous : next);
      },
      onDragEnd: (event: DragMoveEvent) => {
        const next = candidate(event);
        onDragChange?.(false);
        setDrop(null);
        origin.current = null;
        if (next) onDrop?.(next.id, next.layout);
      },
      onDragCancel: () => { onDragChange?.(false); setDrop(null); origin.current = null; }
    }
  };
}

export function DraggableMuralBlock({ id, disabled, scale = 1, children }: { id: string; disabled: boolean; scale?: number; children: ReactNode }) {
  const node = useRef<HTMLDivElement | null>(null);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, disabled, data: { node } });
  const setRef = useCallback((element: HTMLDivElement | null) => { node.current = element; setNodeRef(element); }, [setNodeRef]);
  return <div
    ref={setRef}
    {...(disabled ? {} : attributes)}
    {...(disabled ? {} : listeners)}
    onPointerDown={(event) => {
      if ((event.target as Element).closest(".mural-block-controls, .react-resizable-handle, button, input, textarea, a")) return;
      listeners?.onPointerDown?.(event);
    }}
    aria-label={disabled ? undefined : "Move block"}
    className={`h-full w-full rounded-[inherit] ${disabled ? "" : "touch-none cursor-grab"}`}
    style={{ position: "relative", zIndex: isDragging ? 10 : undefined, transform: transform ? `translate3d(${transform.x / scale}px, ${transform.y / scale}px, 0)` : undefined, opacity: isDragging ? 0.75 : 1 } as CSSProperties}
  >{children}</div>;
}
