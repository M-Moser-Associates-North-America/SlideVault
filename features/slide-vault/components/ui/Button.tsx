'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';

/**
 * The one button of the workspace (Alina's FE note 5). Every button looks like one of these four:
 * - 'secondary' (default): white with a grey edge; light orange on hover and press.
 * - 'primary': near-black (near-white in dark mode); only lightens on hover. One per area at most.
 * - 'ghost': no edge or fill until hovered; for quiet actions and icon buttons in headers.
 * - 'danger': red text and edge, for removing things.
 * `size="sm"` is the compact height used in toolbars and cards; `iconOnly` makes it square around an icon
 * (give it an aria-label). The look itself lives in styles/primitives.css (.btn and its modifiers).
 */
export type ButtonVariant = 'secondary' | 'primary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';
export type ButtonLook = { variant?: ButtonVariant; size?: ButtonSize; iconOnly?: boolean; className?: string };

/** The class names for a button look, for elements that must stay links (a Link styled as a button). */
export function buttonClass({ variant = 'secondary', size = 'md', iconOnly = false, className }: ButtonLook = {}): string {
  return ['btn', variant !== 'secondary' && `btn-${variant}`, iconOnly && 'btn-icon', size === 'sm' && 'btn-sm', className].filter(Boolean).join(' ');
}

export type ButtonProps = ButtonLook & ButtonHTMLAttributes<HTMLButtonElement>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant, size, iconOnly, className, type = 'button', ...rest }, ref) {
  return <button ref={ref} type={type} className={buttonClass({ variant, size, iconOnly, className })} {...rest} />;
});
