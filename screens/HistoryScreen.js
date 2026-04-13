// screens/HistoryScreen.js
import React, { useEffect, useState, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Alert, Modal, ScrollView,
  TextInput, KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import {
  collection, query, orderBy, onSnapshot,
  deleteDoc, doc, updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { Ionicons } from '@expo/vector-icons';
import { BAGIAN_PRODUKSI, NAMA_PRODUK } from '../data/masterData';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getLabel = (options, value) => {
  if (!options || !value) return value || '-';
  const found = options.find(o => o.value === value);
  return found ? found.label : value;
};

const parseReject = (val) => {
  const str = String(val || 0).trim();
  if (!str) return 0;
  return str.includes(',')
    ? parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0
    : parseFloat(str) || 0;
};

const emptyRow = () => ({
  downtime: '',
  permasalahan: '',
  totalReject: '',
  penanganan: '',
  namaAsisten: '',
  status: 'open',
});

const emptyShift = () => ({
  output: '',
  cavity: '',
  cycleTime: '',
  karu: '',
  rows: [emptyRow()],
});

const cloneItem = (item) => ({
  tanggal:        item.tanggal        || '',
  bagianProduksi: item.bagianProduksi || '',
  namaProduk:     item.namaProduk     || '',
  kodeProduk:     item.kodeProduk     || '',
  noMesin:        item.noMesin        || '',
  berat:          String(item.berat   || ''),
  shift1: cloneShift(item.shift1),
  shift2: cloneShift(item.shift2),
  shift3: cloneShift(item.shift3),
});

const cloneShift = (shift) => {
  if (!shift) return null;
  return {
    output:    String(shift.output    || ''),
    cavity:    String(shift.cavity    || ''),
    cycleTime: String(shift.cycleTime || ''),
    karu:      String(shift.karu      || ''),
    rows: (shift.rows || []).map(r => ({
      downtime:     String(r.downtime     || ''),
      permasalahan: String(r.permasalahan || ''),
      totalReject:  String(r.totalReject  || ''),
      penanganan:   String(r.penanganan   || ''),
      namaAsisten:  String(r.namaAsisten  || ''),
      status:       r.status || 'open',
    })),
  };
};

// ─── Komponen input label ─────────────────────────────────────────────────────
function FieldInput({ label, value, onChangeText, keyboardType, placeholder, multiline }) {
  return (
    <View style={edit.fieldWrap}>
      <Text style={edit.fieldLabel}>{label}</Text>
      <TextInput
        style={[edit.fieldInput, multiline && edit.fieldInputMulti]}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType || 'default'}
        placeholder={placeholder || '-'}
        placeholderTextColor="#C5C5C5"
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
      />
    </View>
  );
}

// ─── Editor satu row permasalahan ─────────────────────────────────────────────
function RowEditor({ row, idx, onUpdate, onRemove, canRemove }) {
  const update = (field, val) => onUpdate({ ...row, [field]: val });
  return (
    <View style={edit.rowCard}>
      <View style={edit.rowCardHeader}>
        <View style={edit.rowBadge}>
          <Text style={edit.rowBadgeTxt}>#{idx + 1}</Text>
        </View>
        <Text style={edit.rowTitle}>Permasalahan #{idx + 1}</Text>
        {canRemove && (
          <TouchableOpacity onPress={onRemove} style={edit.rowRemoveBtn} hitSlop={{top:8,bottom:8,left:8,right:8}}>
            <Ionicons name="trash-outline" size={14} color="#e53935"/>
          </TouchableOpacity>
        )}
      </View>

      <FieldInput label="Downtime (menit)" value={row.downtime}
        onChangeText={v => update('downtime', v)} keyboardType="numeric"/>
      <FieldInput label="Permasalahan" value={row.permasalahan}
        onChangeText={v => update('permasalahan', v)} multiline/>
      <FieldInput label="Total Reject (KG)" value={row.totalReject}
        onChangeText={v => update('totalReject', v)} keyboardType="numeric"
        placeholder="Contoh: 3,5"/>
      <FieldInput label="Penanganan" value={row.penanganan}
        onChangeText={v => update('penanganan', v)} multiline/>
      <FieldInput label="Nama Asisten" value={row.namaAsisten}
        onChangeText={v => update('namaAsisten', v)}/>

      {/* Status toggle */}
      <View style={edit.statusRow}>
        <Text style={edit.fieldLabel}>Status</Text>
        <View style={edit.statusToggleWrap}>
          <TouchableOpacity
            style={[edit.statusBtn, row.status === 'open' && edit.statusBtnOpen]}
            onPress={() => update('status', 'open')}
          >
            <Text style={[edit.statusBtnTxt, row.status === 'open' && { color: '#c62828' }]}>OPEN</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[edit.statusBtn, row.status === 'close' && edit.statusBtnClose]}
            onPress={() => update('status', 'close')}
          >
            <Text style={[edit.statusBtnTxt, row.status === 'close' && { color: '#2e7d32' }]}>CLOSE</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ─── Editor satu shift ────────────────────────────────────────────────────────
function ShiftEditor({ shiftNum, shift, onUpdate, enabled, onToggle }) {
  const update = (field, val) => onUpdate({ ...shift, [field]: val });

  const updateRow = (idx, newRow) => {
    const rows = [...(shift.rows || [])];
    rows[idx] = newRow;
    onUpdate({ ...shift, rows });
  };

  const addRow = () => {
    const rows = [...(shift.rows || []), emptyRow()];
    onUpdate({ ...shift, rows });
  };

  const removeRow = (idx) => {
    const rows = (shift.rows || []).filter((_, i) => i !== idx);
    onUpdate({ ...shift, rows: rows.length > 0 ? rows : [emptyRow()] });
  };

  return (
    <View style={edit.shiftCard}>
      {/* Header shift */}
      <TouchableOpacity style={edit.shiftHeader} onPress={onToggle} activeOpacity={0.8}>
        <View style={[edit.shiftNumBadge, enabled && edit.shiftNumBadgeActive]}>
          <Text style={[edit.shiftNumTxt, enabled && { color: '#fff' }]}>S{shiftNum}</Text>
        </View>
        <Text style={[edit.shiftTitle, enabled && { color: '#1565C0' }]}>
          Shift {shiftNum}
        </Text>
        <View style={edit.shiftToggleWrap}>
          <Text style={edit.shiftToggleLbl}>{enabled ? 'Aktif' : 'Nonaktif'}</Text>
          <Switch
            value={enabled}
            onValueChange={onToggle}
            trackColor={{ false: '#D0D8E4', true: '#90CAF9' }}
            thumbColor={enabled ? '#1565C0' : '#f4f3f4'}
            style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
          />
        </View>
      </TouchableOpacity>

      {enabled && shift && (
        <View style={edit.shiftBody}>
          <View style={edit.shiftFieldRow}>
            <View style={{ flex: 1 }}>
              <FieldInput label="Output (pcs)" value={shift.output}
                onChangeText={v => update('output', v)} keyboardType="numeric"/>
            </View>
            <View style={{ width: 12 }}/>
            <View style={{ flex: 1 }}>
              <FieldInput label="Cavity" value={shift.cavity}
                onChangeText={v => update('cavity', v)} keyboardType="numeric"/>
            </View>
          </View>
          <View style={edit.shiftFieldRow}>
            <View style={{ flex: 1 }}>
              <FieldInput label="Cycle Time" value={shift.cycleTime}
                onChangeText={v => update('cycleTime', v)} keyboardType="numeric"/>
            </View>
            <View style={{ width: 12 }}/>
            <View style={{ flex: 1 }}>
              <FieldInput label="Nama Karu" value={shift.karu}
                onChangeText={v => update('karu', v)}/>
            </View>
          </View>

          {/* Rows permasalahan */}
          <View style={edit.rowsSection}>
            <Text style={edit.rowsSectionTitle}>Permasalahan</Text>
            {(shift.rows || []).map((row, idx) => (
              <RowEditor
                key={idx}
                row={row}
                idx={idx}
                onUpdate={newRow => updateRow(idx, newRow)}
                onRemove={() => removeRow(idx)}
                canRemove={(shift.rows || []).length > 1}
              />
            ))}
            <TouchableOpacity style={edit.addRowBtn} onPress={addRow}>
              <Ionicons name="add-circle-outline" size={16} color="#1565C0"/>
              <Text style={edit.addRowTxt}>Tambah Permasalahan</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────
function EditModal({ item, onClose, onSaved }) {
  const [form, setForm]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [shiftOn, setShiftOn] = useState({ 1: false, 2: false, 3: false });

  useEffect(() => {
    if (item) {
      const cloned = cloneItem(item);
      setForm(cloned);
      setShiftOn({
        1: !!item.shift1,
        2: !!item.shift2,
        3: !!item.shift3,
      });
    }
  }, [item]);

  if (!item || !form) return null;

  const updateShift = (num, val) => setForm(p => ({ ...p, [`shift${num}`]: val }));

  const toggleShift = (num) => {
    setShiftOn(p => {
      const nowOn = !p[num];
      if (nowOn && !form[`shift${num}`]) {
        setForm(f => ({ ...f, [`shift${num}`]: emptyShift() }));
      }
      return { ...p, [num]: nowOn };
    });
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const payload = {
        tanggal:        form.tanggal,
        bagianProduksi: form.bagianProduksi,
        namaProduk:     form.namaProduk,
        kodeProduk:     form.kodeProduk,
        noMesin:        form.noMesin,
        berat:          form.berat,
        shift1:         shiftOn[1] ? form.shift1 : null,
        shift2:         shiftOn[2] ? form.shift2 : null,
        shift3:         shiftOn[3] ? form.shift3 : null,
      };
      await updateDoc(doc(db, 'form_produksi', item.id), payload);
      Alert.alert('Berhasil ✅', 'Data berhasil diperbarui!', [
        { text: 'OK', onPress: () => { onClose(); onSaved?.(); } }
      ]);
    } catch (e) {
      Alert.alert('Error ❌', 'Gagal menyimpan: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const confirmSave = () => {
    Alert.alert('Simpan Perubahan', 'Yakin ingin menyimpan perubahan ini?', [
      { text: 'Batal', style: 'cancel' },
      { text: 'Simpan', onPress: handleSave },
    ]);
  };

  return (
    <Modal visible={!!item} transparent animationType="slide">
      <View style={edit.overlay}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={edit.sheet}>
            {/* Header */}
            <View style={edit.header}>
              <View style={{ flex: 1 }}>
                <Text style={edit.headerLabel}>EDIT FORM</Text>
                <Text style={edit.headerTitle} numberOfLines={1}>
                  {form.namaProduk || form.kodeProduk || 'Form'}
                </Text>
              </View>
              <TouchableOpacity onPress={onClose} style={edit.closeBtn} disabled={loading}>
                <Ionicons name="close" size={22} color="#fff"/>
              </TouchableOpacity>
            </View>

            <ScrollView
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 40 }}
            >
              {/* ── Data Produksi ── */}
              <View style={edit.section}>
                <View style={edit.sectionHeader}>
                  <View style={edit.sectionIconWrap}>
                    <Ionicons name="cube-outline" size={14} color="#1565C0"/>
                  </View>
                  <Text style={edit.sectionTitle}>Data Produksi</Text>
                </View>

                <FieldInput label="Tanggal" value={form.tanggal}
                  onChangeText={v => setForm(p => ({ ...p, tanggal: v }))}/>
                <FieldInput label="Bagian Produksi" value={form.bagianProduksi}
                  onChangeText={v => setForm(p => ({ ...p, bagianProduksi: v }))}/>
                <FieldInput label="Nama Produk" value={form.namaProduk}
                  onChangeText={v => setForm(p => ({ ...p, namaProduk: v }))}/>
                <FieldInput label="Kode Produk" value={form.kodeProduk}
                  onChangeText={v => setForm(p => ({ ...p, kodeProduk: v }))}/>
                <FieldInput label="No. Mesin" value={form.noMesin}
                  onChangeText={v => setForm(p => ({ ...p, noMesin: v }))}/>
                <FieldInput label="Berat (gram)" value={form.berat}
                  onChangeText={v => setForm(p => ({ ...p, berat: v }))}
                  keyboardType="numeric"/>
              </View>

              {/* ── Shift 1/2/3 ── */}
              <View style={edit.section}>
                <View style={edit.sectionHeader}>
                  <View style={edit.sectionIconWrap}>
                    <Ionicons name="time-outline" size={14} color="#1565C0"/>
                  </View>
                  <Text style={edit.sectionTitle}>Data Shift</Text>
                </View>

                {[1, 2, 3].map(num => (
                  <ShiftEditor
                    key={num}
                    shiftNum={num}
                    shift={form[`shift${num}`]}
                    onUpdate={val => updateShift(num, val)}
                    enabled={shiftOn[num]}
                    onToggle={() => toggleShift(num)}
                  />
                ))}
              </View>
            </ScrollView>

            {/* ── Footer tombol ── */}
            <View style={edit.footer}>
              <TouchableOpacity style={edit.cancelBtn} onPress={onClose} disabled={loading}>
                <Text style={edit.cancelTxt}>Batal</Text>
              </TouchableOpacity>
              <TouchableOpacity style={edit.saveBtn} onPress={confirmSave} disabled={loading}>
                {loading
                  ? <ActivityIndicator size="small" color="#fff"/>
                  : <><Ionicons name="checkmark-circle-outline" size={18} color="#fff"/>
                     <Text style={edit.saveTxt}>Simpan Perubahan</Text></>
                }
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────
function DetailModal({ item, onClose }) {
  if (!item) return null;

  const renderShift = (shift, num) => {
    if (!shift) return null;
    return (
      <View key={num} style={styles.detailShift}>
        <Text style={styles.detailShiftTitle}>SHIFT {num}</Text>
        {[
          ['Output', shift.output],
          ['Cavity', shift.cavity],
          ['Cycle Time', shift.cycleTime],
          ['Karu', shift.karu],
        ].map(([k, v]) => (
          <View style={styles.detailRow} key={k}>
            <Text style={styles.detailKey}>{k}</Text>
            <Text style={styles.detailVal}>{v || '-'}</Text>
          </View>
        ))}
        {shift.rows?.map((row, i) => (
          <View key={i} style={styles.rowDetail}>
            <Text style={styles.rowNum}>Permasalahan #{i + 1}</Text>
            {[
              ['Downtime', row.downtime],
              ['Permasalahan', row.permasalahan],
              ['Total Reject (KG)', row.totalReject],
              ['Penanganan', row.penanganan],
              ['Nama Asisten', row.namaAsisten],
              ['Status', row.status],
            ].map(([k, v]) => (
              <View style={styles.detailRow} key={k}>
                <Text style={styles.detailKey}>{k}</Text>
                <Text style={[
                  styles.detailVal,
                  k === 'Status' && v === 'open'  && styles.statusOpen,
                  k === 'Status' && v === 'close' && styles.statusClose,
                ]}>
                  {v || '-'}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    );
  };

  return (
    <Modal visible={!!item} transparent animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={styles.detailModal}>
          <View style={styles.detailHeader}>
            <Text style={styles.detailTitle}>Detail Form</Text>
            <TouchableOpacity onPress={onClose} style={styles.detailClose}>
              <Ionicons name="close" size={22} color="#fff"/>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.detailScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.detailSection}>
              <Text style={styles.detailSectionTitle}>Data Produksi</Text>
              {[
                ['Tanggal',          item.tanggal],
                ['Bagian Produksi',  getLabel(BAGIAN_PRODUKSI, item.bagianProduksi)],
                ['Nama Produk',      item.namaProduk],
                ['Kode Produk',      item.kodeProduk],
                ['No. Mesin',        item.noMesin],
                ['Berat',            item.berat],
              ].map(([k, v]) => (
                <View style={styles.detailRow} key={k}>
                  <Text style={styles.detailKey}>{k}</Text>
                  <Text style={styles.detailVal}>{v || '-'}</Text>
                </View>
              ))}
            </View>
            {[item.shift1, item.shift2, item.shift3].map((s, i) => renderShift(s, i + 1))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function HistoryScreen() {
  const [forms,      setForms]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected,   setSelected]   = useState(null);
  const [editing,    setEditing]    = useState(null);
  const [search,     setSearch]     = useState('');

  useEffect(() => {
    const q    = query(collection(db, 'form_produksi'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setForms(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
      setRefreshing(false);
    });
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return forms;
    const q = search.toLowerCase();
    return forms.filter(f =>
      (f.namaProduk     || '').toLowerCase().includes(q) ||
      (f.kodeProduk     || '').toLowerCase().includes(q) ||
      (f.noMesin        || '').toLowerCase().includes(q) ||
      (f.tanggal        || '').toLowerCase().includes(q) ||
      (f.bagianProduksi || '').toLowerCase().includes(q)
    );
  }, [forms, search]);

  const handleDelete = (id) => {
    Alert.alert('Hapus Form', 'Yakin ingin menghapus form ini?', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Hapus', style: 'destructive',
        onPress: async () => {
          try {
            await deleteDoc(doc(db, 'form_produksi', id));
          } catch (e) {
            Alert.alert('Error', 'Gagal menghapus: ' + e.message);
          }
        },
      },
    ]);
  };

  // Warna tag bagian
  const bagianColor = (bagian) => {
    switch (bagian) {
      case 'PET':    return { bg: '#E3F2FD', text: '#1565C0' };
      case 'INJECT': return { bg: '#F3E5F5', text: '#7B1FA2' };
      case 'BLOW':   return { bg: '#E8F5E9', text: '#2E7D32' };
      default:       return { bg: '#FFF3E0', text: '#E65100' };
    }
  };

  const renderItem = ({ item }) => {
    const totalRejects = [item.shift1, item.shift2, item.shift3]
      .flatMap(s => s?.rows || [])
      .reduce((sum, r) => {
        const val = String(r.totalReject || 0).trim();
        const num = val.includes(',')
          ? parseFloat(val.replace(/\./g, '').replace(',', '.'))
          : parseFloat(val);
        return sum + (num || 0);
      }, 0);

    const hasOpenIssues = [item.shift1, item.shift2, item.shift3]
      .flatMap(s => s?.rows || [])
      .some(r => r.status === 'open');

    const clr = bagianColor(item.bagianProduksi);

    return (
      <TouchableOpacity style={styles.card} onPress={() => setSelected(item)} activeOpacity={0.85}>
        <View style={styles.cardTop}>
          <View style={styles.cardTopLeft}>
            <View style={[styles.bagianTag, { backgroundColor: clr.bg }]}>
              <Text style={[styles.bagianTagText, { color: clr.text }]}>
                {item.bagianProduksi || '-'}
              </Text>
            </View>
            <Text style={styles.cardProduk} numberOfLines={2}>{item.namaProduk || '-'}</Text>
            <Text style={styles.cardMeta}>{item.tanggal}  ·  {item.noMesin || '-'}</Text>
            {!!item.kodeProduk && (
              <View style={styles.kodeRow}>
                <Ionicons name="barcode-outline" size={11} color="#888"/>
                <Text style={styles.kodeProduk}>{item.kodeProduk}</Text>
              </View>
            )}
          </View>
          <View style={[styles.badge, hasOpenIssues ? styles.badgeOpen : styles.badgeClose]}>
            <Ionicons
              name={hasOpenIssues ? 'alert-circle' : 'checkmark-circle'}
              size={12}
              color={hasOpenIssues ? '#e53935' : '#2e7d32'}
            />
            <Text style={[styles.badgeText, { color: hasOpenIssues ? '#e53935' : '#2e7d32' }]}>
              {hasOpenIssues ? 'OPEN' : 'CLOSE'}
            </Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <View style={styles.stat}>
            <Ionicons name="warning-outline" size={13} color="#e53935"/>
            <Text style={styles.statText}>Reject: {totalRejects.toFixed(2)} KG</Text>
          </View>
          <View style={styles.actionRow}>
            {/* Tombol Edit */}
            <TouchableOpacity
              style={styles.editBtn}
              onPress={() => setEditing(item)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="create-outline" size={15} color="#1565C0"/>
              <Text style={styles.editTxt}>Edit</Text>
            </TouchableOpacity>
            {/* Tombol Hapus */}
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => handleDelete(item.id)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="trash-outline" size={15} color="#e53935"/>
              <Text style={styles.deleteTxt}>Hapus</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1565C0"/>
        <Text style={styles.loadingText}>Memuat data...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Riwayat Form</Text>
          <Text style={styles.headerCount}>{forms.length} form tersimpan</Text>
        </View>
        <View style={styles.headerIcon}>
          <Ionicons name="document-text" size={20} color="#90CAF9"/>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={17} color="#999"/>
        <TextInput
          style={styles.searchInput}
          placeholder="Cari produk, kode, mesin, tanggal..."
          placeholderTextColor="#bbb"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={17} color="#bbb"/>
          </TouchableOpacity>
        )}
      </View>

      {search.length > 0 && (
        <Text style={styles.filterInfo}>
          Menampilkan {filtered.length} dari {forms.length} form
        </Text>
      )}

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => setRefreshing(true)} colors={['#1565C0']}/>
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="document-outline" size={48} color="#ccc"/>
            <Text style={styles.emptyText}>
              {search ? 'Tidak ada hasil' : 'Belum ada form tersimpan'}
            </Text>
          </View>
        }
      />

      <DetailModal item={selected} onClose={() => setSelected(null)}/>

      <EditModal
        item={editing}
        onClose={() => setEditing(null)}
        onSaved={() => setEditing(null)}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#EEF2F8' },
  header: {
    backgroundColor: '#1565C0', padding: 16, paddingTop: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  headerTitle:  { color: '#fff', fontSize: 18, fontWeight: '800' },
  headerCount:  { color: '#90CAF9', fontSize: 12, marginTop: 2 },
  headerIcon:   { backgroundColor: 'rgba(255,255,255,0.15)', padding: 8, borderRadius: 10 },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    margin: 12, marginBottom: 4, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9, elevation: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 3, gap: 8,
  },
  searchInput:  { flex: 1, fontSize: 14, color: '#333', paddingVertical: 0 },
  filterInfo:   { fontSize: 11, color: '#888', marginHorizontal: 16, marginBottom: 4, fontStyle: 'italic' },
  list:         { padding: 12, paddingBottom: 32 },

  card: {
    backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10,
    elevation: 2, shadowColor: '#1565C0',
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 4,
  },
  cardTop:      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  cardTopLeft:  { flex: 1, marginRight: 10 },
  bagianTag: {
    alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: 5, marginBottom: 5,
  },
  bagianTagText:{ fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  cardProduk:   { fontSize: 14, fontWeight: '700', color: '#1a1a1a', lineHeight: 19 },
  cardMeta:     { fontSize: 12, color: '#888', marginTop: 3 },
  kodeRow:      { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  kodeProduk:   { fontSize: 11, color: '#888' },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start',
  },
  badgeOpen:    { backgroundColor: '#FFEBEE' },
  badgeClose:   { backgroundColor: '#E8F5E9' },
  badgeText:    { fontSize: 10, fontWeight: '800' },

  cardFooter: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: '#F0F4F8', paddingTop: 8,
  },
  stat:         { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statText:     { fontSize: 12, color: '#555' },
  actionRow:    { flexDirection: 'row', alignItems: 'center', gap: 12 },
  editBtn:      { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 4 },
  editTxt:      { fontSize: 12, color: '#1565C0', fontWeight: '600' },
  deleteBtn:    { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 4 },
  deleteTxt:    { fontSize: 12, color: '#e53935', fontWeight: '600' },

  center:       { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  loadingText:  { color: '#888', marginTop: 8 },
  emptyText:    { color: '#aaa', marginTop: 8, fontSize: 14 },

  // Detail Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  detailModal: {
    flex: 1, marginTop: 60, backgroundColor: '#fff',
    borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden',
  },
  detailHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#1565C0', padding: 16,
  },
  detailTitle:  { color: '#fff', fontSize: 16, fontWeight: '700' },
  detailClose:  { padding: 4 },
  detailScroll: { flex: 1 },
  detailSection:{ padding: 16 },
  detailSectionTitle: {
    fontSize: 13, fontWeight: '700', color: '#1565C0',
    marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  detailShift: {
    margin: 16, marginTop: 0, padding: 12,
    backgroundColor: '#F8F9FA', borderRadius: 8,
    borderLeftWidth: 3, borderLeftColor: '#1565C0',
  },
  detailShiftTitle: {
    fontSize: 12, fontWeight: '800', color: '#1565C0', marginBottom: 8, letterSpacing: 1,
  },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  detailKey:    { fontSize: 12, color: '#888', flex: 1 },
  detailVal:    { fontSize: 12, color: '#333', fontWeight: '600', flex: 1.5, textAlign: 'right' },
  rowDetail: {
    marginTop: 8, padding: 8, backgroundColor: '#fff',
    borderRadius: 6, borderWidth: 1, borderColor: '#e0e0e0',
  },
  rowNum:       { fontSize: 11, fontWeight: '700', color: '#1565C0', marginBottom: 4 },
  statusOpen:   { color: '#e53935' },
  statusClose:  { color: '#2e7d32' },
});

// ─── Edit Modal Styles ────────────────────────────────────────────────────────
const edit = StyleSheet.create({
  overlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#F0F4FA', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '94%', overflow: 'hidden',
  },
  header: {
    backgroundColor: '#1565C0', flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  headerLabel:  { color: '#90CAF9', fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 2 },
  headerTitle:  { color: '#fff', fontSize: 15, fontWeight: '800' },
  closeBtn:     { padding: 4, marginLeft: 8 },

  // Section
  section: {
    backgroundColor: '#fff', marginHorizontal: 12, marginTop: 12,
    borderRadius: 14, padding: 14,
    elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 3,
  },
  sectionHeader:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionIconWrap:{ backgroundColor: '#EEF4FF', padding: 6, borderRadius: 8 },
  sectionTitle:   { fontSize: 13, fontWeight: '800', color: '#1565C0' },

  // Field
  fieldWrap:      { marginBottom: 10 },
  fieldLabel:     { fontSize: 11, fontWeight: '700', color: '#555', marginBottom: 5 },
  fieldInput: {
    borderWidth: 1.5, borderColor: '#D8E3F0', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, color: '#222',
    backgroundColor: '#FAFCFF',
  },
  fieldInputMulti:{ minHeight: 60, textAlignVertical: 'top' },

  shiftFieldRow:  { flexDirection: 'row' },

  // Shift card
  shiftCard: {
    borderWidth: 1.5, borderColor: '#D8E3F0', borderRadius: 12,
    marginBottom: 10, overflow: 'hidden',
  },
  shiftHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, backgroundColor: '#F8FAFF',
  },
  shiftNumBadge: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#E8EDF5', justifyContent: 'center', alignItems: 'center',
  },
  shiftNumBadgeActive: { backgroundColor: '#1565C0' },
  shiftNumTxt:    { fontSize: 12, fontWeight: '800', color: '#888' },
  shiftTitle:     { flex: 1, fontSize: 13, fontWeight: '700', color: '#888' },
  shiftToggleWrap:{ flexDirection: 'row', alignItems: 'center', gap: 6 },
  shiftToggleLbl: { fontSize: 11, color: '#888' },
  shiftBody:      { padding: 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#EEF0F2' },

  // Rows permasalahan
  rowsSection:    { marginTop: 8 },
  rowsSectionTitle:{ fontSize: 11, fontWeight: '800', color: '#546E7A', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  rowCard: {
    backgroundColor: '#F8FAFC', borderRadius: 10, padding: 12, marginBottom: 8,
    borderLeftWidth: 3, borderLeftColor: '#90CAF9',
  },
  rowCardHeader:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  rowBadge: {
    backgroundColor: '#E3F2FD', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5,
  },
  rowBadgeTxt:    { fontSize: 10, fontWeight: '800', color: '#1565C0' },
  rowTitle:       { flex: 1, fontSize: 12, fontWeight: '700', color: '#333' },
  rowRemoveBtn:   { padding: 4 },

  // Status toggle
  statusRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  statusToggleWrap:{ flexDirection: 'row', gap: 6 },
  statusBtn: {
    paddingHorizontal: 16, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1.5, borderColor: '#D8E3F0', backgroundColor: '#F0F4F8',
  },
  statusBtnOpen:  { backgroundColor: '#FFEBEE', borderColor: '#e53935' },
  statusBtnClose: { backgroundColor: '#E8F5E9', borderColor: '#2e7d32' },
  statusBtnTxt:   { fontSize: 11, fontWeight: '800', color: '#90A4AE' },

  // Add row
  addRowBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    justifyContent: 'center', paddingVertical: 10,
    borderRadius: 8, borderWidth: 1.5, borderColor: '#1565C0',
    borderStyle: 'dashed', backgroundColor: '#EEF4FF', marginTop: 4,
  },
  addRowTxt:      { fontSize: 12, fontWeight: '700', color: '#1565C0' },

  // Footer
  footer: {
    flexDirection: 'row', gap: 10, padding: 14,
    borderTopWidth: 1, borderTopColor: '#E8EDF5', backgroundColor: '#fff',
  },
  cancelBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 10,
    borderWidth: 1.5, borderColor: '#D0DCF0', alignItems: 'center',
  },
  cancelTxt:      { fontSize: 14, fontWeight: '700', color: '#888' },
  saveBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#1565C0', paddingVertical: 13, borderRadius: 10,
    elevation: 3, shadowColor: '#1565C0', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25, shadowRadius: 6,
  },
  saveTxt:        { fontSize: 14, fontWeight: '800', color: '#fff' },
});