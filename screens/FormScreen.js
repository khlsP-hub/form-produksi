// screens/FormScreen.js
import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator, KeyboardAvoidingView,
  Platform, Modal, BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  collection, addDoc, serverTimestamp,
  query, where, getDocs, limit
} from 'firebase/firestore';
import { db } from '../firebase/config';
import AppInput from '../components/AppInput';
import AppDropdown from '../components/AppDropdown';
import SearchableDropdown from '../components/SearchableDropdown';
import DatePickerInput from '../components/DatePickerInput';
import ShiftSection from '../components/ShiftSection';
import { useMasterData } from '../hooks/useMasterData';
import {
  BAGIAN_PRODUKSI,
  NAMA_PRODUK,
  createEmptyShift, formatAngka, unformatAngka,
} from '../data/masterData';
import { Ionicons } from '@expo/vector-icons';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const padZ    = (n)       => String(n).padStart(2, '0');
const fmtDate = (d)       => `${padZ(d.getDate())}/${padZ(d.getMonth()+1)}/${d.getFullYear()}`;
const todayStr = ()       => fmtDate(new Date());

const parseFormDate = (dateStr) => {
  if (!dateStr) return new Date();
  const parts = dateStr.split('/');
  if (parts.length !== 3) return new Date();
  return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
};

const getYesterdayOf = (dateStr) => {
  const d = parseFormDate(dateStr);
  d.setDate(d.getDate() - 1);
  return fmtDate(d);
};

const SHIFT_REFS = {
  1: [{ label: 'Shift 3 (Kemarin)', tanggal: 'yesterday', shift: 'shift3' }],
  2: [{ label: 'Shift 1 (Hari Ini)', tanggal: 'today', shift: 'shift1' }],
  3: [
    { label: 'Shift 1 (Hari Ini)', tanggal: 'today', shift: 'shift1' },
    { label: 'Shift 2 (Hari Ini)', tanggal: 'today', shift: 'shift2' },
  ],
};

const getLabel = (options, value) => {
  if (!options || !value) return value || '-';
  const found = options.find(o => o.value === value || o.kode === value);
  return found ? found.label : value;
};

const initialState = () => ({
  tanggal:         todayStr(),
  bagianProduksi:  '',
  namaProduk:      '',
  namaProdukValue: '',
  kodeProduk:      '',
  noMesin:         '',
  berat:           '',
  beratRaw:        '',
  shift1: createEmptyShift(),
  shift2: createEmptyShift(),
  shift3: createEmptyShift(),
});

