/** Locale-independent number formatting (Hermes Intl support varies, so no toLocaleString). */

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 1200 -> "1,200"; rounds to an integer. */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n);
  const sign = r < 0 ? '-' : '';
  return sign + groupThousands(String(Math.abs(r)));
}

/** 123456 -> "$1,234.56"; -150 -> "-$1.50". Fractional cents are rounded. */
export function formatCents(c: number): string {
  if (!Number.isFinite(c)) c = 0;
  const r = Math.round(c);
  const sign = r < 0 ? '-' : '';
  const abs = Math.abs(r);
  const dollars = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${sign}$${groupThousands(String(dollars))}.${String(cents).padStart(2, '0')}`;
}

/** Cents as a plain decimal for CSV ("1234.56", no $ or grouping, so spreadsheets read it as a number). */
export function centsPlain(c: number): string {
  const r = Math.round(Number.isFinite(c) ? c : 0);
  const sign = r < 0 ? '-' : '';
  const abs = Math.abs(r);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
