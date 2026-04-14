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

    // Hindari fetch ulang kalau bagian sama
    if (bagian === prevBagian.current) return;
    prevBagian.current = bagian;

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      fetchCollection('master_produk', 'bagian', bagian),
      fetchCollection('master_mesin', 'bagian', bagian),
      fetchCollection('master_karyawan', 'bagian', bagian),
    ])
      .then(([produkData, mesinData, karyawanData]) => {
        if (cancelled) return;

        // ─── Produk ───
        const produk = produkData
          .map(p => ({
            value: p.docId || p.id,
            label: p.nama,
            kode:  p.kode,
          }))
          .sort((a, b) => a.label.localeCompare(b.label, 'id'));

        // ─── Mesin ───
        const mesin = mesinData
          .map(m => ({
            value: m.noMesin,
            label: m.noMesin,
          }))
          .sort((a, b) => a.label.localeCompare(b.label, 'id'));

        // ─── Karu ───
        const karu = karyawanData
          .filter(k => k.role === 'karu')
          .map(k => ({
            value: k.nama,
            label: k.nama,
          }))
          .sort((a, b) => a.label.localeCompare(b.label, 'id'));

        // ─── Asisten ───
        const asisten = karyawanData
          .filter(k => k.role === 'asisten')
          .map(k => ({
            value: k.nama,
            label: k.nama,
          }))
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