// ─── Komponen: Modal Detail Shift ─────────────────────────────────────────────
function ShiftDetailModal({ visible, item, onClose }) {
  // ── FIX 2 & 3: SafeAreaInsets + back handler ──
  const insets = useSafeAreaInsets();

  // Tangkap tombol back hardware Android
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true; // mencegah default (keluar app / navigate back)
    });
    return () => sub.remove();
  }, [visible]);

  if (!item) return null;
  const { doc, ref, shiftData } = item;
  const produkLabel = getLabel(NAMA_PRODUK, doc.namaProduk);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}   // FIX: wajib ada agar back gesture juga tutup modal
      statusBarTranslucent        // FIX: modal menggambar di bawah status bar
    >
      <View style={[modalStyles.overlay, { paddingTop: insets.top }]}>
        <View style={modalStyles.sheet}>

          {/* ── Header dengan paddingTop untuk status bar ── */}
          <View style={modalStyles.header}>
            {/* Tombol back eksplisit — lebih familiar bagi user Android */}
            <TouchableOpacity
              onPress={onClose}
              style={modalStyles.backBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="arrow-back" size={22} color="#fff" />
            </TouchableOpacity>

            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={modalStyles.headerLabel} numberOfLines={1}>
                {ref.label}
              </Text>
              {/* FIX 3: numberOfLines ditambah + adjustsFontSizeToFit agar
                  judul tidak terpotong; layout header sudah reserve space */}
              <Text
                style={modalStyles.headerTitle}
                numberOfLines={3}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {produkLabel}
              </Text>
            </View>
          </View>

          <ScrollView
            style={modalStyles.scroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          >
            {/* Info chip row */}
            <View style={modalStyles.infoRow}>
              {[
                ['Mesin',  doc.noMesin],
                ['Kode',   doc.kodeProduk],
                ['Output', shiftData?.output],
                ['Cavity', shiftData?.cavity],
                ['CT',     shiftData?.cycleTime],
                ['Karu',   shiftData?.karu],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <View key={k} style={modalStyles.infoChip}>
                    <Text style={modalStyles.infoKey}>{k}</Text>
                    <Text style={modalStyles.infoVal}>{v}</Text>
                  </View>
                ))}
            </View>

            {/* Data Permasalahan */}
            {shiftData?.rows?.length > 0 && (
              <View style={modalStyles.section}>
                <Text style={modalStyles.sectionTitle}>Data Permasalahan</Text>
                {shiftData.rows.map((row, i) => {
                  const isOpen = row.status === 'open';
                  if (!row.permasalahan && !row.downtime) return null;
                  return (
                    <View
                      key={i}
                      style={[modalStyles.problemCard, isOpen && modalStyles.problemCardOpen]}
                    >
                      <View style={modalStyles.problemHeader}>
                        <Text style={modalStyles.problemNum}>Permasalahan #{i + 1}</Text>
                        <View style={[modalStyles.statusPill, isOpen ? modalStyles.pillOpen : modalStyles.pillClose]}>
                          <Text style={[modalStyles.statusText, { color: isOpen ? '#c62828' : '#2e7d32' }]}>
                            {row.status?.toUpperCase() || '-'}
                          </Text>
                        </View>
                      </View>
                      {[
                        ['Downtime',    row.downtime ? `${row.downtime} menit` : null],
                        ['Permasalahan',row.permasalahan],
                        ['Total Reject',row.totalReject ? `${row.totalReject} KG` : null],
                        ['Penanganan',  row.penanganan],
                        ['Nama Asisten',row.namaAsisten],
                      ]
                        .filter(([, v]) => v)
                        .map(([k, v]) => (
                          <View key={k} style={modalStyles.detailRow}>
                            <Text style={modalStyles.detailKey}>{k}</Text>
                            <Text style={modalStyles.detailVal}>{v}</Text>
                          </View>
                        ))}
                    </View>
                  );
                })}
              </View>
            )}

            {(!shiftData?.rows || shiftData.rows.every(r => !r.permasalahan && !r.downtime)) && (
              <View style={modalStyles.noIssue}>
                <Ionicons name="checkmark-circle-outline" size={28} color="#a5d6a7" />
                <Text style={modalStyles.noIssueText}>Tidak ada permasalahan tercatat</Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Komponen: Panel referensi shift sebelumnya ───────────────────────────────
function ShiftReferencePanel({ activeShift, tanggal, bagianProduksi, namaProduk }) {
  const [refData,        setRefData]        = useState({});
  const [loading,        setLoading]        = useState(false);
  const [expanded,       setExpanded]       = useState(null);
  const [modalItem,      setModalItem]      = useState(null);

  const refs = SHIFT_REFS[activeShift] || [];

useEffect(() => {
  if (refs.length === 0) return;
  setRefData({});
  fetchRefs();
}, [activeShift, tanggal, bagianProduksi, namaProduk]);

  const fetchRefs = async () => {
  setLoading(true);
  const todayDate     = tanggal || todayStr();
  const yesterdayDate = getYesterdayOf(todayDate);
  const result        = {};

  for (const ref of refs) {
    const tanggalQuery = ref.tanggal === 'today' ? todayDate : yesterdayDate;
    try {
      let q;
      if (bagianProduksi) {
        q = query(
          collection(db, 'form_produksi'),
          where('tanggal',        '==', tanggalQuery),
          where('bagianProduksi', '==', bagianProduksi),
          limit(50)
        );
      } else {
        q = query(
          collection(db, 'form_produksi'),
          where('tanggal', '==', tanggalQuery),
          limit(50)
        );
      }
        const snap = await getDocs(q);
        const docs = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => {
            const ta = a.createdAt?.toMillis?.() ?? 0;
            const tb = b.createdAt?.toMillis?.() ?? 0;
            return tb - ta;
          })
          .slice(0, 10)
          .filter(d => {
          const s = d[ref.shift];
          if (!s || (!s.output && !s.karu && !(s.rows && s.rows.some(r => r.permasalahan)))) return false;
          if (namaProduk && d.namaProduk !== namaProduk) return false;
          return true;
        });
        result[`${ref.shift}_${ref.tanggal}`] = { ref, docs, tanggal: tanggalQuery };
      } catch (e) {
        result[`${ref.shift}_${ref.tanggal}`] = { ref, docs: [], tanggal: tanggalQuery, error: true };
      }
    }
    setRefData(result);
    setLoading(false);
  };

  if (refs.length === 0) return null;

  return (
    <View style={refStyles.wrapper}>
      <TouchableOpacity
        style={refStyles.header}
        onPress={() => setExpanded(expanded ? null : 'open')}
        activeOpacity={0.8}
      >
        <View style={refStyles.headerLeft}>
          <Ionicons name="eye-outline" size={16} color="#E65100" />
          <Text style={refStyles.headerTitle}>Lihat Form Shift Sebelumnya</Text>
        </View>
        <View style={refStyles.headerRight}>
          {loading && <ActivityIndicator size="small" color="#E65100" style={{ marginRight: 6 }} />}
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color="#E65100" />
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={refStyles.body}>
          {refs.map(ref => {
            const key  = `${ref.shift}_${ref.tanggal}`;
            const data = refData[key];
            return (
              <View key={key} style={refStyles.refGroup}>
                <View style={refStyles.refGroupHeader}>
                  <Ionicons name="time-outline" size={13} color="#1565C0" />
                  <Text style={refStyles.refGroupTitle}>{ref.label}</Text>
                  {data && <Text style={refStyles.refCount}>{data.docs?.length ?? 0} form</Text>}
                </View>
                {data && (
                  <Text style={refStyles.refDateInfo}>
                   📅 {data.tanggal}
                    {bagianProduksi ? `  ·  ${bagianProduksi}` : ''}
                    {namaProduk ? `  ·  ${namaProduk}` : ''}
               </Text>
                )}
                {!data && loading && <Text style={refStyles.refEmpty}>Memuat...</Text>}
                {data?.error && <Text style={refStyles.refEmpty}>Gagal memuat data</Text>}
                {data && !data.error && data.docs.length === 0 && (
                  <Text style={refStyles.refEmpty}>Belum ada form untuk {ref.label.toLowerCase()}</Text>
                )}
                {data?.docs.map(doc => {
                  const shiftData   = doc[ref.shift];
                  const hasIssue    = shiftData?.rows?.some(r => r.permasalahan);
                  const hasOpen     = shiftData?.rows?.some(r => r.status === 'open');
                  const produkLabel = getLabel(NAMA_PRODUK, doc.namaProduk);
                  return (
                    <TouchableOpacity
                      key={doc.id}
                      style={refStyles.refCard}
                      onPress={() => setModalItem({ doc, ref, shiftData })}
                      activeOpacity={0.75}
                    >
                      <View style={refStyles.refCardTop}>
                        <View style={{ flex: 1 }}>
                          <Text style={refStyles.refProduk} numberOfLines={1}>{produkLabel}</Text>
                          <Text style={refStyles.refMeta}>{doc.noMesin || '-'}  ·  Karu: {shiftData?.karu || '-'}</Text>
                        </View>
                        <View style={[refStyles.badge, hasOpen ? refStyles.badgeOpen : refStyles.badgeClose]}>
                          <Text style={[refStyles.badgeText, { color: hasOpen ? '#c62828' : '#2e7d32' }]}>
                            {hasOpen ? 'OPEN' : 'CLOSE'}
                          </Text>
                        </View>
                      </View>
                      <View style={refStyles.refCardBottom}>
                        <Text style={refStyles.refOutput}>Output: {shiftData?.output || '-'}</Text>
                        {hasIssue && (
                          <View style={refStyles.issueTag}>
                            <Ionicons name="warning-outline" size={11} color="#E65100" />
                            <Text style={refStyles.issueTagText}>Ada permasalahan</Text>
                          </View>
                        )}
                        <Ionicons name="chevron-forward" size={14} color="#bbb" />
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            );
          })}
          <TouchableOpacity onPress={fetchRefs} style={refStyles.refreshBtn}>
            <Ionicons name="refresh-outline" size={14} color="#1565C0" />
            <Text style={refStyles.refreshText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      )}

      <ShiftDetailModal
        visible={!!modalItem}
        item={modalItem}
        onClose={() => setModalItem(null)}
      />
    </View>
  );
}

// ─── Main FormScreen ──────────────────────────────────────────────────────────
export default function FormScreen() {
  // ── FIX 1: gunakan insets untuk status bar ──
  const insets = useSafeAreaInsets();

  const [form,        setForm]        = useState(initialState());
  const [loading,     setLoading]     = useState(false);
  const [errors,      setErrors]      = useState({});
  const [activeShift, setActiveShift] = useState(1);

  const { produkList, mesinList, karuList, asistenList, loading: masterLoading, error: masterError } =
    useMasterData(form.bagianProduksi || null);

  const getProdukOptions = () => produkList;
  const getMesinOptions  = () => mesinList;

  const clearError = (field) => {
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: null }));
  };

  const handleBagianChange = (value) => {
    setForm(prev => ({
      ...prev,
      bagianProduksi:  value,
      namaProduk:      '',
      namaProdukValue: '',
      kodeProduk:      '',
      noMesin:         '',
    }));
    setErrors(prev => ({ ...prev, bagianProduksi: null, namaProduk: null, noMesin: null }));
  };

  const handleProdukChange = (value) => {
    const list   = getProdukOptions();
    const produk = list.find(p => p.value === value);
    setForm(prev => ({
      ...prev,
      namaProduk:      produk?.label || value,
      namaProdukValue: value,
      kodeProduk:      produk?.kode  || '',
    }));
    clearError('namaProduk');
  };

  const handleBeratChange = (text) => {
    const formatted = formatAngka(text);
    setForm(prev => ({ ...prev, berat: formatted, beratRaw: unformatAngka(formatted) }));
  };

  const validate = () => {
    const e = {};
    if (!form.bagianProduksi) e.bagianProduksi = 'Wajib diisi';
    if (!form.namaProduk)     e.namaProduk     = 'Wajib diisi';
    if (!form.noMesin)        e.noMesin        = 'Wajib diisi';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) {
      Alert.alert('Validasi', 'Harap lengkapi field yang wajib diisi (*)', [{ text: 'OK' }]);
      return;
    }
    Alert.alert('Konfirmasi Submit', 'Yakin ingin menyimpan form ini?', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Ya, Simpan',
        onPress: async () => {
          setLoading(true);
          try {
            await addDoc(collection(db, 'form_produksi'), {
              tanggal:        form.tanggal,
              bagianProduksi: form.bagianProduksi,
              namaProduk:     form.namaProduk,
              kodeProduk:     form.kodeProduk,
              noMesin:        form.noMesin,
              berat:          form.beratRaw || form.berat,
              shift1:         form.shift1,
              shift2:         form.shift2,
              shift3:         form.shift3,
              createdAt:      serverTimestamp(),
            });
            Alert.alert('Berhasil ✅', 'Form berhasil disimpan!', [
              { text: 'OK', onPress: () => { setForm(initialState()); setActiveShift(1); } },
            ]);
          } catch (e) {
            Alert.alert('Error ❌', 'Gagal menyimpan: ' + e.message);
          } finally {
            setLoading(false);
          }
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        style={styles.container}
        showsVerticalScrollIndicator={false}
        // FIX 1: pastikan konten tidak tertutup tab bar bawah
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
      >

        {/* ── FIX 1: Header dengan paddingTop menyesuaikan status bar ── */}
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <View style={styles.headerBadge}>
            <Ionicons name="clipboard" size={14} color="#90CAF9" />
            <Text style={styles.headerBadgeText}>FORM PRODUKSI</Text>
          </View>
          <Text style={styles.headerTitle}>FORM PERMASALAHAN PRODUKSI</Text>
        </View>

        <View style={styles.content}>

          {/* Card Data Produksi */}
          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <View style={styles.cardTitleIcon}>
                <Ionicons name="cube-outline" size={15} color="#1565C0" />
              </View>
              <Text style={styles.cardTitle}>Data Produksi</Text>
            </View>

            <DatePickerInput
              label="Tanggal *"
              value={form.tanggal}
              onChange={(val) => setForm(p => ({ ...p, tanggal: val }))}
            />

            <AppDropdown
              label="Bagian Produksi *"
              options={BAGIAN_PRODUKSI}
              value={form.bagianProduksi}
              onChange={handleBagianChange}
              error={errors.bagianProduksi}
            />

            {masterLoading && form.bagianProduksi && (
              <View style={styles.masterLoadingRow}>
                <ActivityIndicator size="small" color="#1565C0" />
                <Text style={styles.masterLoadingText}>Memuat data produk...</Text>
              </View>
            )}
            {masterError && (
              <Text style={styles.masterError}>
                Gagal memuat data: {masterError}
              </Text>
            )}

            <SearchableDropdown
              label="Nama Produk *"
              options={getProdukOptions()}
              value={form.namaProdukValue}
              onChange={handleProdukChange}
              error={errors.namaProduk}
              placeholder={
                !form.bagianProduksi ? 'Pilih bagian produksi dulu...'
                : masterLoading      ? 'Memuat data...'
                :                      'Cari nama produk atau kode...'
              }
            />

            {!!form.kodeProduk && (
              <View style={styles.kodeBox}>
                <Ionicons name="barcode-outline" size={16} color="#1565C0" />
                <Text style={styles.kodeLabel}>Kode Barang:</Text>
                <Text style={styles.kodeValue}>{form.kodeProduk}</Text>
              </View>
            )}

            <SearchableDropdown
              label="No. Mesin *"
              options={getMesinOptions()}
              value={form.noMesin}
              onChange={(v) => { setForm(p => ({ ...p, noMesin: v })); clearError('noMesin'); }}
              error={errors.noMesin}
              placeholder={
                !form.bagianProduksi ? 'Pilih bagian produksi dulu...'
                : masterLoading      ? 'Memuat data...'
                :                      'Cari no. mesin...'
              }
            />

            {!form.bagianProduksi && (
              <Text style={styles.hint}>
                Pilih bagian produksi dulu untuk melihat daftar produk dan mesin
              </Text>
            )}

            <AppInput
              label="Berat (gram)"
              value={form.berat}
              onChangeText={handleBeratChange}
              placeholder="Contoh: 1.500"
              keyboardType="numeric"
            />
          </View>

          <ShiftReferencePanel
          activeShift={activeShift}
          tanggal={form.tanggal}
          bagianProduksi={form.bagianProduksi}
          namaProduk={form.namaProduk}
        />

          {/* Shift Tabs */}
          <View style={styles.tabContainer}>
            {[1, 2, 3].map(s => (
              <TouchableOpacity
                key={s}
                style={[styles.tab, activeShift === s && styles.activeTab]}
                onPress={() => setActiveShift(s)}
              >
                <Ionicons name="time-outline" size={14} color={activeShift === s ? '#fff' : '#999'} />
                <Text style={[styles.tabText, activeShift === s && styles.activeTabText]}>Shift {s}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {activeShift === 1 && (
            <ShiftSection
              shiftNumber={1} data={form.shift1}
              onChange={v => setForm(p => ({ ...p, shift1: v }))}
              karuList={karuList} asistenList={asistenList}
            />
          )}
          {activeShift === 2 && (
            <ShiftSection
              shiftNumber={2} data={form.shift2}
              onChange={v => setForm(p => ({ ...p, shift2: v }))}
              karuList={karuList} asistenList={asistenList}
            />
          )}
          {activeShift === 3 && (
            <ShiftSection
              shiftNumber={3} data={form.shift3}
              onChange={v => setForm(p => ({ ...p, shift3: v }))}
              karuList={karuList} asistenList={asistenList}
            />
          )}

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitBtn, loading && styles.submitDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
                <Text style={styles.submitText}>SIMPAN FORM</Text>
              </>
            )}
          </TouchableOpacity>

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#EEF2F8' },

  // FIX 1: paddingTop di-set secara dinamis via insets di JSX (lihat atas)
  header: {
    backgroundColor: '#1565C0',
    paddingHorizontal: 20,
    paddingBottom: 24,
    alignItems: 'center',
  },
  headerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, marginBottom: 8,
  },
  headerBadgeText: { color: '#90CAF9', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  headerTitle:     { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: 0.5 },

  content:     { padding: 16 },
  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 16,
    elevation: 3, shadowColor: '#1565C0',
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6,
  },
  cardTitleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 14, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: '#EEF2FF',
  },
  cardTitleIcon: { backgroundColor: '#EEF2FF', padding: 6, borderRadius: 8 },
  cardTitle:     { fontSize: 14, fontWeight: '700', color: '#1565C0' },
  kodeBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#E3F2FD', padding: 10, borderRadius: 8,
    marginBottom: 12, borderLeftWidth: 3, borderLeftColor: '#1565C0',
  },
  kodeLabel:        { fontSize: 12, color: '#1565C0', fontWeight: '600' },
  kodeValue:        { fontSize: 14, color: '#0D47A1', fontWeight: '800' },
  hint:             { fontSize: 11, color: '#888', marginTop: -6, marginBottom: 10, fontStyle: 'italic' },
  masterLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  masterLoadingText:{ fontSize: 12, color: '#1565C0' },
  masterError:      { fontSize: 12, color: '#e53935', marginBottom: 8 },
  tabContainer: {
    flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12,
    padding: 4, marginBottom: 12, elevation: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08, shadowRadius: 3,
  },
  tab: {
    flex: 1, paddingVertical: 10, alignItems: 'center',
    borderRadius: 9, flexDirection: 'row', justifyContent: 'center', gap: 5,
  },
  activeTab:     { backgroundColor: '#1565C0' },
  tabText:       { fontSize: 13, fontWeight: '600', color: '#999' },
  activeTabText: { color: '#fff' },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#1565C0', padding: 16,
    borderRadius: 14, marginBottom: 32, elevation: 4,
    shadowColor: '#1565C0', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8,
  },
  submitDisabled: { backgroundColor: '#aaa' },
  submitText:     { color: '#fff', fontSize: 16, fontWeight: '800', letterSpacing: 1 },
});

