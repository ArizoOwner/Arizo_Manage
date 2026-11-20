// Budgets, Savings Goals and Categories screens (PROMPT.md §7 #6, §7 #9 "Categories").
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../app/stores/settings';
import { mutate } from '../../app/stores/vault';
import { useVaultQuery } from '../../app/useVaultQuery';
import { periodAt } from '../../core/analytics/periods';
import { contributeGoal, deleteBudget, deleteCategory, deleteGoal, PlanError, saveBudget, saveCategory, saveGoal, type BudgetInput, type GoalInput } from '../../core/analytics/plans';
import type { GoalStatus } from '../../core/analytics/engine';
import { formatDate, formatMoney, localDigits } from '../../core/i18n/format';
import { PrivacyBlur } from '../../core/motion/PrivacyBlur';
import type { Budget, Category, CategoryType, SavingsGoal } from '../../core/storage/schema';
import { Button, Card, Field, Icon, IconButton, ICONS, Screen, Segmented, Sheet, Toggle } from '../../core/ui/ui';
import { AccountSelect, AmountField, BackButton, DateField, liveAccounts } from '../obligations/shared';
import { BudgetList, useAnalytics, useNames } from './Analytics';

function useErr() {
  const { t } = useTranslation();
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, done: () => void) => {
    try {
      await fn();
      setErr(null);
      done();
    } catch (e) {
      setErr(e instanceof PlanError ? t(`planErrors.${e.message}`, { defaultValue: t('planErrors.generic') }) : t('planErrors.generic'));
    }
  };
  return { err, setErr, run };
}

const catName = (c: Category, lang: 'fa' | 'en') => (lang === 'fa' ? c.name_fa : c.name_en);
const liveCats = (cats: Category[] | undefined, type: CategoryType) => (cats ?? []).filter((c) => c.deleted_at === null && c.type === type).sort((a, b) => a.sort_order - b.sort_order);

/** Expense categories with sub-categories listed under their parent. */
function CategoryOptions({ cats }: { cats: Category[] }) {
  const lang = useSettings((s) => s.lang);
  const top = cats.filter((c) => c.parent_id === null);
  return (
    <>
      {top.map((c) => [
        <option key={c.id} value={c.id}>
          {catName(c, lang)}
        </option>,
        ...cats
          .filter((s) => s.parent_id === c.id)
          .map((s) => (
            <option key={s.id} value={s.id}>
              {`— ${catName(s, lang)}`}
            </option>
          )),
      ])}
    </>
  );
}

export function BudgetsScreen() {
  const { t } = useTranslation();
  const cal = useSettings((s) => s.calendar);
  const p = periodAt(Date.now(), cal);
  const { report, categories, accounts } = useAnalytics(cal, p.y, p.m);
  const names = useNames(categories, accounts);
  const { data } = useVaultQuery(async (db) => ({ budgets: await db.find('budgets'), cats: await db.find('categories') }));
  const [editing, setEditing] = useState<Budget | 'new' | null>(null);
  const budgets = (data?.budgets ?? []).filter((b) => b.deleted_at === null);
  const inactive = budgets.filter((b) => !b.is_active);
  return (
    <Screen
      title={t('budgets.title')}
      actions={
        <>
          <IconButton label={t('budgets.new')} onClick={() => setEditing('new')}>
            <Icon d={ICONS.plus} />
          </IconButton>
          <BackButton />
        </>
      }
    >
      {budgets.length === 0 && <p className="py-8 text-center text-[14px] text-ink-2">{t('budgets.empty')}</p>}
      {report && report.budgets.length > 0 && (
        <Card>
          <BudgetList report={report} names={names} />
        </Card>
      )}
      {budgets.length > 0 && (
        <div className="flex flex-col gap-2">
          {[...budgets.filter((b) => b.is_active), ...inactive].map((b) => (
            <button key={b.id} type="button" onClick={() => setEditing(b)} className={`flex min-h-12 items-center justify-between rounded-2xl border border-hairline bg-surface-1 px-4 text-start text-[14px] ${b.is_active ? '' : 'opacity-60'}`} data-testid="budget-edit">
              <span className="truncate font-semibold">{b.category_id === null ? t('budgets.overall') : names.cat(b.category_id)}</span>
              <span className="text-[12px] text-ink-2">{t(`budgets.${b.period}`)}</span>
            </button>
          ))}
        </div>
      )}
      {editing && <BudgetForm budget={editing === 'new' ? null : editing} cats={liveCats(data?.cats, 'expense')} onClose={() => setEditing(null)} />}
    </Screen>
  );
}

