import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

const TOPBAR_PANEL_SLOT_ID = "topbar-panel-trigger-slot";

export function TopbarPanelTrigger({ label, expanded, onToggle }: { label: string; expanded: boolean; onToggle: () => void }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setTarget(document.getElementById(TOPBAR_PANEL_SLOT_ID));
  }, []);

  if (!target) return null;

  return createPortal(
    <button
      type="button"
      className="module-panel-trigger topbar-panel-trigger"
      onClick={onToggle}
      aria-label={label}
      aria-expanded={expanded}
      data-tooltip={label}
    >
      {expanded ? <PanelLeftClose /> : <PanelLeftOpen />}
    </button>,
    target
  );
}

export { TOPBAR_PANEL_SLOT_ID };
