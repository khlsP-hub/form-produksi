// utils/excelBuilder.js
// ─────────────────────────────────────────────────────────────────────────────
// Utility untuk membangun file Excel laporan permasalahan produksi.
// Dipisahkan dari MoreScreen.js agar kode lebih bersih dan mudah dimaintain.
//
// Dependencies: xlsx (SheetJS)
// ─────────────────────────────────────────────────────────────────────────────

import XLSX from 'xlsx';
import * as FileSystem from 'expo-file-system/legacy';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

export const parseNum = (s) => {
  if (!s && s !== 0) return 0;
  const str = String(s).trim();
  if (!str) return 0;
  if (str.includes(',')) return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
  return parseFloat(str) || 0;
};

export const parseDate = (str) => {
  if (!str) return null;
  const p = str.split('/');
  if (p.length !== 3) return null;
  return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
};

// ─── Konstanta header kolom ───────────────────────────────────────────────────
export const HEADERS = [
  'NO', 'TANGGAL', 'BAGIAN PRODUKSI', 'NAMA PRODUK', 'NO MESIN',
  'BERAT (gr)', 'SHIFT', 'OUTPUT (pcs)', 'CAVITY', 'CYCLE TIME',
  'NAMA KARU', 'DOWN TIME', 'PERMASALAHAN', 'TOTAL REJECT (KG)',
  'PENANGANAN', 'NAMA ASISTEN', 'STATUS',
];

// Lebar kolom dalam karakter
export const COL_WIDTHS = [
  5,   // NO
  12,  // TANGGAL
  10,  // BAGIAN PRODUKSI
  36,  // NAMA PRODUK
  10,  // NO MESIN
  8,   // BERAT
  8,   // SHIFT
  10,  // OUTPUT
  8,   // CAVITY
  10,  // CYCLE TIME
  14,  // NAMA KARU
  16,  // DOWN TIME
  34,  // PERMASALAHAN
  14,  // TOTAL REJECT
  30,  // PENANGANAN
  14,  // NAMA ASISTEN
  9,   // STATUS
];

// Kolom yang di-center (1-based index)
const CENTER_COLS = new Set([1, 2, 5, 6, 7, 8, 9, 10, 14, 16, 17]);

// ─── Warna & Style (ARGB tanpa #) ────────────────────────────────────────────
const C = {
  // Header utama
  headerBg:       'FF1565C0',   // biru tua (sesuai warna app)
  headerFont:     'FFFFFFFF',   // putih

  // Sub-header info form (tanggal, bagian, produk, mesin, berat)
  infoBg:         'FF0D47A1',   // biru lebih tua
  infoFont:       'FFFFFFFF',

  // Sub-header shift
  shiftBg:        'FF1976D2',   // biru medium
  shiftFont:      'FFFFFFFF',

  // Baris data
  rowOdd:         'FFFFFFFF',   // putih
  rowEven:        'FFF0F6FF',   // biru sangat muda
  dataFont:       'FF1A1A2E',   // hampir hitam

  // Status khusus
  statusOpen_bg:  'FFFFEBEE',   // merah muda
  statusOpen_font:'FFC62828',   // merah tua
  statusClose_bg: 'FFE8F5E9',   // hijau muda
  statusClose_font:'FF2E7D32',  // hijau tua

  // Baris "tidak ada permasalahan"
  noPermas_bg:    'FFFFFDE7',   // kuning muda
  noPermas_font:  'FF5D4037',   // coklat

  // Reject tinggi (> 0)
  reject_bg:      'FFFFF3E0',   // oranye sangat muda
  reject_font:    'FFE65100',   // oranye tua

  // Border
  borderThin:     'FFB0C4DE',   // biru abu-abu muda
  borderMedium:   'FF90A4AE',   // lebih gelap untuk pemisah

  // Ringkasan
  summTitle_bg:   'FF0D47A1',
  summTitle_font: 'FFFFFFFF',
  summHead_bg:    'FF1565C0',
  summHead_font:  'FFFFFFFF',
  summTotal_bg:   'FF37474F',   // abu gelap
  summTotal_font: 'FFFFFFFF',
  summAlt:        'FFF5F9FF',
  good_font:      'FF2E7D32',
  warn_font:      'FFC62828',
};