function BudgetForm({ budget, cats, onClose }: { budget: Budget | null; cats: Category[]; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const cal = useSettings((s) => s.calendar);
  const [f, setF] = useState<BudgetInput>(
    budget ?? { category_id: null, period: cal === 'jalali' ? 'monthly_jalali' : 'monthly_gregorian', limit_minor: 0n, currency_code: 'IRR', alert_thresholds_json: [50, 80, 100], rollover_unused: false, is_active: true },
  );
  const { err, run } = useErr();
  const toggleT = (x: number) => setF({ ...f, alert_thresholds_json: f.alert_thresholds_json.includes(x) ? f.alert_thresholds_json.filter((y) => y !== x) : [...f.alert_thresholds_json, x] });
  return (
    <Sheet open onClose={onClose} title={budget ? t('budgets.edit') : t('budgets.new')}>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-ink-2">{t('budgets.category')}</span>
        <select value={f.category_id ?? ''} onChange={(e) => setF({ ...f, category_id: e.target.value || null })} className="min-h-12 rounded-2xl bg-surface-3 px-4 text-[15px] text-ink" data-testid="budget-category">
          <option value="">{t('budgets.overall')}</option>
          <CategoryOptions cats={cats} />
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-ink-2">{t('budgets.period')}</span>
        <select value={f.period} onChange={(e) => setF({ ...f, period: e.target.value as Budget['period'] })} className="min-h-12 rounded-2xl bg-surface-3 px-4 text-[15px] text-ink">
          {(['monthly_jalali', 'monthly_gregorian', 'weekly'] as const).map((p) => (
            <option key={p} value={p}>
              {t(`budgets.${p}`)}
            </option>
          ))}
          {f.period === 'custom' && <option value="custom">{t('budgets.custom')}</option>}
        </select>
      </label>
      <AmountField label={t('budgets.limit')} currency={f.currency_code} value={f.limit_minor || null} onChange={(v) => setF({ ...f, limit_minor: v })} testId="budget-limit" />
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-[13px] font-semibold text-ink-2">{t('budgets.alerts')}</legend>
        <div className="flex gap-2">
          {[50, 80, 100].map((x) => (
            <button key={x} type="button" role="checkbox" aria-checked={f.alert_thresholds_json.includes(x)} onClick={() => toggleT(x)} className={`min-h-11 flex-1 rounded-xl text-[14px] font-semibold ${f.alert_thresholds_json.includes(x) ? 'bg-cta text-on-accent' : 'bg-surface-3 text-ink-2'}`}>
              {lang === 'fa' ? `${localDigits(x, lang)}٪` : `${x}%`}
            </button>
          ))}
        </div>
      </fieldset>
      <Toggle label={t('budgets.rollover')} description={t('budgets.rolloverHint')} checked={f.rollover_unused} onChange={(v) => setF({ ...f, rollover_unused: v })} />
      {budget && <Toggle label={t('budgets.active')} checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} />}
      {err && (
        <p role="alert" className="text-[13px] text-coral-text">
          {err}
        </p>
      )}
      <Button data-testid="budget-save" onClick={() => run(() => mutate((db) => saveBudget(db, f, budget?.id ?? null)), onClose)}>
        {t('budgets.save')}
      </Button>
      {budget && (
        <Button variant="ghost" onClick={() => run(() => mutate((db) => deleteBudget(db, budget.id)), onClose)}>
          {t('budgets.delete')}
        </Button>
      )}
    </Sheet>
  );
}