const refStyles = StyleSheet.create({
  wrapper: {
    backgroundColor: '#fff', borderRadius: 14, marginBottom: 12,
    elevation: 2, shadowColor: '#E65100',
    shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 4,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 13,
    backgroundColor: '#FFF3E0', borderLeftWidth: 4, borderLeftColor: '#E65100',
  },
  headerLeft:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 13, fontWeight: '700', color: '#E65100' },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  body:        { paddingHorizontal: 14, paddingBottom: 12 },
  refGroup:       { marginTop: 12 },
  refGroupHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  refGroupTitle:  { fontSize: 12, fontWeight: '700', color: '#1565C0', flex: 1 },
  refCount: {
    fontSize: 11, color: '#888', backgroundColor: '#EEF2F8',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10,
  },
  refDateInfo: { fontSize: 11, color: '#888', fontStyle: 'italic', marginBottom: 6, paddingLeft: 2 },
  refEmpty:    { fontSize: 12, color: '#aaa', fontStyle: 'italic', paddingVertical: 6 },
  refCard: {
    backgroundColor: '#F8FAFC', borderRadius: 10, padding: 10, marginBottom: 7,
    borderLeftWidth: 3, borderLeftColor: '#90CAF9',
  },
  refCardTop:    { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  refProduk:     { fontSize: 13, fontWeight: '700', color: '#222' },
  refMeta:       { fontSize: 11, color: '#888', marginTop: 2 },
  badge:         { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, marginLeft: 8 },
  badgeOpen:     { backgroundColor: '#FFEBEE' },
  badgeClose:    { backgroundColor: '#E8F5E9' },
  badgeText:     { fontSize: 10, fontWeight: '800' },
  refCardBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  refOutput:     { fontSize: 11, color: '#555', flex: 1 },
  issueTag: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#FFF3E0', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6,
  },
  issueTagText: { fontSize: 10, color: '#E65100', fontWeight: '600' },
  refreshBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    justifyContent: 'center', marginTop: 10, paddingVertical: 7,
    borderRadius: 8, borderWidth: 1, borderColor: '#D0DCF0',
  },
  refreshText: { fontSize: 12, color: '#1565C0', fontWeight: '600' },
});

