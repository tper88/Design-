/* tb-parse.js — czytanie wartości wklejonych z Excela albo z pliku CSV.

   Jeden moduł dla trackera i kreatora, żeby „co jest liczbą, a co datą”
   znaczyło w obu miejscach to samo.

   TBParse.number(v, locale)      → liczba albo null
   TBParse.date(v, locale)        → 'RRRR-MM-DD' albo null
   TBParse.bool(v)                → true / false / null (nie wiadomo)
   TBParse.delimited(text, delim) → tablica wierszy (tablic stringów)
   TBParse.sniff(text)            → separator: '\t' | ';' | ','

   null znaczy „nie umiem tego przeczytać”. Wołający decyduje, co z tym
   zrobić — tracker zostawia wtedy surową wartość i pokazuje ostrzeżenie,
   zamiast po cichu wpisać zero albo pustą datę.

   Pułapki, które ten plik zamyka (wszystkie były realne):
   - "1,234.56" w angielskim formacie dawało 1.234 (przecinek brany za ułamek)
   - "06/10/2026" w en-GB i "06.10.2026" w pl-PL Chrome czyta jako 10 czerwca;
     cichy błąd dla każdego dnia ≤ 12
   - PRAWDA / FAŁSZ z polskiego Excela nie były rozpoznawane
   - cudzysłów w środku komórki (Monitor 24") włączał tryb cytatu i połykał
     resztę wklejki */

