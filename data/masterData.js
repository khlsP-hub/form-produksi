// data/masterData.js
// Produk & mesin diambil dari Firestore via useMasterData.js
// File ini hanya berisi konstanta UI & helper functions

// ─── Pilihan Bagian Produksi ──────────────────────────────────────
export const BAGIAN_PRODUKSI = [
  { label: 'Pilih Bagian Produksi', value: '' },
  { label: 'PET PF',        value: 'PET PF'        },
  { label: 'PET SB',        value: 'PET SB'        },
  { label: 'INJECT',        value: 'INJECT'        },
  { label: 'BLOW',          value: 'BLOW'          },
  { label: 'DECORATING',    value: 'DECORATING'    },
  { label: 'SECOND PROSES', value: 'SECOND_PROSES' },
];

// ─── Fallback saat bagian belum dipilih ──────────────────────────
export const NAMA_PRODUK_DEFAULT = [
  { label: '— Pilih bagian produksi dulu —', value: '', kode: '' },
];

export const NOMOR_MESIN_DEFAULT = [
  { label: '— Pilih bagian produksi dulu —', value: '' },
];

// ─── Status permasalahan ─────────────────────────────────────────
export const STATUS_OPTIONS = [
  { label: 'Pilih Status', value: '' },
  { label: 'Open',         value: 'open'  },
  { label: 'Close',        value: 'close' },
];

// ─── Factory functions untuk form kosong ─────────────────────────
export const createEmptyShiftRow = () => ({
  downtime:       '',
  permasalahan:   '',
  totalReject:    '',
  totalRejectRaw: '',
  penanganan:     '',
  namaAsisten:    '',
  status:         '',
  rejectMode: 'kg',
  estimasiRejectPcs: 0,
  estimasiRejectKg: 0,
});

export const createEmptyShift = () => ({
  output:    '',
  outputRaw: '',
  cavity:    '',
  cycleTime: '',
  karu:      '',
  rows: [createEmptyShiftRow()],
});

// ─── Format angka dengan titik ribuan dan koma desimal ───────────
export const formatAngka = (text) => {
  const cleaned = text.replace(/[^0-9,]/g, '');
  const parts   = cleaned.split(',');
  parts[0]      = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return parts.slice(0, 2).join(parts.length > 1 ? ',' : '');
};

export const unformatAngka = (text) => {
  return text.replace(/\./g, '').replace(',', '.');
};