export function GoalsScreen() {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const cal = useSettings((s) => s.calendar);
  const irrUnit = useSettings((s) => s.irrUnit);
  const p = periodAt(Date.now(), cal);
  const { report } = useAnalytics(cal, p.y, p.m);
  const { data } = useVaultQuery(async (db) => ({ goals: await db.find('savings_goals'), accounts: await db.find('accounts') }));
  const [editing, setEditing] = useState<SavingsGoal | 'new' | null>(null);
  const [moving, setMoving] = useState<GoalStatus | null>(null);
  const rows = (data?.goals ?? []).filter((g) => g.deleted_at === null);
  return (
    <Screen
      title={t('goals.title')}
      actions={
        <>
          <IconButton label={t('goals.new')} onClick={() => setEditing('new')}>
            <Icon d={ICONS.plus} />
          </IconButton>
          <BackButton />
        </>
      }
    >
      {rows.length === 0 && <p className="py-8 text-center text-[14px] text-ink-2">{t('goals.empty')}</p>}
      {report?.goals.map((g) => {
        const money = (v: bigint) => formatMoney(v, g.currency_code, lang, irrUnit);
        const row = rows.find((x) => x.id === g.id);
        return (
          <Card key={g.id} className="flex flex-col gap-3" data-testid="goal-row">
            <div className="flex items-center justify-between gap-3">
              <h2 className="truncate text-[16px] font-bold">{g.name}</h2>
              <span className={`text-[12px] font-semibold ${g.remaining === 0n ? 'text-emerald-text' : g.overdue ? 'text-coral-text' : 'text-ink-2'}`}>
                {g.remaining === 0n ? t('goals.done') : g.overdue ? t('goals.overdue') : g.daysLeft !== null ? t('goals.daysLeft', { n: localDigits(g.daysLeft, lang) }) : ''}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-3" role="img" aria-label={t('goals.bar', { n: localDigits(g.pct, lang) })}>
              <div className="h-full rounded-full bg-gold-mark" style={{ width: `${g.pct}%` }} />
            </div>
            <PrivacyBlur>
              <span className="text-[13px] tabular" data-testid="goal-progress">
                {t('goals.progress', { current: money(g.current), target: money(g.target) })}
              </span>
            </PrivacyBlur>
            {g.perMonth !== null && (
              <PrivacyBlur>
                <span className="text-[12px] text-ink-2">{t('goals.perMonth', { amount: money(g.perMonth) })}</span>
              </PrivacyBlur>
            )}
            {g.deadline_at !== null && <span className="text-[12px] text-ink-2">{`${t('goals.deadline')}: ${formatDate(g.deadline_at, cal, lang)}`}</span>}
            <div className="flex gap-2">
              {g.linked_account_id === null && (
                <Button variant="secondary" className="flex-1" onClick={() => setMoving(g)} data-testid="goal-contribute">
                  {t('goals.add')}
                </Button>
              )}
              {row && (
                <Button variant="ghost" className="flex-1" onClick={() => setEditing(row)}>
                  {t('goals.edit')}
                </Button>
              )}
            </div>
          </Card>
        );
      })}
      {editing && <GoalForm goal={editing === 'new' ? null : editing} accounts={liveAccounts(data?.accounts)} onClose={() => setEditing(null)} />}
      {moving && <ContributeSheet goal={moving} onClose={() => setMoving(null)} />}
    </Screen>
  );
}

