// The pure layer under حکم and امضا — no database, so this file runs anywhere.
//
// What a paper says is decided by these functions rather than by a page: the
// amount spelled in words, the letter a row takes, how a submitted item row is
// made safe, and what counts as a signature image. `tests/hr-hokm.test.cjs`
// covers the same rules as they are stored; this one covers what they compute.
require("./register-workflow.cjs");
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {amountInWords, rialText} = require("../app/lib/amount-words.ts");
const hokm = require("../app/lib/hokm-items.ts");
const {normalizeSignature, pngSize, MAX_SIGNATURE_SIDE, MAX_SIGNATURE_BYTES} = require("../app/lib/signature-image.ts");

// A one-pixel PNG: the smallest thing that is still a real PNG.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("the amount is spelled the way the paper spells it", () => {
  // The exact figure printed on the reference حکم: ۱٫۲۰۳٫۲۹۵٫۷۱۵ ریال.
  assert.equal(amountInWords(1203295715), "یک میلیارد و دویست و سه میلیون و دویست و نود و پنج هزار و هفتصد و پانزده");
  assert.equal(amountInWords(0), "صفر");
  assert.equal(amountInWords(100), "صد");
  assert.equal(amountInWords(101), "صد و یک");
  assert.equal(amountInWords(999), "نهصد و نود و نه");
  // A bare «هزار» for one thousand, but «یک میلیون» and «یک میلیارد».
  assert.equal(amountInWords(1000), "هزار");
  assert.equal(amountInWords(1500), "هزار و پانصد");
  assert.equal(amountInWords(1200000), "یک میلیون و دویست هزار");
  assert.equal(amountInWords(1000000000), "یک میلیارد");
  assert.equal(amountInWords(999999), "نهصد و نود و نه هزار و نهصد و نود و نه");
  // Only whole, non-negative, readable amounts have a spelling.
  assert.throws(() => amountInWords(-1));
  assert.throws(() => amountInWords(1.5));
  assert.throws(() => amountInWords(1_000_000_000_000_000));
  assert.equal(rialText(1203295715), Number(1203295715).toLocaleString("fa-IR"));
});

test("an item row takes the alphabet's next letter, then a serial", () => {
  assert.equal(hokm.letterFor(0), "الف");
  assert.equal(hokm.letterFor(1), "ب");
  assert.equal(hokm.letterFor(2), "پ");
  assert.equal(hokm.letterFor(hokm.ITEM_LETTERS.length - 1), "ی");
  // Beyond the alphabet the rows are numbered rather than letterless.
  assert.equal(hokm.letterFor(hokm.ITEM_LETTERS.length), String(hokm.ITEM_LETTERS.length + 1));
});

test("a submitted item row is made safe against its catalogue", () => {
  const fallback = [{key: "base", label: "پایه استحقاقی", kind: "EARNING"}, {key: "insurance", label: "بیمه", kind: "DEDUCTION"}];
  const items = hokm.normalizeItems([{key: "base", label: "چیز دیگری", amount: "1,200,000,000"}, {key: "insurance", amount: "100000"}], fallback);
  assert.deepEqual(items.map(item => item.letter), ["الف", "ب"]);
  assert.equal(items[0].label, "چیز دیگری"); // a submitted label is honoured…
  assert.equal(items[1].label, "بیمه"); // … and a missing one falls back to the catalogue
  assert.equal(items[0].amount, 1200000000); // separators are tolerated: a form sends them
  assert.equal(items[1].kind, "DEDUCTION");
  assert.deepEqual(items.map(item => item.sortOrder), [0, 1]);
  // Nothing submitted is no rows, not an error.
  assert.deepEqual(hokm.normalizeItems(undefined, fallback), []);
  const rows = (input, over = {}) => () => hokm.normalizeItems(input, over.fallback);
  assert.throws(rows([{key: "base", label: "الف"}, {key: "base", label: "ب"}]), e => e.status === 400); // duplicate key
  assert.throws(rows([{key: "شناسهٔ فارسی", label: "الف"}]), e => e.status === 400); // not a stable key
  assert.throws(rows([{key: "base", label: "الف", amount: -5}]), e => e.status === 400); // negative money
  assert.throws(rows([{key: "base", label: "الف", kind: "OTHER"}]), e => e.status === 400); // unknown kind
  assert.throws(rows("not-an-array"), e => e.status === 400);
});

test("جمع حکم separates what is paid from what is withheld", () => {
  assert.deepEqual(hokm.itemTotals([{kind: "EARNING", amount: 1000}, {kind: "DEDUCTION", amount: 300}, {kind: "EARNING", amount: 200}]), {earnings: 1200, deductions: 300, net: 900});
  assert.deepEqual(hokm.itemTotals([]), {earnings: 0, deductions: 0, net: 0});
  // A paper may withhold more than it pays; the negative جمع is reported as it is
  // and the print page spells zero rather than a negative amount.
  assert.deepEqual(hokm.itemTotals([{kind: "DEDUCTION", amount: 500}]), {earnings: 0, deductions: 500, net: -500});
});

test("a signature is a small PNG, and nothing else", () => {
  const accepted = normalizeSignature(PNG);
  assert.equal(accepted.image, PNG);
  assert.deepEqual({width: accepted.width, height: accepted.height}, {width: 1, height: 1});
  assert.equal(pngSize(Buffer.from("not a png")), null);
  assert.throws(() => normalizeSignature(""), e => e.status === 400);
  assert.throws(() => normalizeSignature("data:image/svg+xml;base64,PHN2Zy8+"), e => e.status === 400); // the MIME is not taken on trust
  assert.throws(() => normalizeSignature("data:image/png;base64,bm90IGEgcG5n"), e => e.status === 400); // base64 of a non-PNG
  // The bounds are the module's, not the client's.
  const big = Buffer.alloc(MAX_SIGNATURE_BYTES + 1);
  Buffer.from(PNG.split(",")[1], "base64").copy(big);
  assert.throws(() => normalizeSignature(`data:image/png;base64,${big.toString("base64")}`), e => e.status === 400);
  assert.equal(MAX_SIGNATURE_SIDE, 1200);
});
