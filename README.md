# 📱 Form Permasalahan Produksi PET
## Panduan Setup Lengkap

---

## 🗂 Struktur Project

```
form-produksi/
├── App.js                    # Entry point + navigasi
├── app.json                  # Konfigurasi Expo
├── package.json              # Dependencies
├── babel.config.js           # Babel config
├── firebase/
│   └── config.js             # ⚠️ Isi dengan Firebase config kamu
├── data/
│   └── masterData.js         # Edit dropdown data produk & mesin di sini
├── components/
│   ├── AppInput.js           # Reusable text input
│   ├── AppDropdown.js        # Reusable dropdown/picker
│   └── ShiftSection.js       # Komponen tabel shift
└── screens/
    ├── FormScreen.js         # Halaman input form
    └── HistoryScreen.js      # Halaman riwayat form
```

---

## 🚀 Langkah 1: Install Tools

```bash
# Install Node.js dari https://nodejs.org (versi LTS)
# Install Expo CLI
npm install -g expo-cli

# Install project dependencies
cd form-produksi
npm install
```

---

## 🔥 Langkah 2: Setup Firebase (GRATIS)

1. Buka https://console.firebase.google.com
2. Klik **"Add Project"** → beri nama (mis: `form-produksi-pet`)
3. Setelah project dibuat, klik ikon **"</>"** (Web app)
4. Register app → copy konfigurasi yang muncul
5. Buka file `firebase/config.js` dan **isi nilainya**:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",           // ← ganti ini
  authDomain: "xxx.firebaseapp.com",
  projectId: "xxx",
  storageBucket: "xxx.appspot.com",
  messagingSenderId: "123456",
  appId: "1:123:web:abc"
};
```

6. Di Firebase Console → **Firestore Database** → **Create database**
7. Pilih **"Start in test mode"** (untuk development)
8. Pilih region terdekat (mis: `asia-southeast1`)

---

## 📦 Langkah 3: Edit Data Master (Produk & Mesin)

Buka `data/masterData.js` dan sesuaikan:

```javascript
// Ganti dengan nama produk asli perusahaan
export const NAMA_PRODUK = [
  { label: 'Botol PET 600ml - PET-001', value: 'PET-001', kode: 'PET-001' },
  // tambah produk lainnya...
];

// Ganti dengan nomor mesin yang ada
export const NOMOR_MESIN = [
  { label: 'Mesin 01', value: 'M-01' },
  // tambah mesin lainnya...
];
```

---

## ▶️ Langkah 4: Jalankan Aplikasi

```bash
# Start development server
npx expo start

# Scan QR code dengan:
# - Expo Go app (Android/iOS) untuk testing cepat
# - ATAU tekan 'a' untuk Android emulator
# - ATAU tekan 'i' untuk iOS simulator (Mac only)
```

---

## 📲 Langkah 5: Build APK untuk Android

```bash
# Install EAS CLI
npm install -g eas-cli

# Login ke Expo account (buat di expo.dev jika belum)
eas login

# Konfigurasi build
eas build:configure

# Build APK (gratis, ~15-20 menit)
eas build -p android --profile preview
```

Setelah selesai, kamu dapat link download APK-nya.

---

## 🗃 Struktur Data di Firestore

Setiap form tersimpan di collection `form_produksi` dengan struktur:
```json
{
  "tanggal": "06/04/2026",
  "bagianProduksi": "produksi_1",
  "namaProduk": "PET-001",
  "kodeProduk": "PET-001",
  "noMesin": "M-01",
  "berat": "25",
  "shift1": {
    "output": "1000",
    "cavity": "24",
    "cycleTime": "12",
    "karu": "Budi",
    "rows": [
      {
        "downtime": "30",
        "permasalahan": "Mesin overheat",
        "totalReject": "5.5",
        "penanganan": "Cooling system dibersihkan",
        "namaAsisten": "Andi",
        "status": "close"
      }
    ]
  },
  "shift2": { ... },
  "shift3": { ... },
  "createdAt": "timestamp"
}
```

---

## ❓ FAQ

**Q: Apakah butuh server yang selalu hidup?**
A: **TIDAK!** Firebase Firestore adalah managed cloud database. Google yang mengelola servernya. Kamu cukup daftar dan pakai.

**Q: Berapa biaya Firebase?**
A: Gratis untuk penggunaan ringan (Spark Plan):
- 50.000 reads/hari
- 20.000 writes/hari  
- 1 GB storage
Lebih dari cukup untuk penggunaan pabrik.

**Q: Bagaimana jika internet mati?**
A: Firebase Firestore punya **offline persistence** - data tetap bisa ditulis secara lokal, dan otomatis sync ketika internet tersambung kembali.

**Q: Bisa export ke Excel?**
A: Bisa ditambahkan fitur export di versi berikutnya menggunakan library `xlsx` atau `react-native-csv`.
