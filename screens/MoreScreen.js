// screens/MoreScreen.js
import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, ScrollView, Modal,
  TextInput, Animated, StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase/config';
import { Ionicons } from '@expo/vector-icons';
import { useMasterData } from '../hooks/useMasterData';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';
import DatePickerInput from '../components/DatePickerInput';
import { BAGIAN_PRODUKSI } from '../data/masterData';
import SearchableDropdown from '../components/SearchableDropdown';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const parseNum = (s) => {
  if (!s && s !== 0) return 0;
  const str = String(s).trim();
  if (!str) return 0;
  if (str.includes(',')) return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
  return parseFloat(str) || 0;
};
const pad      = (n) => String(n).padStart(2, '0');
const fmtDate  = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
const todayStr = ()  => fmtDate(new Date());
const parseDate = (str) => {
  if (!str) return null;
  const p = str.split('/');
  if (p.length !== 3) return null;
  return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
};

// ─── Flatten dokumen ke baris Excel ───────────────────────────────────────────
function flattenDoc(doc, startNo, filterShift) {
  const rows = [];
  let no = startNo;
  const baseInfo = {
    tanggal:        doc.tanggal        || '',
    bagianProduksi: doc.bagianProduksi || '',
    namaProduk:     doc.namaProduk     || doc.kodeProduk || '',
    kodeProduk:     doc.kodeProduk     || '',
    noMesin:        doc.noMesin        || '',
    berat:          doc.berat          || '',
  };
  const shiftsToProcess = filterShift
    ? [parseInt(filterShift)].filter(n => [1, 2, 3].includes(n))
    : [1, 2, 3];

  for (const shiftNum of shiftsToProcess) {
    const shift = doc[`shift${shiftNum}`];
    if (!shift) continue;
    const shiftBase = {
      ...baseInfo,
      shift:     `Shift ${shiftNum}`,
      output:    shift.output    || '',
      cavity:    shift.cavity    || '',
      cycleTime: shift.cycleTime || '',
      namaKaru:  shift.karu      || '',
    };
    const problemRows = (shift.rows || []).filter(r =>
      r.permasalahan || r.downtime || parseNum(r.totalReject) > 0
    );
    if (problemRows.length === 0) {
      rows.push({
        no: no++, ...shiftBase,
        downtime: '', permasalahan: 'Tidak ada permasalahan',
        totalReject: '', penanganan: '', namaAsisten: '', status: 'CLOSE',
      });
    } else {
      for (const r of problemRows) {
        rows.push({
          no: no++, ...shiftBase,
          downtime:     r.downtime     || '',
          permasalahan: r.permasalahan || '',
          totalReject:  r.totalReject  || '',
          penanganan:   r.penanganan   || '',
          namaAsisten:  r.namaAsisten  || '',
          status:       (r.status || 'open').toUpperCase(),
        });
      }
    }
  }
  return { rows, nextNo: no };
}

// ─── Sheet Ringkasan ──────────────────────────────────────────────────────────
function buildSummarySheet(docs, filterOpts) {
  // Hitung per bagian dengan rincian lengkap
  const byBagian = {};
  let totalRejectAll = 0, totalFormAll = 0, totalOpenAll = 0, totalCloseAll = 0;

  for (const doc of docs) {
    const bag = doc.bagianProduksi || 'LAINNYA';
    if (!byBagian[bag]) {
      byBagian[bag] = {
        forms: 0, reject: 0, open: 0, close: 0,
        formFull: 0,      // form yang punya minimal 1 permasalahan tercatat
        formNoPermas: 0,  // shift ada tapi tidak ada permasalahan sama sekali
        formPartial: 0,   // ada downtime/reject tapi permasalahan kosong
      };
    }
    const d = byBagian[bag];
    d.forms++;
    totalFormAll++;

    let hasFull = false, hasPartial = false, hasNoPermas = false;

    for (const sn of [1, 2, 3]) {
      const shift = doc[`shift${sn}`];
      if (!shift) continue;

      const validRows = (shift.rows || []).filter(r =>
        (r.permasalahan || '').trim() || (r.downtime || '').trim() || parseNum(r.totalReject) > 0
      );

      if (validRows.length === 0) {
        hasNoPermas = true;
      } else {
        for (const r of validRows) {
          const rj = parseNum(r.totalReject);
          d.reject += rj;
          totalRejectAll += rj;
          if ((r.status || 'open').toLowerCase() === 'open') {
            d.open++; totalOpenAll++;
          } else {
            d.close++; totalCloseAll++;
          }
          if ((r.permasalahan || '').trim()) hasFull = true;
          else hasPartial = true;
        }
      }
    }

    if (hasFull)    d.formFull++;
    if (hasPartial && !hasFull) d.formPartial++;
    if (hasNoPermas && !hasFull && !hasPartial) d.formNoPermas++;
  }

  const filterDesc = [
    filterOpts.bagian     ? `Bagian: ${filterOpts.bagian}` : null,
    filterOpts.shift      ? `Shift: ${filterOpts.shift}`   : null,
    filterOpts.dateFrom   ? `Tanggal: ${filterOpts.dateFrom} s/d ${filterOpts.dateTo || filterOpts.dateFrom}` : null,
    filterOpts.namaProduk ? `Produk: ${filterOpts.namaProduk}` : null,
  ].filter(Boolean).join(' | ') || 'Semua Data';

  const now = new Date();
  const tgl = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const rows = [
    ['RINGKASAN LAPORAN PERMASALAHAN PRODUKSI'],
    [`Filter: ${filterDesc}`],
    [`Diekspor: ${tgl}`],
    [''],
    // Header tabel utama
    [
      'BAGIAN', 'TOTAL FORM', 'TOTAL REJECT (KG)',
      'Form Penuh*', 'Tidak Ada Permas.**', 'Partial***',
      'Baris OPEN', 'Baris CLOSE',
    ],
  ];

  for (const [bag, data] of Object.entries(byBagian)) {
    rows.push([
      bag,
      data.forms,
      `${data.reject.toFixed(2)} KG`,
      data.formFull,
      data.formNoPermas,
      data.formPartial,
      data.open,
      data.close,
    ]);
  }

  rows.push(['']);
  rows.push([
    'TOTAL',
    totalFormAll,
    `${totalRejectAll.toFixed(2)} KG`,
    '', '', '',
    totalOpenAll,
    totalCloseAll,
  ]);

  rows.push(['']);
  rows.push(['Keterangan:']);
  rows.push(['*  Form Penuh      : form yang memiliki minimal 1 permasalahan tercatat lengkap']);
  rows.push(['** Tidak Ada Permas: shift diisi (output/karu ada) tetapi tidak ada permasalahan dicatat']);
  rows.push(['***Partial          : ada downtime atau reject tercatat tetapi kolom permasalahan kosong']);

  return rows;
}

