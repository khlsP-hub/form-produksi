// hooks/useMasterData.js
// Fetch data master produk & mesin dari Firestore untuk SEMUA bagian.
// Cache global aktif selama sesi app — tidak fetch ulang kecuali bagian berbeda.

import { useState, useEffect, useRef } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';

// ─── Cache global ─────────────────────────────────────────────────────────────
const _cache = {};

async function fetchCollection(colName, field, value) {
  const cacheKey = `${colName}__${field}__${value}`;
  if (_cache[cacheKey]) return _cache[cacheKey];

  // Hanya where, TANPA orderBy → tidak butuh Composite Index
  const q    = query(collection(db, colName), where(field, '==', value));
  const snap = await getDocs(q);
  const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  _cache[cacheKey] = data;
  return data;
}

// ─── Hook utama ───────────────────────────────────────────────────────────────
export function useMasterData(bagian) {
  const [produkList, setProdukList] = useState([]);
  const [mesinList,  setMesinList]  = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const prevBagian = useRef(null);

  useEffect(() => {
    // Jika bagian null/undefined (belum dipilih), reset dan berhenti
    if (!bagian) {
      setProdukList([]);
      setMesinList([]);
      setLoading(false);
      setError(null);
      prevBagian.current = null;
      return;
    }

    // Skip jika bagian sama (sudah di-fetch)
    if (bagian === prevBagian.current) return;
    prevBagian.current = bagian;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setProdukList([]);
    setMesinList([]);

    Promise.all([
      fetchCollection('master_produk', 'bagian', bagian),
      fetchCollection('master_mesin',  'bagian', bagian),
    ])
      .then(([produkData, mesinData]) => {
        if (cancelled) return;

        // Produk: sort A-Z berdasarkan nama
        const produkOpts = produkData
          .map(p => ({
            value: p.docId || p.id,
            label: p.nama,
            kode:  p.kode,
          }))
          .sort((a, b) => a.label.localeCompare(b.label, 'id'));

        // Mesin: sort A-Z
        const mesinOpts = mesinData
          .map(m => ({ value: m.noMesin, label: m.noMesin }))
          .sort((a, b) => a.label.localeCompare(b.label, 'id'));

        setProdukList(produkOpts);
        setMesinList(mesinOpts);
        setLoading(false);
      })
      .catch(e => {
        if (cancelled) return;
        console.error(`useMasterData error [${bagian}]:`, e);
        setError(e.message);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [bagian]);

  return { produkList, mesinList, loading, error };
}

// ─── Utility: invalidate cache untuk satu bagian ──────────────────────────────
// Panggil ini jika data di Firestore baru saja diupdate dan ingin refresh paksa
export function invalidateMasterCache(bagian) {
  const keys = Object.keys(_cache).filter(k => k.includes(`__bagian__${bagian}`) || k.endsWith(`__${bagian}`));
  keys.forEach(k => delete _cache[k]);
}