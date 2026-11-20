// The printable invoice. One structure, four looks: Minimal Modern, Classic Official (رسمی), Bold Brand
// and Thermal. Every number comes from computeTotals (exact bigint); text is HTML so the OS shapes
// Persian natively (CoreText on iOS, HarfBuzz in Android's WebView) at print resolution.
import { useTranslation } from 'react-i18next';
import { formatDate, localDigits, type Lang } from '../../core/i18n/format';
import { formatQuantity, qrSummary, totalInWords, type InvoiceTotals } from '../../core/invoices/invoices';
import type { BusinessProfile, Customer, Invoice, InvoiceItem } from '../../core/storage/schema';
import { bpsPercent, isThermal, PaperMoney, QrCode, type Paper } from './paper';

export interface InvoiceDocProps {
  invoice: Invoice;
  items: InvoiceItem[];
  customer: Customer | null;
  profile: BusinessProfile | null;
  totals: InvoiceTotals;
  logoUrl: string | null;
  signatureUrl: string | null;
  paper: Paper;
  lang: Lang;
  unit: 'toman' | 'rial';
}

export function InvoiceDoc(p: InvoiceDocProps) {
  const { t } = useTranslation();
  const tt = (k: string, o?: Record<string, unknown>) => t(k, { lng: p.lang, ...o });
  const { invoice: inv, totals } = p;
  const thermal = isThermal(p.paper);
  const tpl = thermal ? 'thermal' : inv.template === 'thermal' ? 'minimal' : inv.template;
  const m = (minor: bigint) => <PaperMoney minor={minor} currency={inv.currency_code} lang={p.lang} unit={p.unit} />;
  const unitLabel = tt(inv.currency_code === 'IRR' ? `unit.${p.unit}` : `currency.${inv.currency_code}`);
  const wordsText = p.lang === 'fa' ? totalInWords(totals.total, inv.currency_code, p.unit, unitLabel) : null;
  const title = tt(inv.kind === 'proforma' ? 'invoice.proforma' : 'invoice.invoice');
  const date = (ms: number) => formatDate(ms, 'jalali', p.lang);
  const qr = qrSummary({ number: inv.number, seller: p.profile?.name ?? '', seller_code: p.profile?.economic_code || p.profile?.national_id || '', issued_at: inv.issued_at, total: totals.total, currency: inv.currency_code });
  const digits = (s: string | number) => localDigits(s, p.lang);

  const party = (label: string, x: { name: string; national_id: string; economic_code: string; address: string; phone: string } | null) => (
    <div className={tpl === 'official' ? 'frame grow' : 'box grow'}>
      {tpl === 'official' ? <div className="frame-title">{label}</div> : <div className="muted">{label}</div>}
      <div style={tpl === 'official' ? { padding: '2mm 3mm' } : undefined}>
        <div style={{ fontWeight: 700 }}>{x?.name || '—'}</div>
        {x?.national_id && (
          <div>
            {tt('invoice.nationalId')}: <span className="num">{digits(x.national_id)}</span>
          </div>
        )}
        {x?.economic_code && (
          <div>
            {tt('invoice.economicCode')}: <span className="num">{digits(x.economic_code)}</span>
          </div>
        )}
        {x?.address && <div>{x.address}</div>}
        {x?.phone && (
          <div>
            {tt('invoice.phone')}: <span className="num">{digits(x.phone)}</span>
          </div>
        )}
      </div>
    </div>
  );

  const totalsBlock = (
    <div className="totals">
      <div className="row">
        <span>{tt('invoice.subtotal')}</span>
        {m(totals.subtotal)}
      </div>
      {totals.invoiceDiscount > 0n && (
        <div className="row">
          <span>{tt('invoice.discount')}</span>
          {m(-totals.invoiceDiscount)}
        </div>
      )}
      <div className="row">
        <span>{tt('invoice.vat', { p: digits(bpsPercent(inv.vat_bps)) })}</span>
        {m(totals.vat)}
      </div>
      <div className="row grand">
        <span>{tt('invoice.total')}</span>
        {m(totals.total)}
      </div>
      {inv.paid_minor > 0n && (
        <div className="row">
          <span>{tt('invoice.paid')}</span>
          {m(inv.paid_minor)}
        </div>
      )}
      {inv.paid_minor > 0n && totals.total > inv.paid_minor && (
        <div className="row" style={{ fontWeight: 700 }}>
          <span>{tt('invoice.due')}</span>
          {m(totals.total - inv.paid_minor)}
        </div>
      )}
    </div>
  );

  if (thermal) {
    return (
      <article className={`doc doc-${p.paper} t-thermal`} dir={p.lang === 'fa' ? 'rtl' : 'ltr'} lang={p.lang === 'fa' ? 'fa-IR' : 'en'} data-testid="invoice-doc">
        {p.logoUrl && <img className="logo" src={p.logoUrl} alt="" />}
        <h2 className="doc-title">{p.profile?.name || title}</h2>
        {p.profile?.phone && <div className="num">{digits(p.profile.phone)}</div>}
        <div className="rule" />
        <div>
          {title} <span className="num">{inv.number}</span>
        </div>
        <div>{date(inv.issued_at)}</div>
        {p.customer && <div>{p.customer.name}</div>}
        <div className="rule" />
        <table>
          <tbody>
            {p.items.map((it, i) => (
              <tr key={it.id}>
                <td>
                  {it.description}
                  <div className="muted">
                    <span className="num">{digits(formatQuantity(it.quantity_milli))}</span> × {m(it.unit_price_minor)}
                  </div>
                </td>
                <td className="n">{m(totals.lines[i]!.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="rule" />
        {totalsBlock}
        {wordsText && <p className="words">{wordsText}</p>}
        <div className="rule" />
        <QrCode text={qr} label={tt('invoice.qr')} />
        <p className="muted">{tt('invoice.thanks')}</p>
      </article>
    );
  }

  return (
    <article className={`doc doc-${p.paper} t-${tpl} stack`} dir={p.lang === 'fa' ? 'rtl' : 'ltr'} lang={p.lang === 'fa' ? 'fa-IR' : 'en'} data-testid="invoice-doc">
      <header className={tpl === 'bold' ? 'band row' : 'row'} style={{ alignItems: 'center' }}>
        <div className="grow">
          {tpl !== 'official' && <h2 className="doc-title">{title}</h2>}
          {tpl === 'official' && <h2 className="doc-title">{tt('invoice.officialTitle')}</h2>}
          <div className="muted">
            {tt('invoice.number')}: <span className="num">{inv.number}</span>
          </div>
          <div className="muted">
            {tt('invoice.date')}: {date(inv.issued_at)}
            {inv.due_at !== null && (
              <>
                {' · '}
                {tt('invoice.dueDate')}: {date(inv.due_at)}
              </>
            )}
          </div>
          {inv.status !== 'draft' && <span className="badge accent">{tt(`invoice.status.${inv.status}`)}</span>}
        </div>
        {p.logoUrl && <img className="logo" src={p.logoUrl} alt="" />}
      </header>

      <div className="row" style={{ alignItems: 'stretch' }}>
        {party(tt('invoice.seller'), p.profile)}
        {party(tt('invoice.buyer'), p.customer)}
      </div>

      <table>
        <thead>
          <tr>
            <th className="n">#</th>
            <th>{tt('invoice.description')}</th>
            <th className="n">{tt('invoice.qty')}</th>
            <th className="n">{tt('invoice.unitPrice')}</th>
            <th className="n">{tt('invoice.lineDiscount')}</th>
            <th className="n">{tt('invoice.amount')}</th>
          </tr>
        </thead>
        <tbody>
          {p.items.map((it, i) => (
            <tr key={it.id}>
              <td className="n">{digits(i + 1)}</td>
              <td>{it.description}</td>
              <td className="n">
                <span className="num">{digits(formatQuantity(it.quantity_milli))}</span>
              </td>
              <td className="n">{m(it.unit_price_minor)}</td>
              <td className="n">{it.discount_minor > 0n ? m(it.discount_minor) : '—'}</td>
              <td className="n">{m(totals.lines[i]!.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <QrCode text={qr} label={tt('invoice.qr')} />
        {totalsBlock}
      </div>
      {wordsText && (
        <p className="words">
          {tt('invoice.inWords')}: {wordsText}
        </p>
      )}
      {inv.notes && <p className="muted">{inv.notes}</p>}

      <footer className="row" style={{ alignItems: 'stretch' }}>
        <div className={tpl === 'official' ? 'stamp grow' : 'grow sig'}>
          <div className="muted">{tt('invoice.sellerSignature')}</div>
          {p.signatureUrl && <span className="sig">{<img src={p.signatureUrl} alt={tt('invoice.signature')} />}</span>}
        </div>
        <div className={tpl === 'official' ? 'stamp grow' : 'grow'}>
          <div className="muted">{tt('invoice.buyerSignature')}</div>
        </div>
      </footer>
    </article>
  );
}
