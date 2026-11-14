/**
 * For a box that scrolls (a filter card, a menu): when its options don't all fit, pick a height that ends halfway
 * through an option, so the half-shown line tells people there is more below. Returns `room` unchanged when
 * everything fits or no option row can be found.
 */
export function peekHeight(box: HTMLElement, room: number): number {
  if (box.scrollHeight <= room + 1) return room;
  const base = box.getBoundingClientRect().top - box.scrollTop;
  const rows = [...box.querySelectorAll<HTMLElement>('label, li, [role="option"], .tag, button')]
    .map((r) => {
      const b = r.getBoundingClientRect();
      return { top: b.top - base, height: b.height };
    })
    .filter((r) => r.height >= 14 && r.height <= 80)
    .sort((a, b) => a.top - b.top);
  let cut = 0;
  for (const r of rows) {
    const middle = r.top + r.height / 2;
    if (middle <= room && r.top + r.height > room - r.height) cut = Math.max(cut, middle);
  }
  return cut > room * 0.5 ? Math.round(cut) : room;
}
