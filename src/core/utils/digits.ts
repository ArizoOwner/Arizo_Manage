const FA = '۰۱۲۳۴۵۶۷۸۹';
const AR = '٠١٢٣٤٥٦٧٨٩';

export const toAsciiDigits = (s: string): string =>
  s.replace(/[۰-۹]/g, (d) => String(FA.indexOf(d))).replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)));

export const toPersianDigits = (s: string): string => s.replace(/[0-9]/g, (d) => FA[Number(d)]!);

export const onlyDigits = (s: string): string => toAsciiDigits(s).replace(/\D/g, '');
