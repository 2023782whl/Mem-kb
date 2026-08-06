import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";

type TooltipState = { label: string; left: number; top: number; align: "left" | "center" | "right" } | null;
const TARGET_SELECTOR = "button, a[href], [role='button'], summary";

function textLabel(element: HTMLElement): string {
  const explicit = element.getAttribute("title") || element.getAttribute("aria-label") || element.dataset.tooltip;
  const visible = element.innerText.replace(/\s+/g, " ").trim();
  return (explicit || visible).trim();
}

export function GlobalTooltip() {
  const { t } = useI18n();
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const timerRef = useRef<number | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const clear = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      targetRef.current = null;
      setTooltip(null);
    };
    const resolveTarget = (node: EventTarget | null) => node instanceof Element ? node.closest<HTMLElement>(TARGET_SELECTOR) : null;
    const show = (element: HTMLElement, immediate = false) => {
      if (targetRef.current === element) return;
      clear();
      let label = textLabel(element);
      if (!label) return;
      const title = element.getAttribute("title");
      if (title) {
        element.dataset.tooltip = title;
        if (!element.getAttribute("aria-label") && !element.innerText.trim()) element.setAttribute("aria-label", title);
        element.removeAttribute("title");
      }
      if ((element as HTMLButtonElement).disabled) label = `${label}（${t("当前不可用")}）`;
      targetRef.current = element;
      timerRef.current = window.setTimeout(() => {
        const rect = element.getBoundingClientRect();
        const center = rect.left + rect.width / 2;
        const align = center > window.innerWidth - 180 ? "right" : center < 180 ? "left" : "center";
        setTooltip({
          label,
          left: align === "right" ? Math.min(window.innerWidth - 12, rect.right) : align === "left" ? Math.max(12, rect.left) : center,
          top: Math.min(window.innerHeight - 12, rect.bottom + 9),
          align,
        });
      }, immediate ? 0 : 400);
    };
    const onPointerOver = (event: PointerEvent) => {
      const target = resolveTarget(event.target);
      if (target) show(target);
    };
    const onPointerMove = (event: PointerEvent) => {
      const target = resolveTarget(event.target);
      if (target && targetRef.current !== target) show(target);
    };
    const onPointerOut = (event: PointerEvent) => {
      const current = targetRef.current;
      if (!current) return;
      if (event.relatedTarget instanceof Node && current.contains(event.relatedTarget)) return;
      clear();
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = resolveTarget(event.target);
      if (target) show(target, true);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") clear();
    };
    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerout", onPointerOut, true);
    document.addEventListener("click", clear, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", clear, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", clear, true);
    window.addEventListener("resize", clear);
    return () => {
      clear();
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerout", onPointerOut, true);
      document.removeEventListener("click", clear, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", clear, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", clear, true);
      window.removeEventListener("resize", clear);
    };
  }, [t]);

  if (!tooltip) return null;
  return createPortal(
    <div className={`global-tooltip align-${tooltip.align}`} role="tooltip" style={{ left: tooltip.left, top: tooltip.top }}>{tooltip.label}</div>,
    document.body,
  );
}