function ContributeSheet({ goal, onClose }: { goal: GoalStatus; onClose: () => void }) {
  const { t } = useTranslation();
  const [dir, setDir] = useState<'add' | 'withdraw'>('add');
  const [amount, setAmount] = useState<bigint | null>(null);
  const { err, run } = useErr();
  return (
    <Sheet open onClose={onClose} title={goal.name}>
      <Segmented label={goal.name} value={dir} onChange={setDir} options={[{ value: 'add', label: t('goals.add') }, { value: 'withdraw', label: t('goals.withdraw') }]} />
      <AmountField label={dir === 'add' ? t('goals.add') : t('goals.withdraw')} currency={goal.currency_code} value={amount} onChange={setAmount} testId="goal-amount" />
      {err && (
        <p role="alert" className="text-[13px] text-coral-text">
          {err}
        </p>
      )}
      <Button disabled={!amount} data-testid="goal-amount-save" onClick={() => run(() => mutate((db) => contributeGoal(db, goal.id, dir === 'add' ? amount! : -amount!)), onClose)}>
        {t('goals.save')}
      </Button>
    </Sheet>
  );
}

function GoalForm({ goal, accounts, onClose }: { goal: SavingsGoal | null; accounts: ReturnType<typeof liveAccounts>; onClose: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState<GoalInput>(goal ?? { name: '', target_minor: 0n, current_minor: 0n, currency_code: 'IRR', linked_account_id: null, deadline_at: null, icon_name: 'target', color_hex: '#E6C47A' });
  const { err, run } = useErr();
  return (
    <Sheet open onClose={onClose} title={goal ? t('goals.edit') : t('goals.new')}>
      <Field label={t('goals.name')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="goal-name" />
      <AccountSelect
        label={t('goals.linked')}
        accounts={accounts}
        value={f.linked_account_id}
        allowNone={t('goals.none')}
        onChange={(id) => setF({ ...f, linked_account_id: id, currency_code: accounts.find((a) => a.id === id)?.currency_code ?? f.currency_code })}
      />
      <p className="-mt-2 text-[12px] text-ink-2">{t('goals.linkedHint')}</p>
      <AmountField label={t('goals.target')} currency={f.currency_code} value={f.target_minor || null} onChange={(v) => setF({ ...f, target_minor: v })} testId="goal-target" />
      {f.linked_account_id === null && <AmountField label={t('goals.current')} currency={f.currency_code} value={f.current_minor} onChange={(v) => setF({ ...f, current_minor: v })} />}
      <DateField label={t('goals.deadline')} value={f.deadline_at} onChange={(v) => setF({ ...f, deadline_at: v })} optional />
      {err && (
        <p role="alert" className="text-[13px] text-coral-text">
          {err}
        </p>
      )}
      <Button data-testid="goal-save" onClick={() => run(() => mutate((db) => saveGoal(db, f, goal?.id ?? null)), onClose)}>
        {t('goals.save')}
      </Button>
      {goal && (
        <Button variant="ghost" onClick={() => run(() => mutate((db) => deleteGoal(db, goal.id)), onClose)}>
          {t('goals.delete')}
        </Button>
      )}
    </Sheet>
  );
}

// Same hues the seed categories use, so user categories sit in the same family.
const SWATCHES = ['#FF8A65', '#AED581', '#4DA6FF', '#FFB547', '#90A4AE', '#A1887F', '#EF5350', '#7986CB', '#BA68C8', '#4FC3F7', '#F06292', '#26C6DA', '#E6C47A', '#81C784', '#00D69F', '#26A69A'];

export function CategoriesScreen() {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const { data } = useVaultQuery((db) => db.find('categories'));
  const cats = liveCats(data, type);
  const top = cats.filter((c) => c.parent_id === null);
  const row = (c: Category, sub: boolean) => (
    <button key={c.id} type="button" onClick={() => setEditing(c)} className={`flex min-h-12 items-center gap-3 rounded-2xl px-3 text-start text-[14px] hover:bg-surface-2 ${sub ? 'ps-9' : ''}`} data-testid="category-row">
      <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ background: c.color_hex }} />
      <span className="min-w-0 flex-1 truncate font-semibold">{catName(c, lang)}</span>
      {c.is_system && <span className="text-[11px] text-ink-2">{t('categories.system')}</span>}
    </button>
  );
  return (
    <Screen
      title={t('categories.title')}
      actions={
        <>
          <IconButton label={t('categories.new')} onClick={() => setEditing('new')}>
            <Icon d={ICONS.plus} />
          </IconButton>
          <BackButton />
        </>
      }
    >
      <Segmented label={t('categories.title')} value={type} onChange={setType} options={[{ value: 'expense', label: t('categories.expense') }, { value: 'income', label: t('categories.income') }]} />
      <Card className="flex flex-col p-2">{top.flatMap((c) => [row(c, false), ...cats.filter((s) => s.parent_id === c.id).map((s) => row(s, true))])}</Card>
      {editing && <CategoryForm cat={editing === 'new' ? null : editing} type={type} tops={top} onClose={() => setEditing(null)} />}
    </Screen>
  );
}