// ─── Build Excel ──────────────────────────────────────────────────────────────
async function buildExcel(docs, filterOpts, onProgress) {
  const wb = XLSX.utils.book_new();

  const HEADERS = [
    'NO', 'TANGGAL', 'BAGIAN\nPRODUKSI', 'NAMA PRODUK','KODE PRODUK', 'NO MESIN',
    'BERAT\n(gr)', 'SHIFT', 'OUTPUT\n(pcs)', 'CAVITY', 'CYCLE\nTIME',
    'NAMA KARU', 'DOWN TIME', 'PERMASALAHAN', 'TOTAL REJECT\n(KG)',
    'PENANGANAN', 'NAMA ASISTEN', 'STATUS',
  ];

  const sheetData = [HEADERS];
  let no = 1, processed = 0;

  const sorted = [...docs].sort((a, b) => {
    const pd = (s) => {
      if (!s) return 0;
      const [d, m, y] = s.split('/').map(Number);
      return new Date(y, m - 1, d).getTime();
    };
    const diff = pd(b.tanggal) - pd(a.tanggal);
    return diff !== 0 ? diff : (a.noMesin || '').localeCompare(b.noMesin || '');
  });

  const total = sorted.length;

  for (const doc of sorted) {
    const { rows, nextNo } = flattenDoc(doc, no, filterOpts.shift);
    no = nextNo;
    for (const r of rows) {
      sheetData.push([
        r.no, r.tanggal, r.bagianProduksi, r.namaProduk, r.kodeProduk, r.noMesin,
        r.berat      ? String(r.berat)      : '',
        r.shift,
        r.output     ? String(r.output)     : '',
        r.cavity     ? String(r.cavity)     : '',
        r.cycleTime  ? String(r.cycleTime)  : '',
        r.namaKaru, r.downtime, r.permasalahan,
        r.totalReject ? String(r.totalReject) : '',
        r.penanganan, r.namaAsisten, r.status,
      ]);
    }
    processed++;
    onProgress?.(Math.round((processed / total) * 80));
  }

  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  ws['!cols'] = [
    {wch:5},{wch:12},{wch:10},{wch:36},{wch:20},{wch:10},
    {wch:7},{wch:8},{wch:9},{wch:8},{wch:10},
    {wch:14},{wch:16},{wch:32},{wch:13},
    {wch:28},{wch:14},{wch:9},
  ];
  ws['!freeze']     = { xSplit: 0, ySplit: 1 };
  ws['!autofilter'] = { ref: `A1:R${sheetData.length}` };
  ws['!rows']       = [{ hpt: 36 }];

  onProgress?.(85);
  XLSX.utils.book_append_sheet(wb, ws, 'Laporan');

  // Sheet Ringkasan
  const summaryData = buildSummarySheet(docs, filterOpts);
  const wsSummary   = XLSX.utils.aoa_to_sheet(summaryData);
  wsSummary['!cols'] = [
    {wch:22},{wch:12},{wch:18},{wch:12},{wch:18},{wch:10},{wch:12},{wch:12},
  ];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan');

  onProgress?.(92);

  const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });

  const now        = new Date();
  const stamp      = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  const bagSuffix  = filterOpts.bagian   ? `_${filterOpts.bagian}`   : '';
  const shiftSuffix= filterOpts.shift    ? `_S${filterOpts.shift}`   : '';
  const dateSuffix = filterOpts.dateFrom
    ? `_${filterOpts.dateFrom.replace(/\//g,'')}-${(filterOpts.dateTo||filterOpts.dateFrom).replace(/\//g,'')}`
    : '';

  const fileName = `Laporan_Permasalahan_${stamp}${bagSuffix}${shiftSuffix}${dateSuffix}.xlsx`;
  const filePath = `${FileSystem.cacheDirectory}${fileName}`;

  await FileSystem.writeAsStringAsync(filePath, b64, { encoding: 'base64' });

  onProgress?.(100);
  return { filePath, fileName, rowCount: sheetData.length - 1 };
}

// ─── Filter dokumen ───────────────────────────────────────────────────────────
function applyFilters(docs, opts) {
  let result = docs;
  if (opts.bagian) result = result.filter(d => d.bagianProduksi === opts.bagian);
  if (opts.namaProduk?.trim()) {
    const q = opts.namaProduk.trim().toLowerCase();
    result = result.filter(d =>
      (d.namaProduk || '').toLowerCase().includes(q) ||
      (d.kodeProduk || '').toLowerCase().includes(q)
    );
  }
  if (opts.dateFrom || opts.dateTo) {
    const from = opts.dateFrom ? parseDate(opts.dateFrom) : null;
    const to   = opts.dateTo   ? parseDate(opts.dateTo)   : null;
    if (to) to.setHours(23, 59, 59, 999);
    result = result.filter(d => {
      const dt = parseDate(d.tanggal);
      if (!dt) return false;
      if (from && dt < from) return false;
      if (to   && dt > to)   return false;
      return true;
    });
  }
  if (opts.shift) result = result.filter(d => !!d[`shift${opts.shift}`]);
  return result;
}

