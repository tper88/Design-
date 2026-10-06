/* ==========================================================================
   TB XLSX v1.0 — generator prawdziwych plików .xlsx bez żadnej biblioteki.

   TBXlsx.build([{ name, columns:[{label, type, format, width}], rows:[[...]] }])
       → Blob (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)

   ZIP bez kompresji (metoda 0) + własna tablica CRC32 + XML OOXML.

   Po co, skoro jest CSV: CSV traci typy. Tutaj liczba zostaje liczbą, data datą
   (serial Excela), bool boolem, a enum eksportuje się jako LABELKA, nie wartość
   techniczna. To jest cała różnica między „plikiem, który Excel otworzy"
   a „eksportem do Excela".

   type kolumny: text | longtext | number | date | enum | bool
   format kolumny (dla number): num | int | pln | usd | pct | compact

   Ograniczenie, którego nie udajemy: daty przed 1900-03-01 lecą jako TEKST.
   Excel ma tam błąd roku 1900 (traktuje 1900 jako przestępny) i każdy serial
   policzony dla tego zakresu byłby o dzień przesunięty.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------ CRC32 */

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  var enc = new TextEncoder();
  function utf8(s) { return enc.encode(s); }

  /* ------------------------------------------------------------ ZIP (store) */

  function dosDateTime(d) {
    var time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) |
               ((Math.floor(d.getSeconds() / 2)) & 0x1F);
    var date = (((d.getFullYear() - 1980) & 0x7F) << 9) |
               (((d.getMonth() + 1) & 0x0F) << 5) | (d.getDate() & 0x1F);
    return { time: time, date: date };
  }

  function zip(entries) {
    var now = dosDateTime(new Date());
    var parts = [], central = [], offset = 0;

    entries.forEach(function (e) {
      var name = utf8(e.name);
      var data = e.data;
      var crc = crc32(data);

      // nagłówek lokalny: 30 bajtów + nazwa
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034B50, true);
      lh.setUint16(4, 20, true);          // wersja potrzebna
      lh.setUint16(6, 0x0800, true);      // flaga: nazwa w UTF-8
      lh.setUint16(8, 0, true);           // metoda 0 = store
      lh.setUint16(10, now.time, true);
      lh.setUint16(12, now.date, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true);
      lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true);
      lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);

      // wpis w katalogu centralnym: 46 bajtów + nazwa
      var cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014B50, true);
      cd.setUint16(4, 20, true);          // wersja twórcy
      cd.setUint16(6, 20, true);          // wersja potrzebna
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, now.time, true);
      cd.setUint16(14, now.date, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, name.length, true);
      cd.setUint16(30, 0, true);
      cd.setUint16(32, 0, true);
      cd.setUint16(34, 0, true);
      cd.setUint16(36, 0, true);
      cd.setUint32(38, 0, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), name);

      offset += 30 + name.length + data.length;
    });

    var cdSize = central.reduce(function (s, p) { return s + p.length; }, 0);
    var eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054B50, true);
    eocd.setUint16(4, 0, true);
    eocd.setUint16(6, 0, true);
    eocd.setUint16(8, entries.length, true);
    eocd.setUint16(10, entries.length, true);
    eocd.setUint32(12, cdSize, true);
    eocd.setUint32(16, offset, true);
    eocd.setUint16(20, 0, true);

    return new Blob(parts.concat(central, [new Uint8Array(eocd.buffer)]), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  /* ------------------------------------------------------------ XML */

  function xmlEsc(s) {
    return String(s)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')   // Excel odrzuca te znaki
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function colLetter(i) {
    var s = '';
    i += 1;
    while (i > 0) {
      var r = (i - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  }

  /* Serial Excela: dni od 1899-12-30. Zwraca null poza bezpiecznym zakresem. */
  var EPOCH = Date.UTC(1899, 11, 30);
  var MIN_SAFE = Date.UTC(1900, 2, 1);   // 1900-03-01

  function dateSerial(value) {
    var y, m, d;
    if (value instanceof Date) {
      y = value.getFullYear(); m = value.getMonth() + 1; d = value.getDate();
    } else {
      var mm = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
      if (!mm) return null;
      y = +mm[1]; m = +mm[2]; d = +mm[3];
    }
    var ms = Date.UTC(y, m - 1, d);
    if (isNaN(ms) || ms < MIN_SAFE) return null;
    return Math.round((ms - EPOCH) / 86400000);
  }

  /* ------------------------------------------------------------ style
     Indeksy cellXfs używane przez writer. Kolejność jest kontraktem
     z sheetXml() poniżej. */
  var XF = {
    base: 0,      // domyślny
    head: 1,      // nagłówek: pogrubiony, tło, dolna krawędź
    date: 2,      // yyyy-mm-dd
    pln: 3,
    usd: 4,
    pct: 5,
    int: 6,
    num: 7
  };

  var STYLES_XML =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="6">' +
      '<numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/>' +
      '<numFmt numFmtId="165" formatCode="#,##0.00&quot; zł&quot;"/>' +
      '<numFmt numFmtId="166" formatCode="&quot;$&quot;#,##0"/>' +
      '<numFmt numFmtId="167" formatCode="0.0&quot;%&quot;"/>' +
      '<numFmt numFmtId="168" formatCode="#,##0"/>' +
      '<numFmt numFmtId="169" formatCode="#,##0.00"/>' +
    '</numFmts>' +
    '<fonts count="2">' +
      '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
    '</fonts>' +
    // fills[0]=none i fills[1]=gray125 są wymagane przez OOXML
    '<fills count="3">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid">' +
        '<fgColor rgb="FFEFEFEF"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2">' +
      '<border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left/><right/><top/>' +
        '<bottom style="thin"><color rgb="FFB0B0B0"/></bottom><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="8">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="168" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="169" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function numberStyle(format) {
    switch (format) {
      case 'pln': return XF.pln;
      case 'usd': return XF.usd;
      case 'pct': return XF.pct;
      case 'int': return XF.int;
      case 'compact': return XF.int;
      default: return XF.num;
    }
  }

  /* ------------------------------------------------------------ arkusz */

  function cell(ref, value, col) {
    if (value == null || value === '') return '';
    var type = col && col.type;

    if (type === 'bool') {
      return '<c r="' + ref + '" t="b"><v>' + (value ? 1 : 0) + '</v></c>';
    }
    if (type === 'number') {
      var n = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
      if (!isFinite(n)) return inlineStr(ref, value, XF.base);
      return '<c r="' + ref + '" s="' + numberStyle(col.format) + '"><v>' + n + '</v></c>';
    }
    if (type === 'date') {
      var serial = dateSerial(value);
      // poza bezpiecznym zakresem data leci jako tekst, nie jako przesunięty serial
      if (serial == null) return inlineStr(ref, value, XF.base);
      return '<c r="' + ref + '" s="' + XF.date + '"><v>' + serial + '</v></c>';
    }
    return inlineStr(ref, value, XF.base);
  }

  function inlineStr(ref, value, style) {
    return '<c r="' + ref + '" t="inlineStr"' + (style ? ' s="' + style + '"' : '') +
      '><is><t xml:space="preserve">' + xmlEsc(value) + '</t></is></c>';
  }

  function sheetXml(sheet) {
    var cols = sheet.columns || [];
    var rows = sheet.rows || [];
    var lastCol = colLetter(Math.max(0, cols.length - 1));
    var lastRow = rows.length + 1;
    var dim = 'A1:' + lastCol + lastRow;

    var out = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
      '<dimension ref="' + dim + '"/>',
      // zamrożony wiersz nagłówka
      '<sheetViews><sheetView workbookViewId="0">',
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>',
      '</sheetView></sheetViews>',
      '<sheetFormatPr defaultRowHeight="15"/>'
    ];

    if (cols.length) {
      out.push('<cols>');
      cols.forEach(function (c, i) {
        var w = c.width || Math.min(44, Math.max(10, String(c.label || '').length + 4));
        out.push('<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>');
      });
      out.push('</cols>');
    }

    out.push('<sheetData>');
    out.push('<row r="1">');
    cols.forEach(function (c, i) {
      out.push(inlineStr(colLetter(i) + '1', c.label == null ? '' : c.label, XF.head));
    });
    out.push('</row>');

    rows.forEach(function (row, r) {
      var n = r + 2;
      out.push('<row r="' + n + '">');
      cols.forEach(function (c, i) {
        out.push(cell(colLetter(i) + n, row[i], c));
      });
      out.push('</row>');
    });
    out.push('</sheetData>');

    // autoFilter musi stać PO sheetData — kolejność elementów w OOXML jest wiążąca
    if (cols.length && rows.length) out.push('<autoFilter ref="' + dim + '"/>');
    out.push('</worksheet>');
    return out.join('');
  }

  /* Nazwa arkusza: Excel nie dopuszcza : \ / ? * [ ] i max 31 znaków. */
  function sheetName(name, index, used) {
    var s = String(name == null ? '' : name).replace(/[:\\\/\?\*\[\]]/g, ' ').trim();
    if (!s) s = 'Arkusz' + (index + 1);
    s = s.slice(0, 31);
    var base = s, k = 2;
    while (used[s.toLowerCase()]) {
      var suffix = ' (' + k + ')';
      s = base.slice(0, 31 - suffix.length) + suffix;
      k++;
    }
    used[s.toLowerCase()] = true;
    return s;
  }

  /* ------------------------------------------------------------ build */

  function build(sheets) {
    if (!sheets || !sheets.length) sheets = [{ name: 'Arkusz1', columns: [], rows: [] }];
    var used = {};
    var named = sheets.map(function (s, i) {
      return {
        name: sheetName(s.name, i, used),
        columns: s.columns || [],
        rows: s.rows || []
      };
    });

    var contentTypes =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      named.map(function (s, i) {
        return '<Override PartName="/xl/worksheets/sheet' + (i + 1) +
          '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      }).join('') +
      '</Types>';

    var rootRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Target="xl/workbook.xml" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"/>' +
      '</Relationships>';

    var workbook =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' +
      named.map(function (s, i) {
        return '<sheet name="' + xmlEsc(s.name) + '" sheetId="' + (i + 1) +
          '" r:id="rId' + (i + 1) + '"/>';
      }).join('') +
      '</sheets></workbook>';

    var wbRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      named.map(function (s, i) {
        return '<Relationship Id="rId' + (i + 1) + '" Target="worksheets/sheet' + (i + 1) +
          '.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>';
      }).join('') +
      '<Relationship Id="rId' + (named.length + 1) + '" Target="styles.xml" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"/>' +
      '</Relationships>';

    var entries = [
      { name: '[Content_Types].xml', data: utf8(contentTypes) },
      { name: '_rels/.rels', data: utf8(rootRels) },
      { name: 'xl/workbook.xml', data: utf8(workbook) },
      { name: 'xl/_rels/workbook.xml.rels', data: utf8(wbRels) },
      { name: 'xl/styles.xml', data: utf8(STYLES_XML) }
    ];
    named.forEach(function (s, i) {
      entries.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: utf8(sheetXml(s)) });
    });

    return zip(entries);
  }

  global.TBXlsx = {
    build: build,
    dateSerial: dateSerial,
    colLetter: colLetter,
    _crc32: crc32
  };
})(window);