function CategoryForm({ cat, type, tops, onClose }: { cat: Category | null; type: 'expense' | 'income'; tops: Category[]; onClose: () => void }) {
  const { t } = useTranslation();
  const lang = useSettings((s) => s.lang);
  const [f, setF] = useState({ name_fa: cat?.name_fa ?? '', name_en: cat?.name_en ?? '', parent_id: cat?.parent_id ?? null, color_hex: cat?.color_hex ?? SWATCHES[0]!, icon_name: cat?.icon_name ?? 'tag' });
  const { err, run } = useErr();
  return (
    <Sheet open onClose={onClose} title={cat ? t('categories.edit') : t('categories.new')}>
      {cat?.is_system && <p className="text-[12px] text-ink-2">{t('categories.systemHint')}</p>}
      <Field label={t('categories.nameFa')} value={f.name_fa} onChange={(e) => setF({ ...f, name_fa: e.target.value })} dir="rtl" data-testid="category-name-fa" />
      <Field label={t('categories.nameEn')} value={f.name_en} onChange={(e) => setF({ ...f, name_en: e.target.value })} dir="ltr" />
      {!cat?.is_system && (
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-ink-2">{t('categories.parent')}</span>
          <select value={f.parent_id ?? ''} onChange={(e) => setF({ ...f, parent_id: e.target.value || null })} className="min-h-12 rounded-2xl bg-surface-3 px-4 text-[15px] text-ink" data-testid="category-parent">
            <option value="">{t('categories.none')}</option>
            {tops
              .filter((c) => c.id !== cat?.id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {catName(c, lang)}
                </option>
              ))}
          </select>
        </label>
      )}
      <fieldset>
        <legend className="mb-2 text-[13px] font-semibold text-ink-2">{t('categories.color')}</legend>
        <div className="grid grid-cols-8 gap-2">
          {SWATCHES.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={f.color_hex.toLowerCase() === c.toLowerCase()} aria-label={c} onClick={() => setF({ ...f, color_hex: c })} className={`grid aspect-square min-h-9 place-items-center rounded-full ${f.color_hex.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-gold-mark ring-offset-2 ring-offset-surface-2' : ''}`} style={{ background: c }} />
          ))}
        </div>
      </fieldset>
      {err && (
        <p role="alert" className="text-[13px] text-coral-text">
          {err}
        </p>
      )}
      <Button data-testid="category-save" onClick={() => run(() => mutate((db) => saveCategory(db, { ...f, type: cat?.type === 'income' || (!cat && type === 'income') ? 'income' : 'expense' }, cat?.id ?? null)), onClose)}>
        {t('categories.save')}
      </Button>
      {cat && !cat.is_system && (
        <Button variant="ghost" onClick={() => run(() => mutate((db) => deleteCategory(db, cat.id)), onClose)}>
          {t('categories.delete')}
        </Button>
      )}
    </Sheet>
  );
}
