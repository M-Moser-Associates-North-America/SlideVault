'use client';

import { useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Icon } from './icons';
import { useWorkspace } from './state';

export const TAG_MAX_LENGTH = 60;
export const TAG_MAX_COUNT = 10;

export type TagSuggestion = { tag: string; decks?: number; slides?: number };

/** One tag as typed: no leading #, one space between words, at most 60 characters. Empty when nothing is left. */
export function cleanTag(raw: string): string {
  return raw.replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, TAG_MAX_LENGTH);
}

/**
 * A tag box: type a word and press Enter or comma and it becomes a chip; tags already in the library are
 * offered as you type, so "healthcare" and "Health care" don't both appear. Backspace on an empty box
 * removes the last chip. Duplicates are ignored whatever the capital letters (the server does the same).
 */
export function TagField({
  label,
  hint,
  value,
  onChange,
  suggestions,
  disabled,
  compact,
  auto = [],
}: {
  label: string;
  hint?: string;
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions: TagSuggestion[];
  disabled?: boolean;
  /** Small, for a slide card: the label is read out but not shown, and no hint or quick picks */
  compact?: boolean;
  /** Tags that were filled in for the person (by the AI or from similar slides): marked, to check and remove if wrong */
  auto?: string[];
}) {
  const { announce } = useWorkspace();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const full = value.length >= TAG_MAX_COUNT;
  const has = (t: string) => value.some((v) => v.toLowerCase() === t.toLowerCase());
  /* The library's own spelling wins, so one tag has one spelling. */
  const canonical = (t: string) => suggestions.find((s) => s.tag.toLowerCase() === t.toLowerCase())?.tag ?? t;

  const typed = cleanTag(text);
  const options = useMemo(() => {
    const q = typed.toLowerCase();
    const matches = suggestions.filter((s) => !has(s.tag) && (!q || s.tag.toLowerCase().includes(q))).slice(0, 6);
    const exact = suggestions.some((s) => s.tag.toLowerCase() === q);
    const create = typed && !exact && !has(typed) ? [{ tag: typed, create: true as const }] : [];
    return [...create, ...matches.map((m) => ({ ...m, create: false as const }))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed, suggestions, value]);
  const listId = `${id}-list`;

  function add(raw: string) {
    const t = cleanTag(raw);
    if (!t || full) return;
    if (has(t)) {
      announce(`${t} is already added`);
      return;
    }
    const tag = canonical(t);
    onChange([...value, tag]);
    announce(`Added tag ${tag}`);
  }
  function remove(tag: string) {
    onChange(value.filter((v) => v !== tag));
    announce(`Removed tag ${tag}`);
    inputRef.current?.focus();
  }
  function commit() {
    if (!typed) return;
    add(typed);
    setText('');
    setActive(-1);
    setOpen(false); /* closed after each tag; typing, or the arrow keys, open it again */
  }
  function pick(i: number) {
    const o = options[i];
    if (!o) return;
    add(o.tag);
    setText('');
    setActive(-1);
    setOpen(false);
    inputRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (options.length === 0) return;
      e.preventDefault();
      setOpen(true);
      setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % options.length : (a <= 0 ? options.length : a) - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault(); /* Enter never submits the upload form from here */
      if (open && active >= 0) pick(active);
      else commit();
    } else if (e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      if (open) {
        e.stopPropagation();
        setOpen(false);
        setActive(-1);
      }
    } else if (e.key === 'Backspace' && !text && value.length) {
      remove(value[value.length - 1]);
    }
  }
  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const t = e.clipboardData.getData('text');
    if (!/[,\n]/.test(t)) return;
    e.preventDefault();
    const room = TAG_MAX_COUNT - value.length;
    const next = [...value];
    for (const part of t.split(/[,\n]/).map(cleanTag).filter(Boolean)) {
      if (next.length - value.length >= room || next.some((v) => v.toLowerCase() === part.toLowerCase())) continue;
      next.push(canonical(part));
    }
    onChange(next);
    announce(`Added ${next.length - value.length} tags`);
  }

  const popular = suggestions.filter((s) => !has(s.tag)).slice(0, 6);
  return (
    <div className={compact ? 'tagfield-wrap is-compact' : 'field full tagfield-wrap'}>
      <label htmlFor={`${id}-in`} className={compact ? 'sr-only' : undefined}>
        {label}
        {!compact && <span className="field-opt">optional</span>}
      </label>
      <div className={`tagfield${disabled ? ' is-disabled' : ''}`} onClick={() => inputRef.current?.focus()}>
        {value.length > 0 && (
          <ul className="tagfield-chips" aria-label={`${label} added`}>
            {value.map((t) => (
              <li key={t} className={`tagchip${auto.some((a) => a.toLowerCase() === t.toLowerCase()) ? ' is-auto' : ''}`}>
                {auto.some((a) => a.toLowerCase() === t.toLowerCase()) && <Icon name="sparkle" className="ic-sm" />}
                <span>{t}</span>
                <button type="button" className="tagchip-x" aria-label={`Remove tag ${t}`} disabled={disabled} onClick={() => remove(t)}>
                  <Icon name="x" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={inputRef}
          id={`${id}-in`}
          type="text"
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${id}-o${active}` : undefined}
          aria-describedby={`${id}-hint`}
          autoComplete="off"
          maxLength={TAG_MAX_LENGTH}
          value={text}
          disabled={disabled || full}
          placeholder={value.length ? '' : compact ? '+ Add tag' : 'Type a tag and press Enter'}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => {
            setOpen(true);
            /* On a phone the list would open under the tab bar: bring the box to the middle of the screen. */
            if (window.matchMedia('(max-width: 640px)').matches) setTimeout(() => inputRef.current?.scrollIntoView({ block: 'center' }), 50);
          }}
          onBlur={() => {
            setOpen(false);
            setActive(-1);
            commit(); /* a word left in the box when you tab away still counts */
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        {open && options.length > 0 && (
          <ul id={listId} role="listbox" className="tagfield-list" aria-label={`${label} suggestions`} onMouseDown={(e) => e.preventDefault()}>
            {options.map((o, i) => (
              <li key={o.tag} id={`${id}-o${i}`} role="option" aria-selected={i === active} className={`tagfield-opt${i === active ? ' is-active' : ''}`} onClick={() => pick(i)}>
                {o.create ? (
                  <span className="tagfield-add">
                    <Icon name="plus" className="ic-sm" />
                    Add “{o.tag}”
                  </span>
                ) : (
                  <>
                    <span>{o.tag}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className={compact ? 'sr-only' : 'field-hint'} id={`${id}-hint`}>
        {full ? `That's the most tags (${TAG_MAX_COUNT}) for one deck.` : hint ?? 'Press Enter or comma after each tag.'}
      </p>
      {!compact && popular.length > 0 && !full && !disabled && (
        <div className="tagfield-popular">
          <span id={`${id}-pop`}>Often used:</span>
          <ul aria-labelledby={`${id}-pop`}>
            {popular.map((s) => (
              <li key={s.tag}>
                <button type="button" className="tagquick" onClick={() => add(s.tag)}>
                  <Icon name="plus" className="ic-sm" />
                  {s.tag}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
