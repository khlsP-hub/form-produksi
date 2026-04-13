// components/DatePickerInput.js
// Inline date picker — tidak butuh library eksternal, pure React Native.
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal,
  StyleSheet, ScrollView
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const MONTHS = [
  'Januari','Februari','Maret','April','Mei','Juni',
  'Juli','Agustus','September','Oktober','November','Desember'
];

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function parseLocalDate(str) {
  // Format: "DD/MM/YYYY"
  const parts = str.split('/');
  if (parts.length === 3) {
    return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
  }
  return new Date();
}

function formatDisplay(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

export default function DatePickerInput({ label, value, onChange, error }) {
  const [visible, setVisible] = useState(false);

  const currentDate = parseLocalDate(value);
  const [tempDate, setTempDate] = useState(currentDate);

  const today = new Date();

  const open = () => {
    setTempDate(parseLocalDate(value));
    setVisible(true);
  };

  const confirm = () => {
    onChange(formatDisplay(tempDate));
    setVisible(false);
  };

  const setToday = () => {
    setTempDate(new Date());
  };

  const changeMonth = (dir) => {
    const d = new Date(tempDate);
    d.setDate(1);
    d.setMonth(d.getMonth() + dir);
    // Jangan lewat hari ini
    if (d > today) return;
    setTempDate(d);
  };

  const changeYear = (dir) => {
    const d = new Date(tempDate);
    d.setFullYear(d.getFullYear() + dir);
    if (d > today) return;
    setTempDate(d);
  };

  const selectDay = (day) => {
    const d = new Date(tempDate.getFullYear(), tempDate.getMonth(), day);
    if (d > today) return; // tidak boleh pilih masa depan
    setTempDate(d);
  };

  // Build calendar grid
  const year  = tempDate.getFullYear();
  const month = tempDate.getMonth();
  const daysInMonth  = getDaysInMonth(year, month);
  const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0=Sun
  const todayDate = today.getDate();
  const todayMonth = today.getMonth();
  const todayYear  = today.getFullYear();

  const days = [];
  for (let i = 0; i < firstDayOfWeek; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  const isFuture = (day) => {
    if (!day) return false;
    const d = new Date(year, month, day);
    return d > today;
  };

  const isToday = (day) => day === todayDate && month === todayMonth && year === todayYear;
  const isSelected = (day) => day === tempDate.getDate() && month === tempDate.getMonth() && year === tempDate.getFullYear();

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TouchableOpacity
        style={[styles.selector, error && styles.errorBorder]}
        onPress={open}
        activeOpacity={0.7}
      >
        <Ionicons name="calendar-outline" size={16} color="#1565C0" />
        <Text style={styles.selectorText}>{value}</Text>
        <Ionicons name="chevron-down" size={16} color="#999" />
      </TouchableOpacity>
      {error && <Text style={styles.errorText}>{error}</Text>}

      <Modal visible={visible} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.sheet}>

            {/* ── Header ── */}
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Pilih Tanggal</Text>
              <TouchableOpacity onPress={() => setVisible(false)}>
                <Ionicons name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </View>

            <View style={styles.sheetBody}>
              {/* ── Navigasi Bulan/Tahun ── */}
              <View style={styles.navRow}>
                <TouchableOpacity onPress={() => changeYear(-1)} style={styles.navBtn}>
                  <Ionicons name="chevron-back-outline" size={14} color="#555" />
                  <Ionicons name="chevron-back-outline" size={14} color="#555" style={{ marginLeft: -8 }} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => changeMonth(-1)} style={styles.navBtn}>
                  <Ionicons name="chevron-back" size={18} color="#555" />
                </TouchableOpacity>

                <Text style={styles.navLabel}>
                  {MONTHS[month]} {year}
                </Text>

                <TouchableOpacity
                  onPress={() => changeMonth(1)}
                  style={[styles.navBtn, (month === todayMonth && year === todayYear) && styles.navDisabled]}
                >
                  <Ionicons name="chevron-forward" size={18} color={month === todayMonth && year === todayYear ? '#ccc' : '#555'} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => changeYear(1)}
                  style={[styles.navBtn, year >= todayYear && styles.navDisabled]}
                >
                  <Ionicons name="chevron-forward-outline" size={14} color={year >= todayYear ? '#ccc' : '#555'} />
                  <Ionicons name="chevron-forward-outline" size={14} color={year >= todayYear ? '#ccc' : '#555'} style={{ marginLeft: -8 }} />
                </TouchableOpacity>
              </View>

              {/* ── Header hari ── */}
              <View style={styles.dayHeaderRow}>
                {['Min','Sen','Sel','Rab','Kam','Jum','Sab'].map(d => (
                  <Text key={d} style={styles.dayHeaderText}>{d}</Text>
                ))}
              </View>

              {/* ── Grid tanggal ── */}
              <View style={styles.grid}>
                {days.map((day, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[
                      styles.dayCell,
                      isSelected(day) && styles.dayCellSelected,
                      isToday(day) && !isSelected(day) && styles.dayCellToday,
                      isFuture(day) && styles.dayCellDisabled,
                      !day && styles.dayCellEmpty,
                    ]}
                    onPress={() => day && !isFuture(day) && selectDay(day)}
                    activeOpacity={day && !isFuture(day) ? 0.7 : 1}
                  >
                    <Text style={[
                      styles.dayText,
                      isSelected(day) && styles.dayTextSelected,
                      isToday(day) && !isSelected(day) && styles.dayTextToday,
                      isFuture(day) && styles.dayTextDisabled,
                    ]}>
                      {day || ''}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* ── Tombol Hari Ini ── */}
              <TouchableOpacity onPress={setToday} style={styles.todayBtn}>
                <Ionicons name="today-outline" size={15} color="#1565C0" />
                <Text style={styles.todayBtnText}>Hari Ini</Text>
              </TouchableOpacity>

              {/* ── Confirm ── */}
              <TouchableOpacity onPress={confirm} style={styles.confirmBtn}>
                <Text style={styles.confirmText}>
                  Pilih  {formatDisplay(tempDate)}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const CELL = 44;

const styles = StyleSheet.create({
  container: { marginBottom: 12 },
  label:     { fontSize: 13, fontWeight: '600', color: '#333', marginBottom: 4 },
  selector: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1.5, borderColor: '#D0DCF0', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11, backgroundColor: '#F8FAFF',
  },
  selectorText: { flex: 1, fontSize: 14, color: '#222', fontWeight: '600' },
  errorBorder:  { borderColor: '#e53935' },
  errorText:    { fontSize: 12, color: '#e53935', marginTop: 3 },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  sheetHeader: {
    backgroundColor: '#1565C0', flexDirection: 'row',
    justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  sheetTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  sheetBody:  { padding: 16 },

  navRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 12,
  },
  navBtn:      { padding: 6, flexDirection: 'row', alignItems: 'center' },
  navDisabled: { opacity: 0.3 },
  navLabel:    { fontSize: 15, fontWeight: '700', color: '#1565C0', flex: 1, textAlign: 'center' },

  dayHeaderRow: { flexDirection: 'row', marginBottom: 4 },
  dayHeaderText: {
    width: `${100/7}%`, textAlign: 'center',
    fontSize: 11, fontWeight: '700', color: '#888',
  },

  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: {
    width: `${100/7}%`, height: CELL,
    justifyContent: 'center', alignItems: 'center',
  },
  dayCellSelected:  { backgroundColor: '#1565C0', borderRadius: 22 },
  dayCellToday:     { borderWidth: 1.5, borderColor: '#1565C0', borderRadius: 22 },
  dayCellDisabled:  { opacity: 0.25 },
  dayCellEmpty:     {},
  dayText:          { fontSize: 14, color: '#222' },
  dayTextSelected:  { color: '#fff', fontWeight: '700' },
  dayTextToday:     { color: '#1565C0', fontWeight: '700' },
  dayTextDisabled:  { color: '#bbb' },

  todayBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, marginTop: 8, paddingVertical: 8,
    borderWidth: 1, borderColor: '#D0DCF0', borderRadius: 8,
  },
  todayBtnText: { color: '#1565C0', fontSize: 13, fontWeight: '600' },

  confirmBtn: {
    backgroundColor: '#1565C0', borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', marginTop: 10,
  },
  confirmText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});