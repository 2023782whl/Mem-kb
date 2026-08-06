import { GripVertical } from "lucide-react";

export function ResizeHandle({ label, onDelta, onReset }: {
  label: string;
  onDelta: (delta: number) => void;
  onReset: () => void;
}) {
  function start(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    let previous = event.clientX;
    const move = (next: PointerEvent) => {
      onDelta(next.clientX - previous);
      previous = next.clientX;
    };
    const stop = () => {
      document.body.classList.remove("is-resizing-panes");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    document.body.classList.add("is-resizing-panes");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  }

  return (
    <div
      className="pane-resize-handle"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      tabIndex={0}
      onPointerDown={start}
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
