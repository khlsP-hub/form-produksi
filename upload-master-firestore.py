#!/usr/bin/env python3
"""
upload-master-firestore.py
--------------------------
Upload data master produk & mesin dari SEMUA Excel ke Firestore.
Mendukung: PET (Database PF & SB), INJECT, BLOW, dan bagian lain.

Requirements:
  pip install firebase-admin pandas openpyxl

CARA PAKAI:
  # Upload semua sekaligus (rekomendasikan):
  py upload-master-firestore.py serviceAccountKey.json

  # Upload satu file tertentu:
  py upload-master-firestore.py serviceAccountKey.json --file "Database Injection.xlsx" --bagian INJECT

OPSI TAMBAHAN:
  --clear   Hapus dulu semua data lama sebelum upload ulang (bersih total)
  --dry-run Simulasi saja, tidak benar-benar upload ke Firestore
"""

import sys
import os
import argparse
import pandas as pd
import firebase_admin
from firebase_admin import credentials, firestore

# ═══════════════════════════════════════════════════════════════════
#  KONFIGURASI — Sesuaikan bagian ini dengan file Excel Anda
# ═══════════════════════════════════════════════════════════════════

DATABASES = [
    # ── PET ──────────────────────────────────────────────────────
    {
        'bagian':      'PET',
        'file':        'Database Produk dan Mesin PET.xlsx',

        # Daftar sheet yang akan dibaca untuk PRODUK
        # Format: { 'sheet': nama_sheet, 'col_kode': nama_kolom, 'col_nama': nama_kolom }
        'produk_sheets': [
            { 'sheet': 'Database PF', 'col_kode': 'KODE BARANG', 'col_nama': 'PRODUK' },
            { 'sheet': 'Database SB', 'col_kode': 'KODE BARANG', 'col_nama': 'PRODUK' },
        ],

        # Sheet dan kolom untuk MESIN
        'mesin_sheets': [
            { 'sheet': 'Database PF', 'col_mesin': 'NO MESIN' },
            { 'sheet': 'Database SB', 'col_mesin': 'NO MESIN' },
        ],
    },

    # ── INJECT ───────────────────────────────────────────────────
    # Catatan: Di file Injection, row 1 Excel berisi judul/kosong,
    # header kolom sebenarnya ada di row 2 → pakai header=1 (0-based)
    {
        'bagian':      'INJECT',
        'file':        'Database Injection.xlsx',

        'produk_sheets': [
            { 'sheet': 'DATABASE', 'col_kode': 'KODE BARANG', 'col_nama': 'NAMA PRODUK' },
        ],

        'mesin_sheets': [
            { 'sheet': 'DATABASE', 'col_mesin': 'Nomor Mesin' },
        ],
    },

    # ── BLOW — Tambahkan jika sudah punya file Excel-nya ─────────
     {
         'bagian':      'BLOW',
         'file':        'Data Blow.xlsx',
    
         'produk_sheets': [
             { 'sheet': 'Database', 'col_kode': 'KODE BARANG', 'col_nama': 'NAMA PRODUK' },
         ],
    
         'mesin_sheets': [
             { 'sheet': 'Database', 'col_mesin': 'Nomor Mesin' },
         ],
     },
]

# ═══════════════════════════════════════════════════════════════════


def normalize_columns(df):
    """Normalisasi nama kolom: hapus newline, spasi berlebih."""
    df.columns = [str(c).replace('\n', ' ').strip() for c in df.columns]
    return df


def resolve_sheet(file_path, sheet_name):
    import openpyxl
    wb = openpyxl.load_workbook(file_path, read_only=True)
    sheets = wb.sheetnames
    wb.close()
    if sheet_name in sheets:
        return sheet_name, sheets
    for s in sheets:
        if s.strip().lower() == sheet_name.strip().lower():
            print(f"  ℹ️  Sheet '{sheet_name}' → pakai '{s}' (nama mirip)")
            return s, sheets
    return None, sheets


