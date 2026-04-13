// components/ShiftSection.js
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AppInput from './AppInput';
import AppDropdown from './AppDropdown';
import { Ionicons } from '@expo/vector-icons';
import { STATUS_OPTIONS, createEmptyShiftRow, formatAngka, unformatAngka } from '../data/masterData';

export default function ShiftSection({ shiftNumber, data, onChange }) {

  const updateField = (field, value) => onChange({ ...data, [field]: value });

  const updateRow = (index, field, value) => {
    const rows = [...data.rows];
    rows[index] = { ...rows[index], [field]: value };
    onChange({ ...data, rows });
  };

  // Output — format titik ribuan
  const handleOutputChange = (text) => {
    const formatted = formatAngka(text);
    onChange({ ...data, output: formatted, outputRaw: unformatAngka(formatted) });
  };

  // Total Reject — format titik ribuan
  const handleTotalRejectChange = (index, text) => {
    const formatted = formatAngka(text);
    const rows = [...data.rows];
    rows[index] = { ...rows[index], totalReject: formatted, totalRejectRaw: unformatAngka(formatted) };
    onChange({ ...data, rows });
  };

  const addRow = () => onChange({ ...data, rows: [...data.rows, createEmptyShiftRow()] });

  const removeRow = (index) => {
    if (data.rows.length === 1) return;
    onChange({ ...data, rows: data.rows.filter((_, i) => i !== index) });
  };

  return (
    <View style={styles.section}>

      {/* ── Header shift ── */}
      <View style={styles.shiftHeader}>
        <Text style={styles.shiftTitle}>SHIFT {shiftNumber}</Text>
      </View>

      <View style={styles.shiftBody}>

        {/* ── Baris 1: Output · Cavity · Cycle Time ── */}
        <View style={styles.row3}>
          <View style={styles.flex1}>
            <AppInput
              label="Output"
              value={data.output}
              onChangeText={handleOutputChange}
              placeholder="0"
              keyboardType="numeric"
            />
          </View>
          <View style={styles.flex1}>
            <AppInput
              label="Cavity"
              value={data.cavity}
              onChangeText={(v) => updateField('cavity', v)}
              placeholder="0"
              keyboardType="numeric"
            />
          </View>
          <View style={styles.flex1}>
            <AppInput
              label="Cycle Time (dtk)"
              value={data.cycleTime}
              onChangeText={(v) => updateField('cycleTime', v)}
              placeholder="0"
              keyboardType="numeric"
            />
          </View>
        </View>

        {/* ── Baris 2: Karu (full width) ── */}
        <AppInput
          label="Nama Karu"
          value={data.karu}
          onChangeText={(v) => updateField('karu', v)}
          placeholder="Masukkan nama kepala regu"
        />

        {/* ── Divider ── */}
        <View style={styles.divider} />
        <Text style={styles.tableTitle}>Data Permasalahan</Text>

        {/* ── Tabel permasalahan ── */}
        {data.rows.map((row, index) => (
          <View key={index} style={styles.rowCard}>

            <View style={styles.rowHeader}>
              <View style={styles.rowBadge}>
                <Text style={styles.rowBadgeText}>Permasalahan #{index + 1}</Text>
              </View>
              {data.rows.length > 1 && (
                <TouchableOpacity onPress={() => removeRow(index)} style={styles.deleteBtn}>
                  <Ionicons name="trash-outline" size={16} color="#e53935" />
                  <Text style={styles.deleteText}>Hapus</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Downtime */}
            <AppInput
              label="Downtime (menit)"
              value={row.downtime}
              onChangeText={(v) => updateRow(index, 'downtime', v)}
              placeholder="Contoh: 30"
              keyboardType="numeric"
            />

            {/* Permasalahan */}
            <AppInput
              label="Permasalahan"
              value={row.permasalahan}
              onChangeText={(v) => updateRow(index, 'permasalahan', v)}
              placeholder="Jelaskan permasalahan yang terjadi"
              multiline
              numberOfLines={3}
            />

            {/* Total Reject */}
            <AppInput
              label="Total Reject (KG)"
              value={row.totalReject}
              onChangeText={(text) => handleTotalRejectChange(index, text)}
              placeholder="Contoh: 1.500"
              keyboardType="numeric"
            />

            {/* Penanganan */}
            <AppInput
              label="Penanganan"
              value={row.penanganan}
              onChangeText={(v) => updateRow(index, 'penanganan', v)}
              placeholder="Jelaskan tindakan yang diambil"
              multiline
              numberOfLines={3}
            />

            {/* Nama Asisten + Status berdampingan */}
            <View style={styles.row2}>
              <View style={{ flex: 3 }}>
                <AppInput
                  label="Nama Asisten"
                  value={row.namaAsisten}
                  onChangeText={(v) => updateRow(index, 'namaAsisten', v)}
                  placeholder="Nama asisten"
                />
              </View>
              <View style={{ flex: 2 }}>
                <AppDropdown
                  label="Status"
                  options={STATUS_OPTIONS}
                  value={row.status}
                  onChange={(v) => updateRow(index, 'status', v)}
                />
              </View>
            </View>

          </View>
        ))}

        {/* ── Tombol tambah ── */}
        <TouchableOpacity style={styles.addRowBtn} onPress={addRow}>
          <Ionicons name="add-circle-outline" size={18} color="#1565C0" />
          <Text style={styles.addRowText}>Tambah Permasalahan</Text>
        </TouchableOpacity>

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: '#fff', borderRadius: 12, marginBottom: 16, overflow: 'hidden',
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1, shadowRadius: 3,
  },
  shiftHeader: {
    backgroundColor: '#1565C0', paddingVertical: 11, paddingHorizontal: 16,
  },
  shiftTitle:  { color: '#fff', fontWeight: '800', fontSize: 14, letterSpacing: 2 },
  shiftBody:   { padding: 14 },

  // 3-kolom Output / Cavity / Cycle Time
  row3:  { flexDirection: 'row', gap: 8, marginBottom: 0 },
  // 2-kolom Nama Asisten + Status
  row2:  { flexDirection: 'row', gap: 8 },
  flex1: { flex: 1 },

  divider: { height: 1, backgroundColor: '#EEF0F2', marginVertical: 12 },
  tableTitle: {
    fontSize: 13, fontWeight: '700', color: '#444',
    marginBottom: 8, letterSpacing: 0.3,
  },

  rowCard: {
    backgroundColor: '#F8FAFC', borderRadius: 10, padding: 12, marginBottom: 10,
    borderLeftWidth: 3, borderLeftColor: '#42A5F5',
  },
  rowHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 10,
  },
  rowBadge: {
    backgroundColor: '#E3F2FD', paddingHorizontal: 10,
    paddingVertical: 3, borderRadius: 20,
  },
  rowBadgeText: { fontSize: 11, fontWeight: '700', color: '#1565C0' },
  deleteBtn:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  deleteText:   { fontSize: 12, color: '#e53935', fontWeight: '600' },

  addRowBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 11, borderWidth: 1.5,
    borderColor: '#1565C0', borderRadius: 8, borderStyle: 'dashed',
    marginTop: 4,
  },
  addRowText: { color: '#1565C0', fontWeight: '700', fontSize: 13 },
});
