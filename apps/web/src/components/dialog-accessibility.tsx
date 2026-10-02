'use client';
import { useEffect } from 'react';

// Shared keyboard behavior for the application's conditionally mounted dialogs.
export function DialogAccessibility() {
  useEffect(() => {
    let active: HTMLElement | null = null;
    let previous: HTMLElement | null = null;
    const rememberFocus = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && !target.closest('[role="dialog"]')) previous = target;
    };
    const focusable = (dialog: HTMLElement) =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]',
        ),
      ).filter((el) => el.getClientRects().length > 0);
    const sync = () => {
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
      const next = dialogs[dialogs.length - 1] || null;
      if (next === active) return;
      active = next;
      if (active) {
        active.tabIndex = -1;
        (focusable(active)[0] || active).focus();
      } else if (previous?.isConnected) previous.focus();
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    const onKey = (event: KeyboardEvent) => {
      if (!active) return;
      if (event.key === 'Escape') {
        const close = active.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
        if (close) {
          event.preventDefault();
          event.stopImmediatePropagation();
          close.click();
        }
      }
      if (event.key === 'Tab') {
        const list = focusable(active),
          first = list[0],
          last = list[list.length - 1];
        if (!first) {
          event.preventDefault();
          active.focus();
        } else if (
          event.shiftKey &&
          (document.activeElement === first || !active.contains(document.activeElement))
        ) {
          event.preventDefault();
          last!.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || !active.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', rememberFocus, true);
    sync();
    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', rememberFocus, true);
    };
  }, []);
  return null;
}