def auto_detect_header(file_path, sheet_name, target_cols, max_scan=5):
    import openpyxl
    wb = openpyxl.load_workbook(file_path, read_only=True)
    ws = wb[sheet_name]
    for row_idx, row in enumerate(ws.iter_rows(max_row=max_scan, values_only=True)):
        cells = [str(c).replace('\n', ' ').strip() if c is not None else '' for c in row]
        if all(col in cells for col in target_cols):
            wb.close()
            return row_idx
    wb.close()
    return 0


def read_produk(file_path, sheet_cfg, bagian):
    """Baca satu sheet produk, support multi-table dalam 1 sheet."""
    sheet_raw = sheet_cfg['sheet']

    sheet, all_sheets = resolve_sheet(file_path, sheet_raw)
    if sheet is None:
        print(f"  ⚠️  Sheet '{sheet_raw}' tidak ditemukan. Sheet tersedia: {all_sheets}")
        return []

    header_r = sheet_cfg.get('header', None)
    if header_r is None:
        header_r = auto_detect_header(file_path, sheet, ['KODE BARANG', 'NAMA PRODUK'])
        if header_r > 0:
            print(f"  ℹ️  Header ditemukan di baris Excel {header_r + 1}")

    try:
        df = pd.read_excel(file_path, sheet_name=sheet, header=header_r)
        df = normalize_columns(df)
        df = df.loc[:, ~df.columns.duplicated()]
    except Exception as e:
        print(f"  ⚠️  Gagal baca sheet '{sheet}': {e}")
        return []

    results = []

    cols = list(df.columns)

    # 🔥 LOOP SEMUA KOLOM UNTUK DETECT SEMUA TABEL
    for i in range(len(cols)):
        col_kode = cols[i]

        if "KODE" in col_kode.upper():

            if i + 1 < len(cols):
                col_nama = cols[i + 1]

                if "PRODUK" in col_nama.upper():

                    temp = df[[col_kode, col_nama]].copy()
                    temp.columns = ['kode', 'nama']

                    temp = temp.dropna()
                    temp['kode'] = temp['kode'].astype(str).str.strip()
                    temp['nama'] = temp['nama'].astype(str).str.strip()

                    temp = temp[
                        (temp['kode'] != '') &
                        (temp['nama'] != '') &
                        (temp['kode'].str.lower() != 'nan') &
                        (temp['nama'].str.lower() != 'nan')
                    ]

                    temp['bagian'] = bagian

                    results.extend(temp.to_dict('records'))

    # 🔥 HAPUS DUPLIKAT GLOBAL
    unique = {}
    for r in results:
        key = (r['kode'], r['nama'])
        unique[key] = r

    results = list(unique.values())

    print(f"  ✔  Multi-table detect: {len(results)} produk")
    return results


def read_mesin(file_path, sheet_cfg, bagian):
    """Baca satu sheet mesin, return sorted list of strings."""
    sheet_raw = sheet_cfg['sheet']
    col_m     = sheet_cfg['col_mesin']

    sheet, all_sheets = resolve_sheet(file_path, sheet_raw)
    if sheet is None:
        print(f"  ⚠️  Sheet '{sheet_raw}' tidak ditemukan untuk mesin. Sheet tersedia: {all_sheets}")
        return []

    header_r = sheet_cfg.get('header', None)
    if header_r is None:
        header_r = auto_detect_header(file_path, sheet, [col_m])
        if header_r > 0:
            print(f"  ℹ️  Header mesin ditemukan di baris Excel {header_r + 1}")

    try:
        df = pd.read_excel(file_path, sheet_name=sheet, header=header_r)
        df = normalize_columns(df)
    except Exception as e:
        print(f"  ⚠️  Gagal baca sheet '{sheet}' untuk mesin: {e}")
        return []

    if col_m not in df.columns:
        print(f"  ⚠️  Kolom mesin '{col_m}' tidak ada di sheet '{sheet}'")
        print(f"       Kolom tersedia: {list(df.columns)}")
        return []

    mesins = (df[col_m].dropna().astype(str).str.strip().unique().tolist())
    mesins = [m for m in mesins if m and m.lower() not in ('nan', col_m.lower())]
    return sorted(mesins)


