// components/NetworkBlockedScreen.js
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function NetworkBlockedScreen({ status, onRetry }) {
  const isChecking = status === 'checking';

  return (
    <View style={styles.container}>
      <View style={styles.card}>

        {isChecking ? (
          <>
            <ActivityIndicator size="large" color="#1565C0" style={{ marginBottom: 16 }} />
            <Text style={styles.title}>Memeriksa Jaringan...</Text>
            <Text style={styles.subtitle}>Mohon tunggu sebentar</Text>
          </>
        ) : (
          <>
            <View style={styles.iconWrap}>
              <Ionicons name="wifi-outline" size={64} color="#e53935" />
              <View style={styles.badge}>
                <Ionicons name="close" size={18} color="#fff" />
              </View>
            </View>

            <Text style={styles.title}>Akses Ditolak</Text>
            <Text style={styles.subtitle}>
              Aplikasi ini hanya dapat digunakan di dalam jaringan PT.
            </Text>

            <View style={styles.infoBox}>
              <Ionicons name="information-circle-outline" size={18} color="#1565C0" />
              <Text style={styles.infoText}>
                Pastikan perangkat Anda terhubung ke jaringan kantor, bukan menggunakan data seluler.
              </Text>
            </View>

            <TouchableOpacity style={styles.retryBtn} onPress={onRetry}>
              <Ionicons name="refresh-outline" size={18} color="#fff" />
              <Text style={styles.retryText}>Coba Lagi</Text>
            </TouchableOpacity>
          </>
        )}

      </View>

      <Text style={styles.footer}>Form Permasalahan Produksi</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F4F8',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
  },
  iconWrap: {
    position: 'relative',
    marginBottom: 20,
  },
  badge: {
    position: 'absolute',
    bottom: -2,
    right: -4,
    backgroundColor: '#e53935',
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1a1a2e',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#E3F2FD',
    borderRadius: 8,
    padding: 12,
    gap: 8,
    marginBottom: 24,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    color: '#1565C0',
    lineHeight: 18,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1565C0',
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 8,
  },
  retryText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  footer: {
    marginTop: 24,
    fontSize: 11,
    color: '#aaa',
  },
});
