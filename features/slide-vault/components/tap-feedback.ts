/**
 * Press feedback that lasts. On a touch screen a finger lifts before the next page has loaded, and a hover
 * style never shows at all, so nothing seems to have happened. This marks whatever was pressed (touch, pen,
 * or the Enter and Space keys) with `data-tapped` straight away and keeps it for a moment after the press,
 * so the pressed look (see the CSS) stays on until the page answers. Scrolling cancels it.
 */
const TARGET = 'a[href], button, [role="button"], [role="tab"], summary, label.pick';

export function installTapFeedback(): () => void {
  let marked: HTMLElement | null = null;
  let timer: number | undefined;
  let start: { x: number; y: number } | null = null;
  const unmark = () => {
    window.clearTimeout(timer);
    marked?.removeAttribute('data-tapped');
    marked = null;
  };
  const mark = (el: HTMLElement) => {
    if (marked && marked !== el) marked.removeAttribute('data-tapped');
    marked = el;
    el.setAttribute('data-tapped', '');
  };
  const hold = (ms: number) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(unmark, ms);
  };
  const find = (t: EventTarget | null) => {
    const el = (t as Element | null)?.closest<HTMLElement>(TARGET);
    if (!el || !el.closest('.slidevault') || el.matches(':disabled, [aria-disabled="true"]')) return null;
    return el;
  };
  const down = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    const el = find(e.target);
    if (!el) return unmark();
    start = { x: e.clientX, y: e.clientY };
    mark(el);
    hold(4000);
  };
  const move = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) {
      start = null;
      unmark();
    }
  };
  const click = (e: MouseEvent) => {
    /* A mouse already shows hover; the lasting pressed look is for touch and keyboard only. */
    if ((e as PointerEvent).pointerType === 'mouse') return;
    const el = find(e.target);
    if (!el) return;
    mark(el);
    hold(1200);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = find(e.target);
    if (!el) return;
    mark(el);
    hold(1200);
  };
  const cancel = () => {
    start = null;
  };
  document.addEventListener('pointerdown', down, true);
  document.addEventListener('pointermove', move, true);
  document.addEventListener('pointercancel', unmark, true);
  document.addEventListener('pointerup', cancel, true);
  document.addEventListener('click', click, true);
  document.addEventListener('keydown', key, true);
  return () => {
    unmark();
    document.removeEventListener('pointerdown', down, true);
    document.removeEventListener('pointermove', move, true);
    document.removeEventListener('pointercancel', unmark, true);
    document.removeEventListener('pointerup', cancel, true);
    document.removeEventListener('click', click, true);
    document.removeEventListener('keydown', key, true);
  };
}