def upload_produk(db, all_produk, dry_run=False):
    """Upload semua produk ke koleksi master_produk."""
    print(f"\n📦 Mengupload {len(all_produk)} produk ke 'master_produk'...")

    kode_count = {}
    batch      = db.batch() if not dry_run else None
    count      = 0
    BATCH_SIZE = 400

    for row in all_produk:
        kode   = row['kode']
        nama   = row['nama']
        bagian = row['bagian']

        kode_count[kode] = kode_count.get(kode, 0) + 1
        doc_id = kode if kode_count[kode] == 1 else f"{kode}_{kode_count[kode]}"

        if dry_run:
            if count < 5:
                print(f"  [DRY-RUN] → {doc_id}: {nama[:50]} ({bagian})")
        else:
            ref = db.collection('master_produk').document(doc_id)
            batch.set(ref, {
                'kode':   kode,
                'nama':   nama,
                'bagian': bagian,
                'docId':  doc_id,
            })

        count += 1

        if not dry_run and count % BATCH_SIZE == 0:
            batch.commit()
            batch = db.batch()
            print(f"  → {count} produk terupload...")

    if not dry_run:
        batch.commit()

    # Laporan duplikat
    dupes = {k: v for k, v in kode_count.items() if v > 1}
    if dupes:
        print(f"\n  ⚠️  {len(dupes)} kode barang duplikat (ditangani dengan suffix _2, _3, dst):")
        for k, v in list(dupes.items())[:10]:
            print(f"     → {k} muncul {v}x")
        if len(dupes) > 10:
            print(f"     ... dan {len(dupes) - 10} lainnya")

    print(f"  ✅ {count} produk {'akan di' if dry_run else ''}upload ke 'master_produk'")
    return count


def upload_mesin(db, all_mesin_by_bagian, dry_run=False):
    """Upload semua mesin ke koleksi master_mesin."""
    total = sum(len(v) for v in all_mesin_by_bagian.values())
    print(f"\n⚙️  Mengupload {total} mesin ke 'master_mesin'...")

    if not dry_run:
        batch = db.batch()

    for bagian, mesins in all_mesin_by_bagian.items():
        print(f"  [{bagian}] {len(mesins)} mesin: {', '.join(mesins[:8])}{'...' if len(mesins) > 8 else ''}")
        for m in mesins:
            doc_id = m.replace(' ', '_').replace('-', '').replace('_', '')
            doc_id = f"{bagian}_{doc_id}"   # prefix bagian agar tidak tabrakan antar bagian
            if dry_run:
                pass
            else:
                ref = db.collection('master_mesin').document(doc_id)
                batch.set(ref, {
                    'noMesin': m,
                    'bagian':  bagian,
                })

    if not dry_run:
        batch.commit()

    print(f"  ✅ {total} mesin {'akan di' if dry_run else ''}upload ke 'master_mesin'")
    return total


def clear_collection(db, col_name):
    """Hapus semua dokumen di sebuah koleksi (batch delete)."""
    print(f"  🗑️  Menghapus koleksi '{col_name}'...")
    col_ref = db.collection(col_name)
    deleted = 0
    while True:
        docs = col_ref.limit(400).stream()
        batch = db.batch()
        n = 0
        for doc in docs:
            batch.delete(doc.reference)
            n += 1
        if n == 0:
            break
        batch.commit()
        deleted += n
        print(f"     → {deleted} dokumen dihapus...")
    print(f"  ✅ Koleksi '{col_name}' bersih ({deleted} dokumen dihapus)")


