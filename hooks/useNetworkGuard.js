// hooks/useNetworkGuard.js
// ──────────────────────────────────────────────────────────────────────────────
// Cek apakah device terhubung ke jaringan lokal PT.
// Ganti ALLOWED_PREFIXES sesuai subnet WiFi perusahaan Anda.
// ──────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react';
import * as Network from 'expo-network';

// ▼ KONFIGURASI — Sesuaikan dengan subnet WiFi PT Anda
// Contoh: jika IP kantor 192.168.10.x, tambahkan '192.168.10.'
// Bisa lebih dari satu subnet (misal ada beberapa gedung)
const ALLOWED_PREFIXES = [
  '192.168.137.1',   // semua subnet 192.168.x.x (umum untuk LAN)
  // '10.0.0.',  // tambahkan jika PT pakai range 10.x.x.x
  // '172.16.',  // tambahkan jika PT pakai range 172.16.x.x
];

// Set ke true untuk testing di emulator/luar jaringan PT
const BYPASS_FOR_TESTING = false;

export function useNetworkGuard() {
  const [status, setStatus] = useState('checking'); // 'checking' | 'allowed' | 'blocked'
  const [currentIP, setCurrentIP] = useState('');

  const checkNetwork = useCallback(async () => {
    setStatus('checking');
    try {
      if (BYPASS_FOR_TESTING) {
        setStatus('allowed');
        return;
      }

      const networkState = await Network.getNetworkStateAsync();

      // Harus terhubung via WiFi (bukan data seluler)
      if (!networkState.isConnected || networkState.type !== Network.NetworkStateType.WIFI) {
        setStatus('blocked');
        setCurrentIP('');
        return;
      }

      const ip = await Network.getIpAddressAsync();
      setCurrentIP(ip || '');

      const isAllowed = ALLOWED_PREFIXES.some(prefix => ip?.startsWith(prefix));
      setStatus(isAllowed ? 'allowed' : 'blocked');
    } catch (e) {
      console.log('Network check error:', e);
      setStatus('blocked');
    }
  }, []);

  useEffect(() => {
    checkNetwork();

    // Re-check setiap 30 detik (jika user ganti WiFi)
    const interval = setInterval(checkNetwork, 30_000);
    return () => clearInterval(interval);
  }, [checkNetwork]);

  return { status, currentIP, retry: checkNetwork };
}