// ─── Helper style builder ─────────────────────────────────────────────────────
function border(style = 'thin', color = C.borderThin) {
  const s = { style, color: { argb: color } };
  return { top: s, bottom: s, left: s, right: s };
}
function borderFat(side) {
  // border kanan/kiri lebih tebal untuk pemisah grup
  const thin = { style: 'thin',   color: { argb: C.borderThin } };
  const med  = { style: 'medium', color: { argb: C.borderMedium } };
  return {
    top:    thin, bottom: thin,
    left:   side === 'left'  ? med : thin,
    right:  side === 'right' ? med : thin,
  };
}

function fill(argb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function font(argb, bold = false, size = 9, name = 'Calibri') {
  return { bold, color: { argb }, size, name };
}

function align(h = 'left', v = 'middle', wrap = true) {
  return { horizontal: h, vertical: v, wrapText: wrap };
}

// ─── Flatten satu dokumen form ke baris-baris ─────────────────────────────────
// Setiap baris mengandung metadata tambahan untuk styling
export function flattenDoc(doc, startNo, filterShift) {
  const rows = [];
  let no = startNo;

  const baseInfo = {
    tanggal:        doc.tanggal        || '',
    bagianProduksi: doc.bagianProduksi || '',
    namaProduk:     doc.namaProduk     || doc.kodeProduk || '',
    noMesin:        doc.noMesin        || '',
    berat:          doc.berat != null  ? String(doc.berat) : '',
  };

  const shiftsToProcess = filterShift
    ? [parseInt(filterShift)].filter(n => [1, 2, 3].includes(n))
    : [1, 2, 3];

  for (const shiftNum of shiftsToProcess) {
    const shift = doc[`shift${shiftNum}`];
    if (!shift) continue;

    // Cek apakah shift ini benar-benar punya data bermakna
    const hasOutput = !!shift.output;
    const hasKaru   = !!shift.karu;
    if (!hasOutput && !hasKaru && !(shift.rows?.length)) continue;

    const shiftBase = {
      ...baseInfo,
      shift:     `Shift ${shiftNum}`,
      output:    shift.output    ? String(shift.output)    : '',
      cavity:    shift.cavity    ? String(shift.cavity)    : '',
      cycleTime: shift.cycleTime ? String(shift.cycleTime) : '',
      namaKaru:  shift.karu      || '',
    };

    const problemRows = (shift.rows || []).filter(r =>
      r.permasalahan || r.downtime || parseNum(r.totalReject) > 0
    );

    if (problemRows.length === 0) {
      rows.push({
        no:           no++,
        ...shiftBase,
        downtime:     '',
        permasalahan: 'Tidak ada permasalahan',
        totalReject:  '',
        penanganan:   '',
        namaAsisten:  '',
        status:       'CLOSE',
        _rowType:     'no_permas',   // untuk styling khusus
      });
    } else {
      for (const r of problemRows) {
        const rejectVal = r.totalReject ? String(r.totalReject) : '';
        rows.push({
          no:           no++,
          ...shiftBase,
          downtime:     r.downtime     || '',
          permasalahan: r.permasalahan || '',
          totalReject:  rejectVal,
          penanganan:   r.penanganan   || '',
          namaAsisten:  r.namaAsisten  || '',
          status:       (r.status || 'open').toUpperCase(),
          _rowType:     'permasalahan',
          _hasReject:   parseNum(r.totalReject) > 0,
        });
      }
    }
  }

  return { rows, nextNo: no };
}

// ─── Analisis dokumen untuk ringkasan ────────────────────────────────────────
// Menghitung semua metrik terpisah dari filterOpts agar ringkasan akurat
export function analyzeAllDocs(allDocs, filteredDocs, filterOpts) {
  // Statistik TOTAL (semua dokumen, sebelum filter)
  const total = {
    forms:         allDocs.length,
    shifts:        0,
    shiftFull:     0,   // shift dengan output + karu + ada permasalahan
    shiftPartial:  0,   // shift dengan beberapa field tapi tidak lengkap
    shiftNoPermas: 0,   // shift yang terisi output/karu tapi tidak ada permasalahan
    permasalahan:  0,   // total baris permasalahan
    open:          0,
    close:         0,
    rejectKg:      0,
  };

  // Statistik PER BAGIAN (dari filtered docs)
  const byBagian = {};

  // Analisis allDocs untuk total keseluruhan
  for (const doc of allDocs) {
    for (const sn of [1, 2, 3]) {
      const shift = doc[`shift${sn}`];
      if (!shift) continue;

      const hasOutput = !!shift.output;
      const hasKaru   = !!shift.karu;
      const rows = shift.rows || [];
      const problemRows = rows.filter(r => r.permasalahan || r.downtime || parseNum(r.totalReject) > 0);

      if (!hasOutput && !hasKaru && !rows.length) continue;

      total.shifts++;

      if (problemRows.length > 0) {
        if (hasOutput && hasKaru) {
          total.shiftFull++;
        } else {
          total.shiftPartial++;
        }
        total.permasalahan += problemRows.length;
        for (const r of problemRows) {
          if (r.status === 'open') total.open++;
          else total.close++;
          total.rejectKg += parseNum(r.totalReject);
        }
      } else {
        total.shiftNoPermas++;
      }
    }
  }

  // Analisis filteredDocs per bagian
  for (const doc of filteredDocs) {
    const bag = doc.bagianProduksi || 'LAINNYA';
    if (!byBagian[bag]) {
      byBagian[bag] = {
        forms: 0, shifts: 0,
        shiftFull: 0, shiftPartial: 0, shiftNoPermas: 0,
        permasalahan: 0, open: 0, close: 0,
        rejectKg: 0,
      };
    }
    const b = byBagian[bag];
    b.forms++;

    for (const sn of [1, 2, 3]) {
      const shift = doc[`shift${sn}`];
      if (!shift) continue;
      const hasOutput = !!shift.output;
      const hasKaru   = !!shift.karu;
      const rows = shift.rows || [];
      const problemRows = rows.filter(r => r.permasalahan || r.downtime || parseNum(r.totalReject) > 0);

      if (!hasOutput && !hasKaru && !rows.length) continue;
      b.shifts++;

      if (problemRows.length > 0) {
        if (hasOutput && hasKaru) b.shiftFull++;
        else b.shiftPartial++;
        b.permasalahan += problemRows.length;
        for (const r of problemRows) {
          if (r.status === 'open') b.open++;
          else b.close++;
          b.rejectKg += parseNum(r.totalReject);
        }
      } else {
        b.shiftNoPermas++;
      }
    }
  }

  // Statistik filtered (untuk header ringkasan)
  const filtered = {
    forms:         filteredDocs.length,
    shifts:        0,
    shiftFull:     0,
    shiftPartial:  0,
    shiftNoPermas: 0,
    permasalahan:  0,
    open:          0,
    close:         0,
    rejectKg:      0,
  };
  for (const val of Object.values(byBagian)) {
    filtered.shifts        += val.shifts;
    filtered.shiftFull     += val.shiftFull;
    filtered.shiftPartial  += val.shiftPartial;
    filtered.shiftNoPermas += val.shiftNoPermas;
    filtered.permasalahan  += val.permasalahan;
    filtered.open          += val.open;
    filtered.close         += val.close;
    filtered.rejectKg      += val.rejectKg;
  }

  return { total, filtered, byBagian };
}

// ─── Filter dokumen ───────────────────────────────────────────────────────────
export function applyFilters(docs, opts) {
  let result = docs;
  if (opts.bagian) {
    result = result.filter(d => d.bagianProduksi === opts.bagian);
  }
  if (opts.namaProduk?.trim()) {
    const q = opts.namaProduk.trim().toLowerCase();
    result = result.filter(d =>
      (d.namaProduk || '').toLowerCase().includes(q) ||
      (d.kodeProduk || '').toLowerCase().includes(q)
    );
  }
  if (opts.dateFrom || opts.dateTo) {
    const from = opts.dateFrom ? parseDate(opts.dateFrom) : null;
    const to   = opts.dateTo   ? parseDate(opts.dateTo)   : null;
    if (to) to.setHours(23, 59, 59, 999);
    result = result.filter(d => {
      const dt = parseDate(d.tanggal);
      if (!dt) return false;
      if (from && dt < from) return false;
      if (to   && dt > to)   return false;
      return true;
    });
  }
  if (opts.shift) {
    result = result.filter(d => {
      const shift = d[`shift${opts.shift}`];
      return !!shift;
    });
  }
  return result;
}

// ─── Bangun sheet Laporan ─────────────────────────────────────────────────────
function buildLaporanSheet(wb, sortedDocs, filterOpts, onProgress) {
  // Gunakan XLSX aoa_to_sheet, lalu terapkan style manual
  const sheetData = [HEADERS];
  const rowMeta   = [null]; // index 0 = header, tidak perlu meta

  let no = 1;
  const total = sortedDocs.length;
  let processed = 0;

  for (const doc of sortedDocs) {
    const { rows, nextNo } = flattenDoc(doc, no, filterOpts.shift);
    no = nextNo;
    for (const r of rows) {
      sheetData.push([
        r.no, r.tanggal, r.bagianProduksi, r.namaProduk, r.noMesin,
        r.berat, r.shift, r.output, r.cavity, r.cycleTime,
        r.namaKaru, r.downtime, r.permasalahan, r.totalReject,
        r.penanganan, r.namaAsisten, r.status,
      ]);
      rowMeta.push({
        status:     r.status,
        rowType:    r._rowType,
        hasReject:  r._hasReject,
      });
    }
    processed++;
    onProgress?.(Math.round((processed / total) * 70));
  }

  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  // ── Lebar kolom
  ws['!cols'] = COL_WIDTHS.map(wch => ({ wch }));

  // ── Freeze baris header
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  // ── Auto filter
  const lastRow = sheetData.length;
  ws['!autofilter'] = { ref: `A1:Q${lastRow}` };

  // ── Tinggi baris header
  ws['!rows'] = Array(lastRow).fill(null);
  ws['!rows'][0] = { hpt: 30 }; // header lebih tinggi

  // ── Terapkan style per sel ─────────────────────────────────────────────────
  const range = XLSX.utils.decode_range(ws['!ref']);

  for (let R = range.s.r; R <= range.e.r; R++) {
    const meta = rowMeta[R];
    const isHeader  = R === 0;
    const isEvenRow = R % 2 === 0; // alternating (R=1 = baris data pertama)

    for (let C = range.s.c; C <= range.e.c; C++) {
      const cellAddr = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[cellAddr]) ws[cellAddr] = { t: 's', v: '' }; // cell kosong tetap punya style

      const cell    = ws[cellAddr];
      const colIdx  = C + 1; // 1-based
      const isCenter = CENTER_COLS.has(colIdx);

      if (isHeader) {
        // ── Header
        cell.s = {
          fill:      fill(C.headerBg),
          font:      font(C.headerFont, true, 10),
          border:    border('medium', C.borderMedium),
          alignment: align('center', 'middle', true),
        };
      } else if (!meta) {
        // Baris tanpa meta → default
        cell.s = {
          fill:      fill(isEvenRow ? C.rowEven : C.rowOdd),
          font:      font(C.dataFont, false, 9),
          border:    border(),
          alignment: align(isCenter ? 'center' : 'left'),
        };
      } else {
        // ── Baris data
        const isStatus = colIdx === 17; // kolom STATUS
        const isReject = colIdx === 14; // kolom TOTAL REJECT
        const isNoPermas = meta.rowType === 'no_permas';

        // Background
        let bgArgb;
        if (isNoPermas) {
          bgArgb = C.noPermas_bg;
        } else if (isEvenRow) {
          bgArgb = C.rowEven;
        } else {
          bgArgb = C.rowOdd;
        }

        // Font dasar
        let fontArgb = isNoPermas ? C.noPermas_font : C.dataFont;
        let bold = false;

        // Override untuk kolom khusus
        if (isStatus) {
          const isOpen = meta.status === 'OPEN';
          cell.s = {
            fill:      fill(isOpen ? C.statusOpen_bg : C.statusClose_bg),
            font:      font(isOpen ? C.statusOpen_font : C.statusClose_font, true, 9),
            border:    border(),
            alignment: align('center', 'middle', false),
          };
          continue; // skip default styling di bawah
        }

        if (isReject && meta.hasReject) {
          bgArgb   = C.reject_bg;
          fontArgb = C.reject_font;
          bold     = true;
        }

        cell.s = {
          fill:      fill(bgArgb),
          font:      font(fontArgb, bold, 9),
          border:    border(),
          alignment: align(isCenter ? 'center' : 'left'),
        };
      }
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, 'Laporan');
  return lastRow - 1; // jumlah baris data (tanpa header)
}

// ─── Bangun sheet Ringkasan ───────────────────────────────────────────────────
function buildRingkasanSheet(wb, stats, filterOpts) {
  const { total, filtered, byBagian } = stats;

  const filterDesc = [
    filterOpts.bagian     ? `Bagian: ${filterOpts.bagian}`             : null,
    filterOpts.shift      ? `Shift: ${filterOpts.shift}`               : null,
    filterOpts.dateFrom   ? `Tanggal: ${filterOpts.dateFrom} s/d ${filterOpts.dateTo || filterOpts.dateFrom}` : null,
    filterOpts.namaProduk ? `Produk: ${filterOpts.namaProduk}`         : null,
  ].filter(Boolean).join('  |  ') || 'Semua Data';

  const ws = {};
  let row = 1;

  const setCell = (r, c, val, style) => {
    const addr = XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });
    ws[addr] = { t: typeof val === 'number' ? 'n' : 's', v: val ?? '', s: style };
  };

  const setNum = (r, c, val, style) => {
    const addr = XLSX.utils.encode_cell({ r: r - 1, c: c - 1 });
    const num  = typeof val === 'number' ? val : parseFloat(val) || 0;
    ws[addr] = { t: 'n', v: num, s: style };
  };

  // ── Judul ──────────────────────────────────────────────────────────────────
  ws[XLSX.utils.encode_cell({ r: 0, c: 0 })] = {
    t: 's', v: 'RINGKASAN LAPORAN PERMASALAHAN PRODUKSI',
    s: { fill: fill(C.summTitle_bg), font: font(C.summTitle_font, true, 13), alignment: align('center', 'middle') },
  };
  // Merge A1:J1
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }];

  row = 2;
  ws[XLSX.utils.encode_cell({ r: row - 1, c: 0 })] = {
    t: 's', v: `Filter: ${filterDesc}`,
    s: { fill: fill('FFE3F2FD'), font: font('FF1565C0', false, 9), alignment: align('left', 'middle') },
  };
  ws['!merges'].push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: 9 } });

  row = 3; // baris kosong

  // ── BLOK 1: Ringkasan Semua Data (Total Database) ─────────────────────────
  row = 4;
  const lblStyle = {
    fill: fill(C.summHead_bg), font: font(C.summHead_font, true, 10),
    border: border(), alignment: align('center', 'middle'),
  };

  // Judul blok
  ws[XLSX.utils.encode_cell({ r: row - 1, c: 0 })] = {
    t: 's', v: 'STATISTIK KESELURUHAN DATABASE',
    s: { ...lblStyle, fill: fill('FF0D47A1'), font: font('FFFFFFFF', true, 10), alignment: align('left', 'middle') },
  };
  ws['!merges'].push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: 9 } });
  row++;

  // Header baris statistik total
  const totalHeaders = ['', 'Total Form', 'Total Shift', 'Shift Lengkap*', 'Shift Sebagian**', 'Shift Tdk Ada\nMasalah', 'Total Masalah', 'Reject (KG)', 'Status OPEN', 'Status CLOSE'];
  totalHeaders.forEach((h, i) => {
    ws[XLSX.utils.encode_cell({ r: row - 1, c: i })] = { t: 's', v: h, s: { ...lblStyle, alignment: align('center', 'middle', true) } };
  });
  row++;

  // Data total keseluruhan
  const totalRowStyle = {
    fill: fill('FF37474F'), font: font('FFFFFFFF', true, 9),
    border: border(), alignment: align('center', 'middle'),
  };
  const totalData = [
    'SEMUA BAGIAN',
    total.forms,
    total.shifts,
    total.shiftFull,
    total.shiftPartial,
    total.shiftNoPermas,
    total.permasalahan,
    Math.round(total.rejectKg * 100) / 100,
    total.open,
    total.close,
  ];
  totalData.forEach((v, i) => {
    const style = { ...totalRowStyle, alignment: align(i === 0 ? 'left' : 'center', 'middle') };
    if (i === 0) ws[XLSX.utils.encode_cell({ r: row - 1, c: i })] = { t: 's', v, s: style };
    else ws[XLSX.utils.encode_cell({ r: row - 1, c: i })] = { t: 'n', v: Number(v) || 0, s: style };
  });
  row++;

  row++; // spasi

  // ── BLOK 2: Ringkasan Data Ter-filter (per bagian) ────────────────────────
  ws[XLSX.utils.encode_cell({ r: row - 1, c: 0 })] = {
    t: 's', v: `DETAIL PER BAGIAN PRODUKSI  ─  ${filterDesc}`,
    s: { ...lblStyle, fill: fill('FF0D47A1'), font: font('FFFFFFFF', true, 10), alignment: align('left', 'middle') },
  };
  ws['!merges'].push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: 9 } });
  row++;

  // Header tabel per bagian
  const colHeaders = [
    'BAGIAN\nPRODUKSI',
    'JUMLAH\nFORM',
    'TOTAL\nSHIFT',
    'Shift Lengkap\n(Output+Karu+Permas.)',
    'Shift Sebagian\n(Ada permas., data tdk lengkap)',
    'Shift Tdk Ada\nPermasalahan',
    'TOTAL\nPERMASALAHAN',
    'TOTAL REJECT\n(KG)',
    'STATUS\nOPEN',
    'STATUS\nCLOSE',
  ];
  colHeaders.forEach((h, i) => {
    ws[XLSX.utils.encode_cell({ r: row - 1, c: i })] = { t: 's', v: h, s: { ...lblStyle, alignment: align('center', 'middle', true) } };
  });
  ws['!rows'] = ws['!rows'] || {};
  row++;

  const bagianList = Object.keys(byBagian).sort();
  bagianList.forEach((bag, idx) => {
    const b      = byBagian[bag];
    const isEven = idx % 2 === 0;
    const rowBg  = isEven ? 'FFF0F6FF' : 'FFFFFFFF';

    const baseStyle = {
      fill: fill(rowBg), font: font(C.dataFont, false, 9),
      border: border(), alignment: align('center', 'middle'),
    };
    const dataRow = [
      bag,
      b.forms,
      b.shifts,
      b.shiftFull,
      b.shiftPartial,
      b.shiftNoPermas,
      b.permasalahan,
      Math.round(b.rejectKg * 100) / 100,
      b.open,
      b.close,
    ];
    dataRow.forEach((v, i) => {
      const style = { ...baseStyle, alignment: align(i === 0 ? 'left' : 'center', 'middle') };
      // Warnai open merah, close hijau
      if (i === 8 && Number(v) > 0) style.font = font(C.warn_font, true, 9);
      if (i === 9) style.font = font(C.good_font, false, 9);
      // Reject oranye jika > 0
      if (i === 7 && Number(v) > 0) style.font = font('FFE65100', true, 9);

      if (i === 0) ws[XLSX.utils.encode_cell({ r: row - 1, c: i })] = { t: 's', v, s: style };
      else ws[XLSX.utils.encode_cell({ r: row - 1, c: i })] = { t: 'n', v: Number(v) || 0, s: style };
    });
    row++;
  });

  // Baris total (dari filtered)
  const totalFStyle = {
    fill: fill('FF37474F'), font: font('FFFFFFFF', true, 9),
    border: border('medium', C.borderMedium), alignment: align('center', 'middle'),
  };
  const filteredTotalRow = [
    'TOTAL',
    filtered.forms,
    filtered.shifts,
    filtered.shiftFull,
    filtered.shiftPartial,
    filtered.shiftNoPermas,
    filtered.permasalahan,
    Math.round(filtered.rejectKg * 100) / 100,
    filtered.open,
    filtered.close,
  ];
  filteredTotalRow.forEach((v, i) => {
    const style = { ...totalFStyle, alignment: align(i === 0 ? 'left' : 'center', 'middle') };
    if (i === 0) ws[XLSX.utils.encode_cell({ r: row - 1, c: i })] = { t: 's', v, s: style };
    else ws[XLSX.utils.encode_cell({ r: row - 1, c: i })] = { t: 'n', v: Number(v) || 0, s: style };
  });
  row++;

  row++; // spasi

  // ── BLOK 3: Keterangan ────────────────────────────────────────────────────
  const noteStyle = {
    fill: fill('FFFFFDE7'), font: font('FF5D4037', false, 9),
    border: border(), alignment: align('left', 'middle', true),
  };
  const notes = [
    '* Shift Lengkap: shift yang memiliki output, nama karu, DAN ada permasalahan yang diisi',
    '** Shift Sebagian: shift yang ada permasalahan tetapi data output atau karu tidak lengkap',
    '   Shift Tidak Ada Permasalahan: shift yang terisi output/karu tetapi tidak ada catatan permasalahan',
    '   Reject dalam satuan KG — dijumlahkan dari seluruh baris permasalahan yang memiliki nilai Total Reject',
  ];
  notes.forEach((note, i) => {
    ws[XLSX.utils.encode_cell({ r: row - 1, c: 0 })] = { t: 's', v: note, s: noteStyle };
    ws['!merges'].push({ s: { r: row - 1, c: 0 }, e: { r: row - 1, c: 9 } });
    row++;
  });

  // Lebar kolom ringkasan
  ws['!cols'] = [
    { wch: 20 },  // BAGIAN
    { wch: 10 },  // FORM
    { wch: 10 },  // SHIFT
    { wch: 18 },  // LENGKAP
    { wch: 20 },  // SEBAGIAN
    { wch: 16 },  // TDK ADA PERMAS
    { wch: 14 },  // TOTAL MASALAH
    { wch: 16 },  // REJECT KG
    { wch: 12 },  // OPEN
    { wch: 12 },  // CLOSE
  ];

  // Set range sheet
  const maxRow = row - 1;
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: 9 } });

  XLSX.utils.book_append_sheet(wb, ws, 'Ringkasan');
}