# ─── Main ─────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='Upload master data ke Firestore')
    parser.add_argument('sa_key',  help='Path ke serviceAccountKey.json')
    parser.add_argument('--file',   help='Upload satu file tertentu saja')
    parser.add_argument('--bagian', help='Bagian untuk --file (misal: INJECT)')
    parser.add_argument('--clear',  action='store_true', help='Hapus data lama sebelum upload')
    parser.add_argument('--dry-run',action='store_true', help='Simulasi, tidak upload')
    args = parser.parse_args()

    # Validasi SA key
    if not os.path.exists(args.sa_key):
        print(f"❌ File serviceAccountKey.json tidak ditemukan: '{args.sa_key}'")
        sys.exit(1)

    # Tentukan daftar database yang akan diproses
    if args.file:
        if not args.bagian:
            print("❌ Jika pakai --file, harus juga pakai --bagian (misal: --bagian INJECT)")
            sys.exit(1)
        # Mode single file: cari config yang cocok, atau buat ad-hoc
        db_list = [d for d in DATABASES if d['bagian'] == args.bagian]
        if not db_list:
            print(f"⚠️  Bagian '{args.bagian}' tidak ada di DATABASES config.")
            print(f"   Tambahkan dulu di bagian KONFIGURASI script ini.")
            sys.exit(1)
        db_list = [dict(db_list[0], file=args.file)]
    else:
        db_list = DATABASES

    print("=" * 60)
    print("🚀 UPLOAD MASTER DATA KE FIRESTORE")
    if args.dry_run:
        print("   [MODE DRY-RUN — tidak ada yang diupload]")
    print("=" * 60)

    # Init Firebase
    if not args.dry_run:
        cred = credentials.Certificate(args.sa_key)
        firebase_admin.initialize_app(cred)
        db_fs = firestore.client()
        print("✅ Firebase terhubung\n")
    else:
        db_fs = None
        print("✅ Mode dry-run aktif\n")

    # Clear jika diminta
    if args.clear and not args.dry_run:
        print("🗑️  Menghapus data lama...")
        clear_collection(db_fs, 'master_produk')
        clear_collection(db_fs, 'master_mesin')
        print()

    # Kumpulkan semua data
    all_produk = []
    all_mesin_by_bagian = {}

    for cfg in db_list:
        bagian    = cfg['bagian']
        file_path = cfg['file']

        print(f"📂 [{bagian}] Membaca: {file_path}")

        if not os.path.exists(file_path):
            print(f"  ⚠️  File tidak ditemukan, dilewati: '{file_path}'")
            print(f"       Pastikan file ada di folder yang sama dengan script ini.\n")
            continue

        # Produk
        produk_rows = []
        for sheet_cfg in cfg.get('produk_sheets', []):
            rows = read_produk(file_path, sheet_cfg, bagian)
            produk_rows.extend(rows)
            print(f"  ✔  Sheet '{sheet_cfg['sheet']}': {len(rows)} produk")

        # Deduplicate dalam satu bagian (kode + nama sama persis → skip)
        seen = set()
        unique_produk = []
        for r in produk_rows:
            key = (r['kode'], r['nama'])
            if key not in seen:
                seen.add(key)
                unique_produk.append(r)
        all_produk.extend(unique_produk)
        print(f"  📦 Total produk [{bagian}]: {len(unique_produk)} (unik)")

        # Mesin
        mesins = []
        seen_mesin = set()
        for sheet_cfg in cfg.get('mesin_sheets', []):
            for m in read_mesin(file_path, sheet_cfg, bagian):
                if m not in seen_mesin:
                    seen_mesin.add(m)
                    mesins.append(m)

        all_mesin_by_bagian[bagian] = sorted(mesins)
        print(f"  ⚙️  Total mesin  [{bagian}]: {len(mesins)}")
        print()

    # Upload
    total_produk = upload_produk(db_fs, all_produk, dry_run=args.dry_run)
    total_mesin  = upload_mesin(db_fs, all_mesin_by_bagian, dry_run=args.dry_run)

    # Ringkasan
    print(f"""
{'=' * 60}
✅ SELESAI! {'[DRY-RUN] ' if args.dry_run else ''}Data tersimpan di Firestore:
   • master_produk : {total_produk} dokumen
   • master_mesin  : {total_mesin} dokumen

   Breakdown per bagian:""")
    bagian_counts = {}
    for r in all_produk:
        bagian_counts[r['bagian']] = bagian_counts.get(r['bagian'], 0) + 1
    for b, c in bagian_counts.items():
        mesin_c = len(all_mesin_by_bagian.get(b, []))
        print(f"   {'─':>3} {b:<8}: {c} produk, {mesin_c} mesin")

    print(f"""
Aplikasi React Native akan otomatis fetch data terbaru.
{'=' * 60}""")


if __name__ == '__main__':
    main()