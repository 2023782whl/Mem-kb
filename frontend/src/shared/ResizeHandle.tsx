import { useRef } from "react";
import { GripVertical } from "lucide-react";

export function ResizeHandle({ label, onDelta, onReset }: {
  label: string;
  onDelta: (delta: number) => void;
  onReset: () => void;
}) {
  const activePointerId = useRef<number | null>(null);
  const previousX = useRef(0);

  function finish() {
    if (activePointerId.current === null) return;
    activePointerId.current = null;
    document.body.classList.remove("is-resizing-panes");
  }

  function start(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    activePointerId.current = event.pointerId;
    previousX.current = event.clientX;
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing-panes");
  }

  function move(event: React.PointerEvent<HTMLDivElement>) {
    if (activePointerId.current !== event.pointerId) return;
    const delta = event.clientX - previousX.current;
    if (!delta) return;
    previousX.current = event.clientX;
    onDelta(delta);
  }

  function stop(event: React.PointerEvent<HTMLDivElement>) {
    if (activePointerId.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    finish();
  }

  return (
    <div
      className="pane-resize-handle"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      tabIndex={0}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={finish}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          onDelta(event.key === "ArrowLeft" ? -16 : 16);
        }
        if (event.key === "Home") {
          event.preventDefault();
          onReset();
        }
      }}
      title={`${label}，双击恢复默认`}
    >
      <GripVertical aria-hidden="true" />
    </div>
  );
}