// ─── Build Excel utama ────────────────────────────────────────────────────────
export async function buildExcel(allDocs, filteredDocs, filterOpts, onProgress) {
  const wb = XLSX.utils.book_new();

  // Sort filtered docs
  const sorted = [...filteredDocs].sort((a, b) => {
    const parseD = (str) => {
      if (!str) return 0;
      const [d, m, y] = str.split('/').map(Number);
      return new Date(y, m - 1, d).getTime();
    };
    const diff = parseD(b.tanggal) - parseD(a.tanggal);
    if (diff !== 0) return diff;
    return (a.noMesin || '').localeCompare(b.noMesin || '');
  });

  onProgress?.(5);

  // Sheet 1: Laporan
  const rowCount = buildLaporanSheet(wb, sorted, filterOpts, onProgress);
  onProgress?.(75);

  // Analisis statistik
  const stats = analyzeAllDocs(allDocs, filteredDocs, filterOpts);
  onProgress?.(82);

  // Sheet 2: Ringkasan
  buildRingkasanSheet(wb, stats, filterOpts);
  onProgress?.(90);

  // Generate file
  const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx', cellStyles: true });
  onProgress?.(95);

  // Nama file
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const bagianSuffix = filterOpts.bagian     ? `_${filterOpts.bagian}`   : '';
  const shiftSuffix  = filterOpts.shift      ? `_S${filterOpts.shift}`   : '';
  const dateSuffix   = filterOpts.dateFrom
    ? `_${filterOpts.dateFrom.replace(/\//g, '')}-${(filterOpts.dateTo || filterOpts.dateFrom).replace(/\//g, '')}`
    : '';

  const fileName = `Laporan_Permasalahan_${stamp}${bagianSuffix}${shiftSuffix}${dateSuffix}.xlsx`;
  const filePath = `${FileSystem.cacheDirectory}${fileName}`;

  await FileSystem.writeAsStringAsync(filePath, b64, { encoding: 'base64' });
  onProgress?.(100);

  return { filePath, fileName, rowCount, stats };
}