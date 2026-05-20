// hooks/useMasterData.js
import { useState, useEffect, useRef } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';

// ─── Cache global ─────────────────────────────────────────
const _cache = {};

async function fetchCollection(colName, field, value) {
  const cacheKey = `${colName}__${field}__${value}`;
  if (_cache[cacheKey]) return _cache[cacheKey];
  
  const q = query(collection(db, colName), where(field, '==', value));
  const snap = await getDocs(q);
  const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  _cache[cacheKey] = data;
  return data;
}

// ─── Hook utama ───────────────────────────────────────────
export function useMasterData(bagian) {
  const [produkList,  setProdukList]  = useState([]);
  const [mesinList,   setMesinList]   = useState([]);
  const [karuList,    setKaruList]    = useState([]);
  const [asistenList, setAsistenList] = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);

  const prevBagian = useRef(null);

  useEffect(() => {
  if (!bagian) {
    setProdukList([]);
    setMesinList([]);
    setKaruList([]);
    setAsistenList([]);
    prevBagian.current = null;
    return;
  }

  if (bagian === prevBagian.current) return;
  prevBagian.current = bagian;

  let cancelled = false;
  setLoading(true);
  setError(null);

  // ── Kalau bagian "PET" (data lama), gabung PET PF + PET SB ──
  const bagianList = bagian === 'PET' ? ['PET PF', 'PET SB'] : [bagian];

  Promise.all(
    bagianList.flatMap(b => [
      fetchCollection('master_produk',   'bagian', b),
      fetchCollection('master_mesin',    'bagian', b),
      fetchCollection('master_karyawan', 'bagian', b),
    ])
  )
  .then((results) => {
    if (cancelled) return;

    // Gabung semua hasil per koleksi
    // Urutan: [produk_b1, mesin_b1, karyawan_b1, produk_b2, mesin_b2, karyawan_b2, ...]
    const produkData   = [];
    const mesinData    = [];
    const karyawanData = [];

    results.forEach((data, idx) => {
      const mod = idx % 3;
      if (mod === 0) produkData.push(...data);
      if (mod === 1) mesinData.push(...data);
      if (mod === 2) karyawanData.push(...data);
    });

    // ─── Produk (deduplikasi kode+nama) ───
    const seenProduk = new Set();
    const produk = produkData
      .filter(p => {
        const key = `${p.kode}__${p.nama}`;
        if (seenProduk.has(key)) return false;
        seenProduk.add(key);
        return true;
      })
      .map(p => ({
        value: p.docId || p.id,
        label: p.nama,
        kode:  p.kode,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'id'));

    // ─── Mesin (deduplikasi) ───
    const seenMesin = new Set();
    const mesin = mesinData
      .filter(m => {
        if (seenMesin.has(m.noMesin)) return false;
        seenMesin.add(m.noMesin);
        return true;
      })
      .map(m => ({
        value: m.noMesin,
        label: m.noMesin,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'id'));

    // ─── Karu (deduplikasi) ───
    const seenKaru = new Set();
    const karu = karyawanData
      .filter(k => k.role === 'karu' && !seenKaru.has(k.nama) && seenKaru.add(k.nama))
      .map(k => ({ value: k.nama, label: k.nama }))
      .sort((a, b) => a.label.localeCompare(b.label, 'id'));

    // ─── Asisten (deduplikasi) ───
    const seenAsisten = new Set();
    const asisten = karyawanData
      .filter(k => k.role === 'asisten' && !seenAsisten.has(k.nama) && seenAsisten.add(k.nama))
      .map(k => ({ value: k.nama, label: k.nama }))
      .sort((a, b) => a.label.localeCompare(b.label, 'id'));

    setProdukList(produk);
    setMesinList(mesin);
    setKaruList(karu);
    setAsistenList(asisten);
    setLoading(false);
  })
  .catch(e => {
    if (cancelled) return;
    console.error('useMasterData error:', e);
    setError(e.message);
    setLoading(false);
  });

  return () => { cancelled = true; };
}, [bagian]);

  return {
    produkList,
    mesinList,
    karuList,
    asistenList,
    loading,
    error
  };
}

// ─── Optional: reset cache ────────────────────────────────
export function invalidateMasterCache(bagian) {
  Object.keys(_cache).forEach(key => {
    if (key.includes(`__${bagian}`)) {
      delete _cache[key];
    }
  });
}