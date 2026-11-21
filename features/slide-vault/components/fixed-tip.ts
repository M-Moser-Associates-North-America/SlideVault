import { workspaceBounds } from './size';

/**
 * One small note drawn at the top of the feature and fixed to the screen, so a card's edge or a scrolling
 * row can never cut it off. It sits above the thing it names, or below when there is no room above.
 * Used for cut-off tag names (hover or focus) and for long-press notes on touch screens.
 */
let tip: HTMLDivElement | null = null;
let listening = false;
let owner: HTMLElement | null = null;
let watch: number | undefined;

export function hideTip() {
  if (tip) tip.style.visibility = 'hidden';
  owner = null;
  window.clearInterval(watch);
}

export function showTip(target: HTMLElement, text: string) {
  const root = target.closest<HTMLElement>('.slidevault');
  if (!root || !text) return;
  if (!tip || !root.contains(tip)) {
    tip = document.createElement('div');
    tip.className = 'sv-fixed-tip';
    tip.setAttribute('aria-hidden', 'true');
    root.appendChild(tip);
  }
  if (!listening) {
    listening = true;
    window.addEventListener('scroll', hideTip, true);
    /* Any click, tap or key press (opening another page, a tab, a dialog) puts the note away. */
    document.addEventListener('pointerdown', hideTip, true);
    document.addEventListener('keydown', hideTip, true);
  }
  tip.textContent = text;
  tip.style.visibility = 'hidden';
  const note = tip;
  const place = () => {
    const r = target.getBoundingClientRect();
    const w = note.offsetWidth;
    const h = note.offsetHeight;
    const area = workspaceBounds(target);
    const left = Math.min(Math.max(area.left + 8, r.left + r.width / 2 - w / 2), area.right - w - 8);
    const top = r.top - h - 8 >= area.top + 8 ? r.top - h - 8 : r.bottom + 8;
    note.style.left = `${left}px`;
    note.style.top = `${top}px`;
  };
  place();
  tip.style.visibility = 'visible';
  /* A card lifts a few pixels while the pointer settles on it, so the thing the note names is still moving when the note first appears. Follow it for a moment so the note ends up at the same height every time. */
  let frames = 0;
  const follow = () => {
    if (owner !== target || !note.isConnected) return;
    place();
    if (++frames < 24) requestAnimationFrame(follow);
  };
  requestAnimationFrame(follow);
  /* If the thing it names leaves the page (a new page has replaced it), the note goes too. */
  owner = target;
  window.clearInterval(watch);
  watch = window.setInterval(() => {
    if (!owner || !owner.isConnected) hideTip();
  }, 200);
}

/**
 * Touch screens cannot hover, so a long press (about half a second) on anything with a note (data-tip)
 * shows that note, and the press does not also click. The note goes away after a moment or on the next touch.
 */
export function installLongPressTips(): () => void {
  let timer: number | undefined;
  let hideTimer: number | undefined;
  let start: { x: number; y: number } | null = null;
  let shown = false;
  const clear = () => {
    window.clearTimeout(timer);
    start = null;
  };
  const down = (e: PointerEvent) => {
    window.clearTimeout(hideTimer);
    if (e.pointerType !== 'touch') return;
    hideTip();
    shown = false;
    /* data-tip: a note the page may also draw in place (and which this draws when it hides that). data-fixed-tip: a note drawn only here, above the page, so a card's edge cannot cut it off. */
    const el = (e.target as Element | null)?.closest<HTMLElement>('.slidevault :is([data-tip], [data-fixed-tip])');
    if (!el) return;
    const text = el.getAttribute('data-tip') ?? el.getAttribute('data-fixed-tip');
    if (!text) return;
    start = { x: e.clientX, y: e.clientY };
    timer = window.setTimeout(() => {
      shown = true;
      showTip(el, text);
      hideTimer = window.setTimeout(hideTip, 2600);
      start = null;
    }, 650);
  };
  const move = (e: PointerEvent) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) clear();
  };
  /* Only things that do nothing when pressed (the little "i", a disabled button) lose their click after a long press; a button or link that does something still does it, so a slow tap is never lost (the card's tick and heart are the exception: they are quick toggles, so reading their note does not switch them). */
  const click = (e: MouseEvent) => {
    if (!shown) return;
    shown = false;
    const el = (e.target as Element | null)?.closest<HTMLElement>('.slidevault :is([data-tip], [data-fixed-tip])');
    /* The card's tick and heart are quick toggles: a long press that read their note must not also switch them. */
    if (el && (el.getAttribute('aria-disabled') === 'true' || el.matches('.row-info, .helpdot, .pick, .save-tg'))) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  /* A mouse on a narrow window: where the page hides its own hover note (it would not fit), show it the same way. */
  let hovered: HTMLElement | null = null;
  const over = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const el = (e.target as Element | null)?.closest<HTMLElement>('.slidevault :is([data-tip], [data-fixed-tip])');
    if (el === hovered) return;
    hovered = el ?? null;
    if (!el) return hideTip();
    const own = el.getAttribute('data-fixed-tip');
    const text = el.getAttribute('data-tip') ?? own;
    /* The preview's deck arrows on phones and tablets hide their label on purpose; don't bring it back on hover. */
    if (el.closest('.lb-row[data-handheld]')) return hideTip();
    if (text && (own !== null || getComputedStyle(el, '::after').display === 'none')) showTip(el, text);
  };
  const out = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    if (hovered && !(e.relatedTarget instanceof Node && hovered.contains(e.relatedTarget))) {
      hovered = null;
      hideTip();
    }
  };
  const menu = (e: Event) => {
    if ((e.target as Element | null)?.closest('.slidevault :is([data-tip], [data-fixed-tip])')) e.preventDefault();
  };
  document.addEventListener('pointerdown', down, true);
  document.addEventListener('pointermove', move, true);
  document.addEventListener('pointerup', clear, true);
  document.addEventListener('pointercancel', clear, true);
  document.addEventListener('click', click, true);
  document.addEventListener('contextmenu', menu, true);
  document.addEventListener('pointerover', over, true);
  document.addEventListener('pointerout', out, true);
  return () => {
    clear();
    window.clearTimeout(hideTimer);
    document.removeEventListener('pointerdown', down, true);
    document.removeEventListener('pointermove', move, true);
    document.removeEventListener('pointerup', clear, true);
    document.removeEventListener('pointercancel', clear, true);
    document.removeEventListener('click', click, true);
    document.removeEventListener('contextmenu', menu, true);
    document.removeEventListener('pointerover', over, true);
    document.removeEventListener('pointerout', out, true);
  };
}
