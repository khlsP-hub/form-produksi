// components/ForceUpdateModal.js
// ─── Force Update Modal ───────────────────────────────────────────────────────
// Tampil otomatis saat versi app lebih rendah dari minimumVersion di Firestore.
// Modal TIDAK bisa ditutup — user harus update untuk melanjutkan.
//
// SETUP FIRESTORE:
//   Collection : app_config
//   Document   : version
//   Fields     :
//     minimumVersion : "1.0.2"   ← versi minimum yang wajib
//     latestVersion  : "1.0.3"   ← versi terbaru (untuk optional update)
//     updateUrl      : "https://link-download-apk-baru.apk"
//     updateMessage  : "Ada pembaruan penting yang wajib diinstal." (opsional)
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity,
  StyleSheet, Linking, ActivityIndicator,
  BackHandler,
} from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';

// ─── Version helper ───────────────────────────────────────────────────────────
// Bandingkan dua string versi "1.0.2" vs "1.0.3"
// Return true  jika v1 < v2  (v1 lebih lama)
// Return false jika v1 >= v2 (v1 sudah oke)
function isVersionLower(v1, v2) {
  const a = String(v1 || '0').split('.').map(Number);
  const b = String(v2 || '0').split('.').map(Number);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const n1 = a[i] || 0;
    const n2 = b[i] || 0;
    if (n1 < n2) return true;
    if (n1 > n2) return false;
  }
  return false; // sama persis
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ForceUpdateModal() {
  const [status,     setStatus]     = useState('checking'); // 'checking' | 'ok' | 'optional' | 'force'
  const [updateUrl,  setUpdateUrl]  = useState('');
  const [message,    setMessage]    = useState('');
  const [latestVer,  setLatestVer]  = useState('');
  const [dismissed,  setDismissed]  = useState(false); // untuk optional update

  // Versi app saat ini dari app.json
  const currentVersion = Constants.expoConfig?.version || '0.0.0';

  useEffect(() => {
    checkVersion();
  }, []);

  // Blokir tombol back Android saat force update
  useEffect(() => {
    if (status !== 'force') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [status]);

  const checkVersion = async () => {
    try {
      const snap = await getDoc(doc(db, 'app_config', 'version'));
      if (!snap.exists()) {
        setStatus('ok');
        return;
      }

      const data = snap.data();
      const minVer    = data.minimumVersion || '0.0.0';
      const latestVer = data.latestVersion  || '0.0.0';
      const url       = data.updateUrl      || '';
      const msg       = data.updateMessage  || 'Pembaruan tersedia untuk meningkatkan performa dan keamanan aplikasi.';

      setUpdateUrl(url);
      setMessage(msg);
      setLatestVer(latestVer);

      if (isVersionLower(currentVersion, minVer)) {
        // Versi terlalu lama — wajib update
        setStatus('force');
      } else if (isVersionLower(currentVersion, latestVer)) {
        // Ada versi lebih baru tapi masih bisa jalan — opsional
        setStatus('optional');
      } else {
        setStatus('ok');
      }
    } catch (e) {
      // Gagal fetch — jangan blokir user
      console.warn('ForceUpdate: gagal cek versi', e.message);
      setStatus('ok');
    }
  };

  const handleUpdate = () => {
    if (updateUrl) {
      Linking.openURL(updateUrl).catch(() => {
        // fallback jika URL tidak bisa dibuka
      });
    }
  };

  // ── Tidak perlu tampil ──────────────────────────────────────────────────────
  if (status === 'checking' || status === 'ok') return null;
  if (status === 'optional' && dismissed)       return null;

  const isForce = status === 'force';

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      // onRequestClose sengaja tidak menutup modal saat force
      onRequestClose={isForce ? undefined : () => setDismissed(true)}
    >
      <View style={st.overlay}>
        <View style={st.card}>

          {/* Icon */}
          <View style={[st.iconWrap, isForce && st.iconWrapForce]}>
            <Ionicons
              name={isForce ? 'warning' : 'arrow-up-circle'}
              size={36}
              color={isForce ? '#E53935' : '#1565C0'}
            />
          </View>

          {/* Badge versi */}
          <View style={st.versionBadge}>
            <Text style={st.versionBadgeTxt}>
              Versi kamu: <Text style={{fontWeight:'900'}}>{currentVersion}</Text>
              {'  →  '}
              Versi terbaru: <Text style={{fontWeight:'900'}}>{latestVer}</Text>
            </Text>
          </View>

          {/* Judul */}
          <Text style={[st.title, isForce && st.titleForce]}>
            {isForce ? '⚠️ Update Wajib' : '🆕 Update Tersedia'}
          </Text>

          {/* Deskripsi */}
          <Text style={st.desc}>
            {isForce
              ? `Versi aplikasi kamu sudah tidak didukung.\n\nMohon update ke versi terbaru untuk melanjutkan menggunakan aplikasi.`
              : message
            }
          </Text>

          {/* Tombol utama: Update */}
          <TouchableOpacity style={[st.btnUpdate, isForce && st.btnUpdateForce]} onPress={handleUpdate}>
            <Ionicons name="download-outline" size={18} color="#fff"/>
            <Text style={st.btnUpdateTxt}>
              {isForce ? 'Update Sekarang (Wajib)' : 'Update Sekarang'}
            </Text>
          </TouchableOpacity>

          {/* Tombol skip — hanya untuk optional */}
          {!isForce && (
            <TouchableOpacity style={st.btnSkip} onPress={() => setDismissed(true)}>
              <Text style={st.btnSkipTxt}>Nanti Saja</Text>
            </TouchableOpacity>
          )}

          {/* Keterangan tambahan untuk force */}
          {isForce && (
            <View style={st.forceNote}>
              <Ionicons name="lock-closed-outline" size={13} color="#E53935"/>
              <Text style={st.forceNoteTxt}>
                Aplikasi tidak bisa digunakan sebelum diperbarui
              </Text>
            </View>
          )}

        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
  },
  card: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 12,
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
  },

  // Icon
  iconWrap: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#E3F2FD',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 4,
  },
  iconWrapForce: { backgroundColor: '#FFEBEE' },

  // Versi
  versionBadge: {
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20,
  },
  versionBadgeTxt: { fontSize: 11, color: '#555' },

  // Judul
  title: {
    fontSize: 20, fontWeight: '900', color: '#1565C0',
    textAlign: 'center',
  },
  titleForce: { color: '#C62828' },

  // Deskripsi
  desc: {
    fontSize: 13, color: '#555', textAlign: 'center',
    lineHeight: 20,
  },

  // Tombol update
  btnUpdate: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#1565C0',
    paddingVertical: 14, paddingHorizontal: 24,
    borderRadius: 12, width: '100%', justifyContent: 'center',
    elevation: 3,
    shadowColor: '#1565C0', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3, shadowRadius: 6,
  },
  btnUpdateForce: { backgroundColor: '#C62828' },
  btnUpdateTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },

  // Tombol skip
  btnSkip: { paddingVertical: 8, paddingHorizontal: 16 },
  btnSkipTxt: { fontSize: 13, color: '#aaa', fontWeight: '600' },

  // Catatan force
  forceNote: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#FFEBEE',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    marginTop: 4,
  },
  forceNoteTxt: { fontSize: 11, color: '#C62828', flex: 1, lineHeight: 16 },
});