(function (global) {
  'use strict';

  /* Kolejność dnia i miesiąca w zapisie d/m/r. Tylko en-US stawia miesiąc
     pierwszy; pozostałe obsługiwane locale (en-GB, pl-PL) — dzień. */
  function monthFirst(locale) { return /^en-US$/i.test(locale || ''); }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* Składa datę i sprawdza, że istnieje (31.02 → null, a nie 3 marca). */
  function ymd(y, m, d) {
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1000 && y <= 9999)) return null;
    var t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
    return y + '-' + pad(m) + '-' + pad(d);
  }

  /* Rok dwucyfrowy według reguły Excela: 00–29 → 20xx, 30–99 → 19xx. */
  function fullYear(y) {
    if (y.length === 4) return +y;
    var n = +y;
    return n < 30 ? 2000 + n : 1900 + n;
  }

  /* Prefiksy nazw miesięcy, angielskie i polskie (mianownik i dopełniacz
     zaczynają się tak samo). Konfliktów między językami nie ma: „mar” i „maj”
     /„may” znaczą w obu to samo. */
  var MONTHS = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    sty: 1, lut: 2, kwi: 4, maj: 5, cze: 6, lip: 7, sie: 8, wrz: 9, 'paź': 10, paz: 10, lis: 11, gru: 12
  };
  function monthOf(word) {
    var k = String(word).toLowerCase().slice(0, 3);
    return MONTHS[k] || null;
  }

  /* Serial Excela: dni od 1899-12-30. Przyjmujemy tylko 5 cyfr (rok 1927–2173),
     bo krótsza liczba w kolumnie dat to prędzej literówka niż data. */
  function fromSerial(n) {
    var t = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
    return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }

  function date(v, locale) {
    if (v == null || v === '') return null;
    if (v instanceof Date) {
      return isNaN(v.getTime()) ? null : ymd(v.getFullYear(), v.getMonth() + 1, v.getDate());
    }
    var s = String(v).trim();
    if (!s) return null;
    var m;

    /* ISO i jego warianty z kropką albo ukośnikiem: 2026-10-06, 2026.10.06 */
    if ((m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:$|[ T,])/.exec(s))) return ymd(+m[1], +m[2], +m[3]);

    /* d.m.r, d/m/r, d-m-r — z opcjonalną godziną po spacji, którą odcinamy */
    if ((m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?:$|[ T,])/.exec(s))) {
      var a = +m[1], b = +m[2], y = fullYear(m[3]);
      var mf = monthFirst(locale);
      /* Liczba > 12 rozstrzyga sama, niezależnie od locale. */
      if (a > 12 && b <= 12) mf = false;
      else if (b > 12 && a <= 12) mf = true;
      return mf ? ymd(y, a, b) : ymd(y, b, a);
    }

    if (/^\d{5}(\.\d+)?$/.test(s)) return fromSerial(parseFloat(s));

    /* 6 Oct 2026, 6 października 2026, 6-Oct-26 */
    if ((m = /^(\d{1,2})[\s.\-]+([A-Za-zÀ-ž]+)\.?[\s.\-,]+(\d{4}|\d{2})\b/.exec(s)) && monthOf(m[2])) {
      return ymd(fullYear(m[3]), monthOf(m[2]), +m[1]);
    }
    /* Oct 6, 2026 */
    if ((m = /^([A-Za-zÀ-ž]+)\.?\s+(\d{1,2}),?\s+(\d{4})\b/.exec(s)) && monthOf(m[1])) {
      return ymd(+m[3], monthOf(m[1]), +m[2]);
    }
    return null;
  }

  /* Waluty i jednostki, które Excel dokleja do wyświetlanej liczby. */
  var CURRENCY_RE = /zł|pln|eur|usd|gbp|chf|€|\$|£|¥/gi;

  function number(v, locale) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).trim();
    if (!s) return null;

    var neg = false;
    /* format księgowy: (1 234,56) */
    var paren = /^\((.*)\)$/.exec(s);
    if (paren) { neg = true; s = paren[1]; }

    /* Wszystkie odmiany spacji (w tym NBSP i wąska NBSP, których pl-PL używa
       jako separatora tysięcy) i apostrof szwajcarski. */
    s = s.replace(/[\s\u00a0\u2007\u2009\u202f']/g, '').replace(CURRENCY_RE, '').replace(/%$/, '');
    s = s.replace(/^\u2212/, '-');            // typograficzny minus
    if (/^[-+]/.test(s)) { if (s[0] === '-') neg = !neg; s = s.slice(1); }
    if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1); }

    if (/^\d+(\.\d+)?e[-+]?\d+$/i.test(s)) {
      var e = parseFloat(s);
      return isFinite(e) ? (neg ? -e : e) : null;
    }
    if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

    var lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
    var commas = s.split(',').length - 1, dots = s.split('.').length - 1;

    if (commas && dots) {
      /* oba obecne: ostatni jest separatorem dziesiętnym, drugi to tysiące */
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (commas) {
      if (commas > 1) s = s.replace(/,/g, '');
      else if (!/^pl/i.test(locale || '') && /^\d{1,3},\d{3}$/.test(s)) s = s.replace(',', '');
      else s = s.replace(',', '.');
    } else if (dots > 1) {
      s = s.replace(/\./g, '');               // 1.234.567
    }
    if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null;
    var n = parseFloat(s);
    if (!isFinite(n)) return null;
    return neg ? -n : n;
  }

  var TRUE_SET = { '1': 1, 'true': 1, 'yes': 1, 'y': 1, 'x': 1, 't': 1, 'tak': 1, 'prawda': 1,
    '✓': 1, '✔': 1, 'done': 1, 'on': 1 };
  var FALSE_SET = { '0': 1, 'false': 1, 'no': 1, 'n': 1, 'nie': 1, 'fałsz': 1, 'falsz': 1,
    'off': 1, '✗': 1, '✘': 1, '-': 1, '—': 1 };

  function bool(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (v == null) return null;
    var s = String(v).trim().toLowerCase();
    if (s === '') return false;
    if (TRUE_SET[s]) return true;
    if (FALSE_SET[s]) return false;
    return null;
  }

  /* Separator z pierwszych 5 linii. Tabulator wygrywa remisy, bo to on
     przychodzi ze schowka Excela. */
  function sniff(text) {
    var head = String(text).split(/\r?\n/).slice(0, 5).join('\n');
    var best = '\t', bestN = head.split('\t').length - 1;
    [';', ','].forEach(function (d) {
      var n = head.split(d).length - 1;
      if (n > bestN) { best = d; bestN = n; }
    });
    return bestN ? best : '\t';
  }

  /* Parser CSV/TSV. Cudzysłów otwiera cytat TYLKO na początku pola — w środku
     pola jest zwykłym znakiem (Excel nie cytuje komórki „Monitor 24"”). Wewnątrz
     cytatu "" to jeden cudzysłów, a samotny " przed czymś innym niż separator
     albo koniec linii też jest traktowany dosłownie, zamiast zamykać pole. */
  function delimited(text, delim) {
    text = String(text == null ? '' : text).replace(/^\ufeff/, '');
    if (!delim) delim = sniff(text);
    var rows = [], row = [], f = '', inQ = false, fresh = true, i = 0, n = text.length;
    while (i < n) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') {
          var nx = text[i + 1];
          if (nx === '"') { f += '"'; i += 2; continue; }
          if (nx === undefined || nx === delim || nx === '\n' || nx === '\r') { inQ = false; i++; continue; }
          f += '"'; i++; continue;
        }
        f += ch; i++; continue;
      }
      if (ch === '"' && fresh) { inQ = true; fresh = false; i++; continue; }
      if (ch === delim) { row.push(f); f = ''; fresh = true; i++; continue; }
      if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(f); f = ''; rows.push(row); row = []; fresh = true; i++; continue;
      }
      f += ch; fresh = false; i++;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
  }

  global.TBParse = { number: number, date: date, bool: bool, delimited: delimited, sniff: sniff };
})(window);
