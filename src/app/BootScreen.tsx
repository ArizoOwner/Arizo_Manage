// Phase 0 shell. Replaced by the Vault Lock gate in Phase 3.
export function BootScreen() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-center">
      <h1 className="text-3xl font-extrabold tracking-tight text-gold">آریزو منیجر</h1>
      <p className="font-en text-sm text-ink-2" dir="ltr" lang="en">
        Arizo Manage
      </p>
    </main>
  );
}
