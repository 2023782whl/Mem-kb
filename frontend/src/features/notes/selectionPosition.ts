export interface ViewportBox { width: number; height: number; offsetLeft?: number; offsetTop?: number }
export interface Point { left: number; top: number }

export function placeSelectionAction(
  start: { left: number; right: number; top: number; bottom: number },
  end: { left: number; right: number; top: number; bottom: number },
  viewport: ViewportBox,
  button = { width: 126, height: 36 }
): Point {
  const offsetLeft = viewport.offsetLeft || 0;
  const offsetTop = viewport.offsetTop || 0;
  const minLeft = offsetLeft + 10;
  const maxLeft = offsetLeft + viewport.width - button.width - 10;
  const center = (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2;
  const left = Math.max(minLeft, Math.min(center - button.width / 2, maxLeft));
  const selectionTop = Math.min(start.top, end.top);
  const selectionBottom = Math.max(start.bottom, end.bottom);
  const above = selectionTop - button.height - 9;
  const top = above >= offsetTop + 8
    ? above
    : Math.min(selectionBottom + 9, offsetTop + viewport.height - button.height - 8);
  return { left: Math.round(left), top: Math.round(top) };
}
