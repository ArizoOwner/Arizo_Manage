// Small shared UI building blocks. Every control has a ≥ 44 px target and a visible focus ring.
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { INSTANT, SPRING } from '../motion/motion';

export function Button({ variant = 'primary', className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  const look = {
    primary: 'bg-cta text-on-accent font-bold',
    secondary: 'bg-surface-3 text-ink font-semibold',
    danger: 'bg-cta-danger text-on-accent font-bold',
    ghost: 'text-ink-2 font-semibold hover:bg-surface-3',
  }[variant];
  return (
    <button
      type="button"
      {...rest}
      className={`min-h-12 rounded-2xl px-5 text-[15px] transition-transform active:scale-[0.98] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-azure ${look} ${className}`}
    />
  );
}

export function Field({ label, error, hint, className = '', ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | undefined; hint?: string | undefined }) {
  const id = useId();
  return (
    <label htmlFor={id} className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-[13px] font-semibold text-ink-2">{label}</span>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-d` : undefined}
        {...rest}
        className={`min-h-12 rounded-2xl border bg-surface-3 px-4 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-azure ${error ? 'border-coral' : 'border-transparent'}`}
      />
      {(error || hint) && (
        <span id={`${id}-d`} className={`text-[12px] ${error ? 'text-coral-text' : 'text-ink-2'}`}>
          {error ?? hint}
        </span>
      )}
    </label>
  );
}

export function Toggle({ label, checked, onChange, description }: { label: string; checked: boolean; onChange: (v: boolean) => void; description?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex min-h-12 w-full items-center justify-between gap-4 text-start">
      <span className="flex flex-col">
        <span className="text-[15px] font-semibold text-ink">{label}</span>
        {description && <span className="text-[12px] text-ink-2">{description}</span>}
      </span>
      <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-cta' : 'bg-surface-3'}`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[inset-inline-start] ${checked ? 'start-6' : 'start-1'}`} />
      </span>
    </button>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-2xl bg-surface-3 p-1 text-[13px] font-semibold">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-10 flex-1 rounded-xl px-2 transition-colors ${value === o.value ? 'bg-surface-1 text-ink shadow-sm' : 'text-ink-2'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Card({ children, className = '', ...rest }: { children: ReactNode; className?: string } & Omit<React.HTMLAttributes<HTMLDivElement>, 'className' | 'children'>) {
  return (
    <div {...rest} className={`rounded-3xl border border-hairline bg-surface-1 p-4 ${className}`}>
      {children}
    </div>
  );
}

/** Bottom sheet with focus trap, Escape to close, and a backdrop. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => ref.current?.querySelector<HTMLElement>('input,button,[tabindex]')?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab' || !ref.current) return;
      const f = [...ref.current.querySelectorAll<HTMLElement>('button:not([disabled]),input,select,textarea,[tabindex="0"]')];
      if (!f.length) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <motion.div className="absolute inset-0 bg-black/55" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="relative flex max-h-[92dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-[28px] border border-specular bg-surface-2 px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            initial={reduce ? { opacity: 0 } : { y: '100%' }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: '100%' }}
            transition={reduce ? INSTANT : SPRING.sheet}
          >
            <div aria-hidden="true" className="mx-auto h-1.5 w-10 rounded-full bg-surface-3" />
            <h2 id={titleId} className="text-[17px] font-bold">
              {title}
            </h2>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/** Screen scaffold: safe-area padding and room for the floating dock. */
export function Screen({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(7.5rem+env(safe-area-inset-bottom))]">
      <header className="flex min-h-12 items-center justify-between gap-3">
        <h1 className="truncate text-[22px] font-extrabold">{title}</h1>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </header>
      {children}
    </main>
  );
}

export function IconButton({ label, children, onClick, pressed }: { label: string; children: ReactNode; onClick: () => void; pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className="relative grid h-11 w-11 place-items-center rounded-2xl text-ink-2 hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-azure"
    >
      {children}
    </button>
  );
}

export function Icon({ d, className = 'h-[22px] w-[22px]' }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export const ICONS = {
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  lock: 'M6 11V8a6 6 0 1 1 12 0v3M5 11h14v10H5z',
  back: 'M15 18l-6-6 6-6',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2-4.4-4.4',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  fingerprint: 'M12 11v4M8 21c-1-2-1.5-4-1.5-6a5.5 5.5 0 0 1 11 0c0 1.4-.2 2.8-.6 4M5 18c-.7-1.3-1-2.6-1-4a8 8 0 0 1 14.7-4.4M17 21c.3-.8.5-1.6.6-2.4',
};