const modalStyles = StyleSheet.create({
  // FIX 2 & 3: overlay menghitung insets.top di JSX
  overlay: { flex: 1, backgroundColor: '#fff' },
  sheet:   { flex: 1, backgroundColor: '#fff' },

  header: {
    backgroundColor: '#1565C0',
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  backBtn:     { padding: 4, marginTop: 2 },
  headerLabel: { color: '#90CAF9', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  // FIX 3: flex:1 + flexShrink memastikan judul tidak overflow ke luar
  headerTitle: { color: '#fff', fontSize: 15, fontWeight: '800', flex: 1, flexShrink: 1 },

  scroll: { flex: 1 },
  infoRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    padding: 14, borderBottomWidth: 1, borderBottomColor: '#EEF0F2',
  },
  infoChip: {
    backgroundColor: '#EEF2FF', paddingHorizontal: 10,
    paddingVertical: 5, borderRadius: 8, alignItems: 'center',
  },
  infoKey: { fontSize: 10, color: '#888', fontWeight: '600' },
  infoVal: { fontSize: 12, color: '#1565C0', fontWeight: '800', marginTop: 1 },

  section:      { padding: 14 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#444', marginBottom: 8, letterSpacing: 0.3 },
  problemCard: {
    backgroundColor: '#F8FAFC', borderRadius: 10, padding: 12,
    marginBottom: 8, borderLeftWidth: 3, borderLeftColor: '#42A5F5',
  },
  problemCardOpen: { borderLeftColor: '#e53935', backgroundColor: '#FFF5F5' },
  problemHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 8,
  },
  problemNum:  { fontSize: 12, fontWeight: '700', color: '#1565C0' },
  statusPill:  { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  pillOpen:    { backgroundColor: '#FFEBEE' },
  pillClose:   { backgroundColor: '#E8F5E9' },
  statusText:  { fontSize: 10, fontWeight: '800' },
  detailRow: {
    flexDirection: 'row', paddingVertical: 4,
    borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  detailKey: { fontSize: 12, color: '#888', width: 100 },
  detailVal: { fontSize: 12, color: '#222', fontWeight: '600', flex: 1 },
  noIssue:     { alignItems: 'center', paddingVertical: 30, gap: 8 },
  noIssueText: { color: '#aaa', fontSize: 13 },
});