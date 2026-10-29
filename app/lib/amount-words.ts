// Persian amount in words — «مبلغ به حروف».
//
// A حکم prints its total twice: as a number and spelled out, so that a smudged
// digit cannot change what the paper says. The spelling follows the paper's own
// convention («یک میلیارد و دویست و سه میلیون و دویست و نود و پنج هزار و …»),
// including the bare «هزار» where a leading «یک» would read oddly.
//
// It is a pure function with no database and no locale dependency, which is why
// it is its own module and its own test.
const ONES = ["", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه"];
const TEENS = ["ده", "یازده", "دوازده", "سیزده", "چهارده", "پانزده", "شانزده", "هفده", "هجده", "نوزده"];
const TENS = ["", "", "بیست", "سی", "چهل", "پنجاه", "شصت", "هفتاد", "هشتاد", "نود"];
const HUNDREDS = ["", "صد", "دویست", "سیصد", "چهارصد", "پانصد", "ششصد", "هفتصد", "هشتصد", "نهصد"];
const SCALES = ["", " هزار", " میلیون", " میلیارد", " هزار میلیارد"];
/** 10^15 — beyond this a Rial figure is not a payroll number any more. */
const LIMIT = 1_000_000_000_000_000;

function under1000(value: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  if (hundreds) parts.push(HUNDREDS[hundreds]);
  if (rest >= 10 && rest < 20) parts.push(TEENS[rest - 10]);
  else {
    const tens = Math.floor(rest / 10);
    const ones = rest % 10;
    if (tens) parts.push(TENS[tens]);
    if (ones) parts.push(ONES[ones]);
  }
  return parts.join(" و ");
}

export function amountInWords(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("مبلغ باید عدد صحیح و نامنفی باشد");
  if (value >= LIMIT) throw new Error("مبلغ برای خواندن به حروف بزرگ‌تر از حد مجاز است");
  if (value === 0) return "صفر";
  const groups: number[] = [];
  for (let rest = value; rest > 0; rest = Math.floor(rest / 1000)) groups.push(rest % 1000);
  const parts: string[] = [];
  for (let index = groups.length - 1; index >= 0; index--) {
    const group = groups[index];
    if (!group) continue;
    // «هزار و پانصد» reads correctly; «یک هزار» does not. Millions and billions
    // keep the «یک», because «میلیون» alone is not a phrase.
    if (index === 1 && group === 1) parts.push("هزار");
    else parts.push(`${under1000(group)}${SCALES[index]}`);
  }
  return parts.join(" و ");
}

/** The same figure with Persian digits and group separators, as the paper shows it. */
export function rialText(value: number) {
  return Number(value || 0).toLocaleString("fa-IR");
}
