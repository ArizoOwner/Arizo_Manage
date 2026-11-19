import type { ReactNode } from 'react';
import { usePrivacy } from '../../app/stores/privacy';

/**
 * Wraps any monetary value. When stealth mode is on, the value is blurred and hidden from
 * screen readers (which would otherwise read the amount aloud).
 */
export function PrivacyBlur({ children, className = '' }: { children: ReactNode; className?: string }) {
  const hidden = usePrivacy((s) => s.hidden);
  return (
    <span
      className={`inline-block transition-[filter] duration-300 motion-reduce:transition-none ${hidden ? 'blur-[10px] select-none' : ''} ${className}`}
      aria-hidden={hidden || undefined}
      data-private={hidden ? 'hidden' : 'shown'}
    >
      {children}
    </span>
  );
}
