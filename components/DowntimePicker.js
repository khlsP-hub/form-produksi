// components/DowntimePicker.js
import React, { useState, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet,
  ScrollView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');

/** Hitung durasi dalam menit antara dua waktu "HH:MM" */
function calcDuration(from, to) {
  if (!from || !to) return null;
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  let diff = (th * 60 + tm) - (fh * 60 + fm);
  // Jika melewati tengah malam
  if (diff < 0) diff += 24 * 60;
  return diff; // dalam menit
}

/** Format durasi menit ke "X jam Y menit" */
function formatDuration(minutes) {
  if (minutes === null || minutes === undefined) return '';
  if (minutes === 0) return '0 menit';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} menit`;
  if (m === 0) return `${h} jam`;
  return `${h} jam ${m} menit`;
}

/**
 * Parse berbagai format downtime lama menjadi { from, to }
 * Format lama: "45", "30", "1.5", dll (angka saja = menit)
 * Format baru: "08:00 - 08:45"
 */
export function parseDowntime(value) {
  if (!value) return { from: '', to: '' };
  const str = String(value).trim();

  // Format baru: "HH:MM - HH:MM"
  const rangeMatch = str.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
  if (rangeMatch) {
    return { from: rangeMatch[1], to: rangeMatch[2] };
  }

  // Format lama (angka saja) → kembalikan kosong agar user isi ulang
  return { from: '', to: '' };
}

/**
 * Serialize { from, to } ke string "HH:MM - HH:MM"
 * Mengembalikan '' jika salah satu kosong
 */
export function serializeDowntime(from, to) {
  if (!from || !to) return '';
  return `${from} - ${to}`;
}

// ─── Scroll-based Time Picker ─────────────────────────────────────────────────
function TimeScrollPicker({ value, onChange, label }) {
  const hours   = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 12 }, (_, i) => i * 5); // 0,5,10,...,55

  const [h, m] = value
    ? value.split(':').map(Number)
    : [7, 0];

  const selectedH = isNaN(h) ? 7 : h;
  const selectedM = isNaN(m) ? 0 : Math.round(m / 5) * 5; // snap ke 5 menit

  const ITEM_H = 40;

  const handleHour   = (val) => onChange(`${pad(val)}:${pad(selectedM)}`);
  const handleMinute = (val) => onChange(`${pad(selectedH)}:${pad(val)}`);

  const ColPicker = ({ items, selected, onSelect, fmt }) => (
    <ScrollView
      style={tsp.col}
      showsVerticalScrollIndicator={false}
      snapToInterval={ITEM_H}
      decelerationRate="fast"
      contentOffset={{ y: items.indexOf(selected) * ITEM_H }}
    >
      {/* padding atas agar item pertama bisa di tengah */}
      <View style={{ height: ITEM_H }} />
      {items.map(item => {
        const active = item === selected;
        return (
          <TouchableOpacity
            key={item}
            style={[tsp.item, active && tsp.itemActive]}
            onPress={() => onSelect(item)}
            activeOpacity={0.7}
          >
            <Text style={[tsp.itemTxt, active && tsp.itemTxtActive]}>
              {fmt(item)}
            </Text>
          </TouchableOpacity>
        );
      })}
      <View style={{ height: ITEM_H }} />
    </ScrollView>
  );

  return (
    <View style={tsp.wrap}>
      <Text style={tsp.label}>{label}</Text>
      <View style={tsp.pickers}>
        <ColPicker
          items={hours}
          selected={selectedH}
          onSelect={handleHour}
          fmt={pad}
        />
        <Text style={tsp.colon}>:</Text>
        <ColPicker
          items={minutes}
          selected={selectedM}
          onSelect={handleMinute}
          fmt={pad}
        />
      </View>
      <Text style={tsp.preview}>{value || '--:--'}</Text>
    </View>
  );
}

// ─── Main DowntimePicker ──────────────────────────────────────────────────────
/**
 * Props:
 *   value    : string — format "HH:MM - HH:MM" atau "" atau lama (angka)
 *   onChange : (newValue: string) => void
 *   label    : string (opsional)
 *   error    : string (opsional)
 */
export default function DowntimePicker({ value, onChange, label = 'Downtime', error }) {
  const [visible, setVisible] = useState(false);

  const { from: initFrom, to: initTo } = useMemo(() => parseDowntime(value), [value]);

  const [from, setFrom] = useState(initFrom || '07:00');
  const [to,   setTo]   = useState(initTo   || '07:00');

  const duration = calcDuration(from, to);
  const preview  = value ? value : null;

  const handleOpen = () => {
    // Re-sync state dari value terbaru saat buka modal
    const { from: f, to: t } = parseDowntime(value);
    setFrom(f || '07:00');
    setTo(t   || '07:00');
    setVisible(true);
  };

  const handleConfirm = () => {
    const serialized = serializeDowntime(from, to);
    onChange(serialized);
    setVisible(false);
  };

  const handleClear = () => {
    onChange('');
    setVisible(false);
  };

  const hasValue = !!preview;

  return (
    <View style={dp.wrapper}>
      {!!label && <Text style={dp.label}>{label}</Text>}

      {/* Trigger button */}
      <TouchableOpacity
        style={[dp.trigger, hasValue && dp.triggerFilled, !!error && dp.triggerError]}
        onPress={handleOpen}
        activeOpacity={0.8}
      >
        <View style={[dp.iconWrap, hasValue && dp.iconWrapFilled]}>
          <Ionicons name="time-outline" size={16} color={hasValue ? '#1565C0' : '#bbb'} />
        </View>

        <View style={{ flex: 1 }}>
          {hasValue ? (
            <>
              <Text style={dp.triggerValue}>{preview}</Text>
              {duration !== null && (
                <Text style={dp.triggerDuration}>
                  Durasi: {formatDuration(duration)}
                </Text>
              )}
            </>
          ) : (
            <Text style={dp.triggerPlaceholder}>Pilih rentang waktu downtime...</Text>
          )}
        </View>

        <View style={dp.triggerRight}>
          {hasValue && (
            <TouchableOpacity
              onPress={handleClear}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={dp.clearBtn}
            >
              <Ionicons name="close-circle" size={16} color="#ccc" />
            </TouchableOpacity>
          )}
          <Ionicons name="chevron-forward" size={14} color="#ccc" />
        </View>
      </TouchableOpacity>

      {!!error && <Text style={dp.errorTxt}>{error}</Text>}

      {/* Modal picker */}
      <Modal visible={visible} transparent animationType="slide">
        <View style={dp.overlay}>
          <TouchableOpacity style={dp.backdrop} activeOpacity={1} onPress={() => setVisible(false)} />

          <View style={dp.sheet}>
            {/* Header */}
            <View style={dp.sheetHeader}>
              <View style={dp.sheetHeaderLeft}>
                <View style={dp.sheetIconWrap}>
                  <Ionicons name="time" size={16} color="#fff" />
                </View>
                <View>
                  <Text style={dp.sheetTitle}>Pilih Waktu Downtime</Text>
                  {duration !== null && (
                    <Text style={dp.sheetSubtitle}>
                      Durasi: {formatDuration(duration)}
                    </Text>
                  )}
                </View>
              </View>
              <TouchableOpacity onPress={() => setVisible(false)} style={dp.sheetClose}>
                <Ionicons name="close" size={20} color="#fff" />
              </TouchableOpacity>
            </View>

            {/* Pickers berdampingan */}
            <View style={dp.pickerRow}>
              <TimeScrollPicker
                label="Mulai"
                value={from}
                onChange={setFrom}
              />

              <View style={dp.arrowWrap}>
                <View style={dp.arrowLine} />
                <Ionicons name="arrow-forward" size={18} color="#1565C0" />
                <View style={dp.arrowLine} />
              </View>

              <TimeScrollPicker
                label="Selesai"
                value={to}
                onChange={setTo}
              />
            </View>

            {/* Preview bar */}
            <View style={dp.previewBar}>
              <Ionicons name="time-outline" size={14} color="#1565C0" />
              <Text style={dp.previewTxt}>
                {from} — {to}
                {duration !== null ? `  ·  ${formatDuration(duration)}` : ''}
              </Text>
            </View>

            {/* Tombol */}
            <View style={dp.btnRow}>
              <TouchableOpacity style={dp.btnClear} onPress={handleClear}>
                <Text style={dp.btnClearTxt}>Hapus</Text>
              </TouchableOpacity>
              <TouchableOpacity style={dp.btnConfirm} onPress={handleConfirm}>
                <Ionicons name="checkmark-circle-outline" size={17} color="#fff" />
                <Text style={dp.btnConfirmTxt}>Konfirmasi</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const dp = StyleSheet.create({
  wrapper:   { marginBottom: 12 },
  label:     { fontSize: 12, fontWeight: '700', color: '#444', marginBottom: 6 },

  trigger: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1.5, borderColor: '#D0DCF0', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#F8FAFF',
  },
  triggerFilled: { borderColor: '#1565C0', backgroundColor: '#EEF4FF' },
  triggerError:  { borderColor: '#e53935' },

  iconWrap:       { width: 30, height: 30, borderRadius: 8, backgroundColor: '#EEF4FF', justifyContent: 'center', alignItems: 'center' },
  iconWrapFilled: { backgroundColor: '#DBEAFE' },

  triggerValue:       { fontSize: 13, fontWeight: '700', color: '#1565C0' },
  triggerDuration:    { fontSize: 11, color: '#6B87A8', marginTop: 2 },
  triggerPlaceholder: { fontSize: 13, color: '#bbb' },

  triggerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  clearBtn:     { padding: 2 },

  errorTxt: { fontSize: 11, color: '#e53935', marginTop: 4 },

  // Modal
  overlay:  { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    elevation: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15, shadowRadius: 12,
  },

  sheetHeader: {
    backgroundColor: '#1565C0', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
  },
  sheetHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  sheetIconWrap:   { backgroundColor: 'rgba(255,255,255,0.2)', width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  sheetTitle:      { color: '#fff', fontSize: 14, fontWeight: '800' },
  sheetSubtitle:   { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 2 },
  sheetClose:      { padding: 4 },

  pickerRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4,
    gap: 8,
  },
  arrowWrap: { alignItems: 'center', gap: 4, paddingTop: 20 },
  arrowLine: { width: 1, height: 16, backgroundColor: '#D0DCF0' },

  previewBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#EEF4FF', marginHorizontal: 16, marginVertical: 10,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1, borderColor: '#DBEAFE',
  },
  previewTxt: { fontSize: 13, fontWeight: '700', color: '#1565C0', flex: 1 },

  btnRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 4 },
  btnClear: {
    paddingVertical: 13, paddingHorizontal: 20, borderRadius: 10,
    borderWidth: 1.5, borderColor: '#D0DCF0', alignItems: 'center',
  },
  btnClearTxt:    { fontSize: 13, fontWeight: '700', color: '#888' },
  btnConfirm: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 7, backgroundColor: '#1565C0', paddingVertical: 13, borderRadius: 10,
    elevation: 3, shadowColor: '#1565C0', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25, shadowRadius: 6,
  },
  btnConfirmTxt:  { color: '#fff', fontSize: 14, fontWeight: '800' },
});

const tsp = StyleSheet.create({
  wrap:  { flex: 1, alignItems: 'center' },
  label: { fontSize: 11, fontWeight: '700', color: '#6B87A8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  pickers: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F3F6FC', borderRadius: 12,
    borderWidth: 1, borderColor: '#D8E4F0',
    overflow: 'hidden', height: 120,
  },
  col:          { width: 52, height: 120 },
  colon:        { fontSize: 20, fontWeight: '800', color: '#1565C0', paddingHorizontal: 2 },
  item: {
    height: 40, justifyContent: 'center', alignItems: 'center',
    borderRadius: 8, marginHorizontal: 2,
  },
  itemActive:   { backgroundColor: '#1565C0' },
  itemTxt:      { fontSize: 18, fontWeight: '600', color: '#90A4AE' },
  itemTxtActive:{ color: '#fff', fontWeight: '800' },
  preview:      { fontSize: 22, fontWeight: '800', color: '#1565C0', marginTop: 8, letterSpacing: 1 },
});