// ─── Admin Panel ──────────────────────────────────────────────────────────────
function AdminPanel({ features, onToggle, onClose }) {
  const FEATURE_LIST = [
    {
      key:   'exportExcel',
      icon:  'document-text-outline',
      label: 'Export ke Excel',
      desc:  'Tombol export laporan .xlsx di menu utama',
      color: '#2E7D32',
      bg:    '#E8F5E9',
    },
    {
      key:   'exportFilter',
      icon:  'filter-outline',
      label: 'Export dengan Filter',
      desc:  'Tombol filter sebelum export',
      color: '#1565C0',
      bg:    '#E3F2FD',
    },
    {
      key:   'backup',
      icon:  'cloud-download-outline',
      label: 'Backup Data',
      desc:  'Tombol backup JSON',
      color: '#6A1B9A',
      bg:    '#F3E5F5',
    },
  ];

  return (
    <View style={adm.panel}>
      <View style={adm.header}>
        <View style={adm.headerLeft}>
          <View style={adm.lockIcon}>
            <Ionicons name="lock-closed" size={14} color="#fff"/>
          </View>
          <View>
            <Text style={adm.headerTitle}>Mode Admin</Text>
            <Text style={adm.headerSub}>Toggle fitur ON / OFF</Text>
          </View>
        </View>
        <TouchableOpacity onPress={onClose} style={adm.closeBtn} hitSlop={{top:8,bottom:8,left:8,right:8}}>
          <Ionicons name="close-circle" size={22} color="rgba(255,255,255,0.8)"/>
        </TouchableOpacity>
      </View>

      <View style={adm.body}>
        {FEATURE_LIST.map((feat, i) => {
          const isOn = features[feat.key] !== false;
          return (
            <View key={feat.key}>
              {i > 0 && <View style={adm.divider}/>}
              <View style={adm.row}>
                <View style={[adm.featIcon, {backgroundColor: feat.bg}]}>
                  <Ionicons name={feat.icon} size={18} color={feat.color}/>
                </View>
                <View style={adm.featText}>
                  <Text style={adm.featLabel}>{feat.label}</Text>
                  <Text style={adm.featDesc}>{feat.desc}</Text>
                </View>
                <TouchableOpacity
                  style={[adm.toggle, isOn ? adm.toggleOn : adm.toggleOff]}
                  onPress={() => onToggle(feat.key, !isOn)}
                  activeOpacity={0.8}
                >
                  <View style={[adm.toggleThumb, isOn ? adm.thumbRight : adm.thumbLeft]}/>
                  <Text style={[adm.toggleLabel, {color: isOn ? '#fff' : '#bbb'}]}>
                    {isOn ? 'ON' : 'OFF'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </View>

      <View style={adm.footer}>
        <Ionicons name="information-circle-outline" size={13} color="#90A4AE"/>
        <Text style={adm.footerTxt}>
          Panel ini hanya muncul setelah klik header 3×. Perubahan langsung berlaku.
        </Text>
      </View>
    </View>
  );
}

// ─── FilterExportModal ────────────────────────────────────────────────────────
function FilterExportModal({ visible, onClose, onApply }) {
  const insets = useSafeAreaInsets();
  const [bagian,     setBagian]     = useState('');
  const [shift,      setShift]      = useState('');
  const [dateFrom,   setDateFrom]   = useState('');
  const [dateTo,     setDateTo]     = useState('');
  const [namaProduk, setNamaProduk] = useState('');

  // ── Fetch produk sesuai bagian yang dipilih ──
  const { produkList, loading: produkLoading } = useMasterData(bagian || null);

  const handleBagianChange = (val) => {
    setBagian(val);
    setNamaProduk(''); // reset produk saat bagian berubah
  };

  const handleReset = () => { setBagian(''); setShift(''); setDateFrom(''); setDateTo(''); setNamaProduk(''); };
  const handleApply = () => { onApply({ bagian, shift, dateFrom, dateTo, namaProduk }); onClose(); };

  const SHIFTS     = [{value:'',label:'Semua Shift'},{value:'1',label:'Shift 1'},{value:'2',label:'Shift 2'},{value:'3',label:'Shift 3'}];
  const BAGIAN_ALL = [{value:'',label:'Semua Bagian'}, ...BAGIAN_PRODUKSI];

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={fm.overlay}>
        <TouchableOpacity style={fm.backdrop} activeOpacity={1} onPress={onClose}/>
        <View style={fm.sheet}>
          <View style={fm.header}>
            <View style={fm.headerLeft}>
              <View style={fm.headerIcon}><Ionicons name="options" size={16} color="#fff"/></View>
              <View>
                <Text style={fm.headerTitle}>Filter Export</Text>
                <Text style={fm.headerSub}>Kosongkan untuk ekspor semua data</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={fm.closeBtn}>
              <Ionicons name="close" size={20} color="#fff"/>
            </TouchableOpacity>
          </View>

          <ScrollView style={fm.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={fm.sectionLabel}>Bagian Produksi</Text>
            <View style={fm.chipsRow}>
              {BAGIAN_ALL.map((b, i) => (
                <TouchableOpacity key={`${b.value||'all'}-${i}`}
                  style={[fm.chip, bagian===b.value && fm.chipActive]}
                  onPress={() => handleBagianChange(b.value)}>
                  <Text style={[fm.chipTxt, bagian===b.value && fm.chipTxtActive]}>{b.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={fm.sectionLabel}>Shift</Text>
            <View style={fm.chipsRow}>
              {SHIFTS.map((sh, i) => (
                <TouchableOpacity key={`${sh.value||'all'}-${i}`}
                  style={[fm.chip, shift===sh.value && fm.chipActive]}
                  onPress={() => setShift(sh.value)}>
                  <Text style={[fm.chipTxt, shift===sh.value && fm.chipTxtActive]}>{sh.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ── Nama Produk — dinamis sesuai bagian ── */}
            {/* ── Nama Produk — dinamis sesuai bagian ── */}
<Text style={fm.sectionLabel}>Nama / Kode Produk</Text>
{produkLoading && bagian && (
  <View style={fm.loadingRow}>
    <ActivityIndicator size="small" color="#1565C0"/>
    <Text style={fm.loadingTxt}>Memuat data produk...</Text>
  </View>
)}
<SearchableDropdown
  options={produkLoading ? [] : [{value:'', label:'Semua Produk'}, ...produkList]}
  value={namaProduk}
  onChange={(val) => setNamaProduk(val)}
  placeholder={
    !bagian         ? 'Pilih bagian produksi dulu...'
    : produkLoading ? 'Memuat produk...'
    :                 'Cari nama produk atau kode...'
  }
/>

            <Text style={fm.sectionLabel}>Rentang Tanggal</Text>
            <View style={fm.dateRow}>
              <View style={{flex:1}}><DatePickerInput label="Dari" value={dateFrom} onChange={setDateFrom}/></View>
              <View style={fm.dateSep}><Ionicons name="arrow-forward" size={13} color="#bbb"/></View>
              <View style={{flex:1}}><DatePickerInput label="Sampai" value={dateTo} onChange={setDateTo}/></View>
            </View>
            <View style={fm.quickRow}>
              {[
                {label:'Hari Ini',  fn:()=>{ const t=todayStr(); setDateFrom(t); setDateTo(t); }},
                {label:'7 Hari',    fn:()=>{ const to=new Date(),fr=new Date(); fr.setDate(to.getDate()-6); setDateFrom(fmtDate(fr)); setDateTo(fmtDate(to)); }},
                {label:'30 Hari',   fn:()=>{ const to=new Date(),fr=new Date(); fr.setDate(to.getDate()-29); setDateFrom(fmtDate(fr)); setDateTo(fmtDate(to)); }},
                {label:'Bulan Ini', fn:()=>{ const now=new Date(),fr=new Date(now.getFullYear(),now.getMonth(),1); setDateFrom(fmtDate(fr)); setDateTo(fmtDate(now)); }},
              ].map(q => (
                <TouchableOpacity key={q.label} style={fm.quickBtn} onPress={q.fn}>
                  <Text style={fm.quickBtnTxt}>{q.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{height:8}}/>
          </ScrollView>

          <View style={[fm.footer, {paddingBottom: insets.bottom + 14}]}>
            <TouchableOpacity style={fm.resetBtn} onPress={handleReset}>
              <Ionicons name="refresh-outline" size={14} color="#888"/>
              <Text style={fm.resetTxt}>Reset</Text>
            </TouchableOpacity>
            <TouchableOpacity style={fm.applyBtn} onPress={handleApply}>
              <Ionicons name="download-outline" size={17} color="#fff"/>
              <Text style={fm.applyTxt}>Export dengan Filter Ini</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── ProgressModal ────────────────────────────────────────────────────────────
function ProgressModal({ visible, progress, label }) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={pm.overlay}>
        <View style={pm.card}>
          <View style={pm.iconWrap}>
            <Ionicons name="document-text-outline" size={28} color="#1565C0"/>
          </View>
          <Text style={pm.title}>Menyiapkan Excel...</Text>
          <Text style={pm.label}>{label}</Text>
          <View style={pm.barBg}>
            <View style={[pm.barFill, {width: `${progress}%`}]}/>
          </View>
          <Text style={pm.pct}>{progress}%</Text>
        </View>
      </View>
    </Modal>
  );
}

// ─── MenuItem ─────────────────────────────────────────────────────────────────
function MenuItem({ icon, title, subtitle, color, bgColor, onPress, loading, badge, disabled }) {
  return (
    <TouchableOpacity
      style={[s.menuItem, (loading || disabled) && {opacity: 0.45}]}
      onPress={onPress}
      disabled={loading || disabled}
      activeOpacity={0.8}
    >
      <View style={[s.menuIcon, {backgroundColor: disabled ? '#F5F5F5' : bgColor}]}>
        {loading
          ? <ActivityIndicator size="small" color={color}/>
          : <Ionicons name={icon} size={22} color={disabled ? '#BDBDBD' : color}/>
        }
      </View>
      <View style={s.menuText}>
        <View style={s.menuTitleRow}>
          <Text style={[s.menuTitle, disabled && {color:'#BDBDBD'}]}>{title}</Text>
          {badge && !disabled && (
            <View style={[s.badge, {backgroundColor: badge.bg}]}>
              <Text style={[s.badgeTxt, {color: badge.color}]}>{badge.label}</Text>
            </View>
          )}
          {disabled && (
            <View style={[s.badge, {backgroundColor:'#FFEBEE'}]}>
              <Text style={[s.badgeTxt, {color:'#E53935'}]}>OFF</Text>
            </View>
          )}
        </View>
        <Text style={[s.menuSubtitle, disabled && {color:'#BDBDBD'}]}>
          {disabled ? 'Fitur ini sedang dinonaktifkan oleh admin' : subtitle}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={disabled ? '#E0E0E0' : '#ccc'}/>
    </TouchableOpacity>
  );
}

// ─── Main MoreScreen ──────────────────────────────────────────────────────────
export default function MoreScreen() {
  const insets = useSafeAreaInsets();

  // ── Admin hidden toggle ─────────────────────────────────────────────────────
  const [adminMode,  setAdminMode]  = useState(false);
  const [tapCount,   setTapCount]   = useState(0);
  const tapTimerRef = useRef(null);
  const [features,   setFeatures]   = useState({
    exportExcel:  true,
    exportFilter: true,
    backup:       true,
  });
  const adminAnim = useRef(new Animated.Value(0)).current;

  const handleHeaderTap = () => {
    const newCount = tapCount + 1;
    setTapCount(newCount);
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => setTapCount(0), 800);
    if (newCount >= 3) {
      setTapCount(0);
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      const willOpen = !adminMode;
      setAdminMode(willOpen);
      Animated.spring(adminAnim, {
        toValue: willOpen ? 1 : 0, useNativeDriver: true, tension: 120, friction: 8,
      }).start();
    }
  };

  const closeAdmin = () => {
    setAdminMode(false);
    Animated.spring(adminAnim, {
      toValue: 0, useNativeDriver: true, tension: 120, friction: 8,
    }).start();
  };

  const handleToggleFeature = (key, value) => {
    setFeatures(prev => ({ ...prev, [key]: value }));
  };

  const adminTranslateY = adminAnim.interpolate({ inputRange: [0,1], outputRange: [-20,0] });

  // ── Export logic ────────────────────────────────────────────────────────────
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showProgress,    setShowProgress]    = useState(false);
  const [progress,        setProgress]        = useState(0);
  const [progressLabel,   setProgressLabel]   = useState('');
  const [loadingBackup,   setLoadingBackup]   = useState(false);
  const [lastExportInfo,  setLastExportInfo]  = useState(null);

  const handleExportWithFilter = useCallback((filterOpts) => { doExport(filterOpts); }, []);

  const doExport = async (filterOpts = {}) => {
    setShowProgress(true); setProgress(0); setProgressLabel('Mengambil data dari server...');
    try {
      const snap = await getDocs(query(collection(db,'form_produksi'), orderBy('createdAt','desc')));
      let docs = snap.docs.map(d => ({id:d.id,...d.data()}));
      if (docs.length === 0) {
        setShowProgress(false);
        Alert.alert('Tidak ada data','Belum ada form yang tersimpan untuk diekspor.');
        return;
      }
      setProgress(10); setProgressLabel('Menerapkan filter...');
      const filtered = applyFilters(docs, filterOpts);
      if (filtered.length === 0) {
        setShowProgress(false);
        Alert.alert('Tidak ada data','Tidak ada data yang cocok dengan filter.\nCoba ubah kriteria filter.');
        return;
      }
      setProgress(20); setProgressLabel(`Memproses ${filtered.length} form...`);
      const { filePath, fileName, rowCount } = await buildExcel(filtered, filterOpts, (p) => {
        setProgress(20 + Math.round(p * 0.78));
        setProgressLabel(p < 80 ? `Menyusun data (${p}%)...` : p < 95 ? 'Membuat file Excel...' : 'Menyimpan file...');
      });
      setProgress(100); setProgressLabel('Selesai!');
      setLastExportInfo({
        rows: rowCount, fileName,
        time: new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}),
        filterOpts,
      });
      await new Promise(r => setTimeout(r, 500));
      setShowProgress(false);
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(filePath, {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          dialogTitle: 'Simpan / Bagikan Laporan Excel',
          UTI: 'com.microsoft.excel.xlsx',
        });
      } else {
        Alert.alert('Berhasil ✅', `File tersimpan:\n${fileName}`);
      }
    } catch (e) {
      setShowProgress(false);
      Alert.alert('Error ❌', 'Gagal mengekspor data: ' + e.message);
    }
  };

  const handleQuickExport = () => {
    Alert.alert('Export Excel','Pilih mode export:',[
      {text:'Batal',style:'cancel'},
      {text:'⚡ Export Semua Data', onPress:()=>doExport({})},
      {text:'🔍 Pilih Filter Dulu', onPress:()=>setShowFilterModal(true)},
    ]);
  };

  const handleBackup = async () => {
    setLoadingBackup(true);
    try {
      const snap = await getDocs(query(collection(db,'form_produksi'), orderBy('createdAt','desc')));
      const docs = snap.docs.map(d => {
        const data = d.data();
        return { id:d.id, ...data, createdAt:data.createdAt?.toDate?.().toISOString()||null };
      });
      if (docs.length === 0) { Alert.alert('Tidak ada data','Belum ada form untuk di-backup.'); return; }
      const json = JSON.stringify({version:1,exportedAt:new Date().toISOString(),totalForms:docs.length,data:docs},null,2);
      const now = new Date();
      const stamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
      const fileName = `Backup_FormProduksi_${stamp}.json`;
      const filePath = `${FileSystem.cacheDirectory}${fileName}`;
      await FileSystem.writeAsStringAsync(filePath, json, {encoding:'utf8'});
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(filePath, {mimeType:'application/json', dialogTitle:'Simpan File Backup'});
      } else {
        Alert.alert('Berhasil ✅', `Backup tersimpan:\n${fileName}`);
      }
    } catch (e) {
      Alert.alert('Error ❌', 'Gagal membuat backup: ' + e.message);
    } finally {
      setLoadingBackup(false);
    }
  };

  return (
     <View style={[s.container, {paddingTop: insets.top}]}>
    {/* ── Tambahan: fix status bar putih ── */}
    <StatusBar backgroundColor="#1565C0" barStyle="light-content" translucent={false}/>
    

      {/* ── Header — klik 3× untuk admin ── */}
      <TouchableOpacity style={s.header} onPress={handleHeaderTap} activeOpacity={1}>
        <View style={s.headerBadge}>
          <Ionicons name="ellipsis-horizontal" size={13} color={adminMode ? '#FFD54F' : '#90CAF9'}/>
          <Text style={[s.headerBadgeTxt, adminMode && {color:'#FFD54F'}]}>
            {adminMode ? 'MODE ADMIN AKTIF' : 'MENU LAINNYA'}
          </Text>
        </View>
        <Text style={s.headerTitle}>Pengaturan & Data</Text>
        {adminMode && (
          <View style={s.adminIndicator}>
            <Ionicons name="lock-open" size={12} color="#FFD54F"/>
            <Text style={s.adminIndicatorTxt}>Admin</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* ── Admin Panel ── */}
      {adminMode && (
        <Animated.View style={[s.adminPanelWrap, {opacity: adminAnim, transform: [{translateY: adminTranslateY}]}]}>
          <AdminPanel features={features} onToggle={handleToggleFeature} onClose={closeAdmin}/>
        </Animated.View>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{paddingBottom: insets.bottom + 32}}
        keyboardShouldPersistTaps="handled"
      >
        {/* Info export terakhir */}
        {lastExportInfo && (
          <View style={s.lastExportCard}>
            <View style={s.lastExportIcon}>
              <Ionicons name="checkmark-circle" size={20} color="#2E7D32"/>
            </View>
            <View style={{flex:1}}>
              <Text style={s.lastExportTitle}>Export terakhir berhasil · {lastExportInfo.time}</Text>
              <Text style={s.lastExportSub} numberOfLines={1}>{lastExportInfo.fileName}</Text>
              <Text style={s.lastExportSub2}>{lastExportInfo.rows} baris data</Text>
            </View>
          </View>
        )}

        {/* Bagian Data */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Ionicons name="server-outline" size={14} color="#6B87A8"/>
            <Text style={s.sectionTitle}>MANAJEMEN DATA</Text>
          </View>
          <View style={s.card}>
            <MenuItem
              icon="document-text-outline"
              title="Export ke Excel"
              subtitle="Unduh laporan .xlsx dengan kolom rapi, auto-filter, dan sheet ringkasan lengkap. Bisa filter per tanggal, shift, bagian, atau produk."
              color="#2E7D32"
              bgColor="#E8F5E9"
              onPress={handleQuickExport}
              badge={{label:'Filter', bg:'#E8F5E9', color:'#2E7D32'}}
              disabled={!features.exportExcel}
            />
            <View style={s.divider}/>
            <MenuItem
              icon="filter-outline"
              title="Export dengan Filter"
              subtitle="Pilih filter tanggal, shift, bagian produksi, atau nama produk sebelum export"
              color="#1565C0"
              bgColor="#E3F2FD"
              onPress={() => setShowFilterModal(true)}
              disabled={!features.exportFilter}
            />
            <View style={s.divider}/>
            <MenuItem
              icon="cloud-download-outline"
              title="Backup Data (JSON)"
              subtitle="Simpan semua data form sebagai file JSON untuk cadangan"
              color="#6A1B9A"
              bgColor="#F3E5F5"
              onPress={handleBackup}
              loading={loadingBackup}
              disabled={!features.backup}
            />
          </View>
        </View>

        {/* Info format Excel */}
        <View style={s.infoCard}>
          <Ionicons name="information-circle-outline" size={16} color="#1565C0"/>
          <View style={{flex:1, gap:6}}>
            <Text style={s.infoTitle}>Format File Excel</Text>
            {[
              ['Laporan', 'setiap permasalahan = 1 baris, header berwarna, auto-filter aktif'],
              ['Ringkasan', 'total reject, jumlah form, rincian penuh/kosong/partial per bagian produksi'],
            ].map(([bold, rest]) => (
              <View key={bold} style={s.infoRow}>
                <View style={s.infoDot}/>
                <Text style={s.infoTxt}>Sheet <Text style={s.infoBold}>{bold}</Text>: {rest}</Text>
              </View>
            ))}
            <View style={s.infoRow}>
              <View style={s.infoDot}/>
              <Text style={s.infoTxt}>Nama file otomatis menyertakan tanggal, waktu, dan info filter yang dipilih</Text>
            </View>
          </View>
        </View>

        {/* Coming Soon */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Ionicons name="construct-outline" size={14} color="#6B87A8"/>
            <Text style={s.sectionTitle}>SEGERA HADIR</Text>
          </View>
          <View style={s.comingSoonCard}>
            <View style={s.comingSoonIcon}>
              <Ionicons name="cloud-upload-outline" size={22} color="#B0BEC5"/>
            </View>
            <View style={s.menuText}>
              <Text style={s.comingSoonTitle}>Restore Data</Text>
              <Text style={s.comingSoonSubtitle}>Pulihkan data dari file backup JSON.</Text>
            </View>
            <View style={s.comingSoonBadge}>
              <Text style={s.comingSoonBadgeTxt}>Segera</Text>
            </View>
          </View>
        </View>

      </ScrollView>

      <FilterExportModal
        visible={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        onApply={handleExportWithFilter}
      />
      <ProgressModal visible={showProgress} progress={progress} label={progressLabel}/>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex:1, backgroundColor:'#EEF2F8' },
  header: {
    backgroundColor:'#1565C0',
    paddingHorizontal:20, paddingBottom:20, paddingTop:12, alignItems:'center',
  },
  headerBadge: {
    flexDirection:'row', alignItems:'center', gap:5,
    backgroundColor:'rgba(255,255,255,0.15)',
    paddingHorizontal:10, paddingVertical:4, borderRadius:20, marginBottom:8,
  },
  headerBadgeTxt: { color:'#90CAF9', fontSize:10, fontWeight:'700', letterSpacing:1 },
  headerTitle:    { color:'#fff', fontSize:20, fontWeight:'800', letterSpacing:0.3 },
  adminIndicator: {
    flexDirection:'row', alignItems:'center', gap:4, marginTop:6,
    backgroundColor:'rgba(255,213,79,0.2)',
    paddingHorizontal:10, paddingVertical:3, borderRadius:12,
  },
  adminIndicatorTxt: { color:'#FFD54F', fontSize:10, fontWeight:'700' },
  adminPanelWrap:    { zIndex:10 },

  section:       { paddingHorizontal:16, paddingTop:20 },
  sectionHeader: { flexDirection:'row', alignItems:'center', gap:6, marginBottom:10 },
  sectionTitle:  { fontSize:11, fontWeight:'800', color:'#6B87A8', letterSpacing:0.8, textTransform:'uppercase' },

  card: {
    backgroundColor:'#fff', borderRadius:14,
    elevation:2, shadowColor:'#1565C0',
    shadowOffset:{width:0,height:1}, shadowOpacity:0.07, shadowRadius:4, overflow:'hidden',
  },
  menuItem:     { flexDirection:'row', alignItems:'center', gap:14, paddingHorizontal:16, paddingVertical:16 },
  menuIcon:     { width:44, height:44, borderRadius:12, justifyContent:'center', alignItems:'center' },
  menuText:     { flex:1 },
  menuTitleRow: { flexDirection:'row', alignItems:'center', gap:8, marginBottom:2 },
  menuTitle:    { fontSize:14, fontWeight:'700', color:'#1a1a1a' },
  menuSubtitle: { fontSize:11, color:'#888', lineHeight:15 },
  badge:        { paddingHorizontal:8, paddingVertical:3, borderRadius:12 },
  badgeTxt:     { fontSize:9, fontWeight:'800' },
  divider:      { height:1, backgroundColor:'#F0F4F8', marginHorizontal:16 },

  infoCard: {
    flexDirection:'row', gap:10,
    backgroundColor:'#fff', borderRadius:12, margin:16, marginTop:16,
    padding:14, elevation:1, borderLeftWidth:3, borderLeftColor:'#1565C0',
  },
  infoTitle: { fontSize:12, fontWeight:'700', color:'#1565C0', marginBottom:6 },
  infoRow:   { flexDirection:'row', alignItems:'flex-start', gap:8 },
  infoDot:   { width:5, height:5, borderRadius:3, backgroundColor:'#90CAF9', marginTop:5, flexShrink:0 },
  infoTxt:   { fontSize:11, color:'#6B87A8', lineHeight:16, flex:1 },
  infoBold:  { fontWeight:'700', color:'#1565C0' },

  lastExportCard: {
    flexDirection:'row', alignItems:'flex-start', gap:10,
    backgroundColor:'#E8F5E9', borderRadius:10,
    marginHorizontal:16, marginTop:14, padding:12,
    borderLeftWidth:3, borderLeftColor:'#2E7D32',
  },
  lastExportIcon:  { marginTop:1 },
  lastExportTitle: { fontSize:12, fontWeight:'700', color:'#2E7D32' },
  lastExportSub:   { fontSize:10, color:'#555', marginTop:2 },
  lastExportSub2:  { fontSize:10, color:'#888', marginTop:1 },

  comingSoonCard: {
    backgroundColor:'#fff', borderRadius:14,
    flexDirection:'row', alignItems:'center', gap:14,
    paddingHorizontal:16, paddingVertical:16, elevation:1, opacity:0.7,
  },
  comingSoonIcon:     { width:44, height:44, borderRadius:12, backgroundColor:'#ECEFF1', justifyContent:'center', alignItems:'center' },
  comingSoonTitle:    { fontSize:14, fontWeight:'700', color:'#90A4AE' },
  comingSoonSubtitle: { fontSize:11, color:'#B0BEC5', marginTop:2 },
  comingSoonBadge:    { backgroundColor:'#ECEFF1', paddingHorizontal:10, paddingVertical:4, borderRadius:20 },
  comingSoonBadgeTxt: { fontSize:10, fontWeight:'700', color:'#90A4AE' },
});

// ─── Admin Panel Styles ───────────────────────────────────────────────────────
const adm = StyleSheet.create({
  panel: {
    backgroundColor:'#1A237E',
    marginHorizontal:12, marginTop:6, marginBottom:2,
    borderRadius:14, overflow:'hidden', elevation:8,
    shadowColor:'#000', shadowOffset:{width:0,height:4}, shadowOpacity:0.3, shadowRadius:8,
    borderWidth:1, borderColor:'rgba(255,213,79,0.3)',
  },
  header: {
    flexDirection:'row', alignItems:'center', justifyContent:'space-between',
    paddingHorizontal:14, paddingVertical:12,
    backgroundColor:'rgba(0,0,0,0.25)',
    borderBottomWidth:1, borderBottomColor:'rgba(255,255,255,0.08)',
  },
  headerLeft: { flexDirection:'row', alignItems:'center', gap:10, flex:1 },
  lockIcon: {
    width:30, height:30, borderRadius:15,
    backgroundColor:'rgba(255,213,79,0.25)',
    justifyContent:'center', alignItems:'center',
  },
  headerTitle: { color:'#FFD54F', fontSize:13, fontWeight:'800' },
  headerSub:   { color:'rgba(255,255,255,0.55)', fontSize:10, marginTop:1 },
  closeBtn:    { padding:4 },
  body:        { paddingHorizontal:14, paddingVertical:10 },
  divider:     { height:1, backgroundColor:'rgba(255,255,255,0.08)', marginVertical:2 },
  row:         { flexDirection:'row', alignItems:'center', gap:12, paddingVertical:11 },
  featIcon:    { width:38, height:38, borderRadius:10, justifyContent:'center', alignItems:'center' },
  featText:    { flex:1 },
  featLabel:   { fontSize:13, fontWeight:'700', color:'#fff' },
  featDesc:    { fontSize:10, color:'rgba(255,255,255,0.5)', marginTop:2 },

  // Toggle
  toggle: {
    width:60, height:28, borderRadius:14, paddingHorizontal:3,
    flexDirection:'row', alignItems:'center', justifyContent:'space-between',
  },
  toggleOn:    { backgroundColor:'#2E7D32' },
  toggleOff:   { backgroundColor:'#424242' },
  toggleThumb: {
    width:22, height:22, borderRadius:11, backgroundColor:'#fff',
    elevation:2, shadowColor:'#000', shadowOffset:{width:0,height:1}, shadowOpacity:0.3, shadowRadius:2,
  },
  thumbRight:    { marginLeft:'auto' },
  thumbLeft:     { marginRight:'auto' },
  toggleLabel: {
    fontSize:8, fontWeight:'800',
    position:'absolute', left:0, right:0, textAlign:'center',
  },

  footer: {
    flexDirection:'row', alignItems:'flex-start', gap:6,
    paddingHorizontal:14, paddingVertical:10,
    backgroundColor:'rgba(0,0,0,0.15)',
    borderTopWidth:1, borderTopColor:'rgba(255,255,255,0.07)',
  },
  footerTxt: { fontSize:10, color:'rgba(255,255,255,0.4)', flex:1, lineHeight:14 },
});

// ─── Filter Modal Styles ──────────────────────────────────────────────────────
const fm = StyleSheet.create({
  overlay:  { flex:1, justifyContent:'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor:'rgba(0,0,0,0.5)' },
  sheet:    { backgroundColor:'#fff', borderTopLeftRadius:20, borderTopRightRadius:20, maxHeight:'90%', overflow:'hidden', elevation:20 },
  header:   { backgroundColor:'#1565C0', flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingVertical:14 },
  headerLeft:  { flexDirection:'row', alignItems:'center', gap:10, flex:1 },
  headerIcon:  { backgroundColor:'rgba(255,255,255,0.2)', width:32, height:32, borderRadius:16, justifyContent:'center', alignItems:'center' },
  headerTitle: { color:'#fff', fontSize:15, fontWeight:'800' },
  headerSub:   { color:'rgba(255,255,255,0.7)', fontSize:10, marginTop:1 },
  closeBtn:    { padding:4 },
  body:        { padding:16 },
  sectionLabel:{ fontSize:11, fontWeight:'800', color:'#444', textTransform:'uppercase', letterSpacing:0.6, marginBottom:10, marginTop:4 },
  chipsRow:    { flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:16 },
  chip:        { paddingHorizontal:13, paddingVertical:7, borderRadius:20, borderWidth:1.5, borderColor:'#D0DCF0', backgroundColor:'#F8FAFF' },
  chipActive:  { backgroundColor:'#1565C0', borderColor:'#1565C0' },
  chipTxt:     { fontSize:12, fontWeight:'700', color:'#6B87A8' },
  chipTxtActive:{ color:'#fff' },
  searchBox:   { flexDirection:'row', alignItems:'center', gap:8, borderWidth:1.5, borderColor:'#D0DCF0', borderRadius:10, paddingHorizontal:12, paddingVertical:10, backgroundColor:'#F8FAFF', marginBottom:16 },
  searchInput: { flex:1, fontSize:13, color:'#333', paddingVertical:0 },
  dateRow:     { flexDirection:'row', alignItems:'flex-end', gap:8, marginBottom:10 },
  dateSep:     { paddingBottom:14, alignItems:'center' },
  quickRow:    { flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:4 },
  quickBtn:    { paddingHorizontal:12, paddingVertical:6, borderRadius:8, backgroundColor:'#EEF4FF', borderWidth:1, borderColor:'#D0DCF0' },
  quickBtnTxt: { fontSize:11, fontWeight:'700', color:'#1565C0' },
  footer:      { flexDirection:'row', gap:10, padding:14, borderTopWidth:1, borderTopColor:'#E8EDF5', backgroundColor:'#fff' },
  resetBtn:    { flexDirection:'row', alignItems:'center', gap:6, paddingVertical:13, paddingHorizontal:16, borderRadius:10, borderWidth:1.5, borderColor:'#D0DCF0' },
  resetTxt:    { fontSize:13, fontWeight:'700', color:'#888' },
  applyBtn:    { flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8, backgroundColor:'#2E7D32', paddingVertical:13, borderRadius:10, elevation:3, shadowColor:'#2E7D32', shadowOffset:{width:0,height:3}, shadowOpacity:0.25, shadowRadius:6 },
  applyTxt:    { color:'#fff', fontSize:13, fontWeight:'800' },
  loadingRow: { flexDirection:'row', alignItems:'center', gap:8, paddingVertical:6, marginBottom:4 },
  loadingTxt: { fontSize:12, color:'#1565C0' },
});

// ─── Progress Modal Styles ────────────────────────────────────────────────────
const pm = StyleSheet.create({
  overlay: { flex:1, backgroundColor:'rgba(0,0,0,0.6)', justifyContent:'center', alignItems:'center', padding:32 },
  card:    { backgroundColor:'#fff', borderRadius:20, padding:28, width:'100%', alignItems:'center', gap:10, elevation:10 },
  iconWrap:{ backgroundColor:'#E3F2FD', width:56, height:56, borderRadius:28, justifyContent:'center', alignItems:'center', marginBottom:4 },
  title:   { fontSize:16, fontWeight:'800', color:'#1a1a1a' },
  label:   { fontSize:12, color:'#888', textAlign:'center', minHeight:16 },
  barBg:   { width:'100%', height:8, backgroundColor:'#EEF2F8', borderRadius:4, overflow:'hidden', marginTop:6 },
  barFill: { height:'100%', backgroundColor:'#1565C0', borderRadius:4 },
  pct:     { fontSize:13, fontWeight:'700', color:'#1565C0' },
});