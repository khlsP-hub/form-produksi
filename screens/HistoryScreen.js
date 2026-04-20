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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db } from '../firebase/config';
import { Ionicons } from '@expo/vector-icons';
import { BAGIAN_PRODUKSI } from '../data/masterData';
import DowntimePicker from '../components/DowntimePicker';
import DatePickerInput from '../components/DatePickerInput';
import { BackHandler } from 'react-native';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getLabel = (options, value) => {
  if (!options || !value) return value || '-';
  const found = options.find(o => o.value === value);
  return found ? found.label : value;
};

const formatDowntimeDisplay = (val) => {
  if (!val) return '-';
  const str = String(val).trim();
  if (str.includes(':') && str.includes(' - ')) return str;
  const num = parseFloat(str);
  if (!isNaN(num) && num > 0) return `${num} menit`;
  return str || '-';
};

// Konversi "DD/MM/YYYY" → Date
const parseDate = (str) => {
  if (!str) return null;
  const p = str.split('/');
  if (p.length !== 3) return null;
  return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
};

// Format Date → "DD/MM/YYYY"
const fmtDate = (d) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};

const todayStr   = () => fmtDate(new Date());
const emptyRow   = () => ({ downtime:'', permasalahan:'', totalReject:'', penanganan:'', namaAsisten:'', status:'open' });
const emptyShift = () => ({ output:'', cavity:'', cycleTime:'', karu:'', rows:[emptyRow()] });

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

// ─── FieldInput ───────────────────────────────────────────────────────────────
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

// ─── RowEditor ────────────────────────────────────────────────────────────────
function RowEditor({ row, idx, onUpdate, onRemove, canRemove }) {
  const update = (field, val) => onUpdate({ ...row, [field]: val });
  return (
    <View style={edit.rowCard}>
      <View style={edit.rowCardHeader}>
        <View style={edit.rowBadge}><Text style={edit.rowBadgeTxt}>#{idx + 1}</Text></View>
        <Text style={edit.rowTitle}>Permasalahan #{idx + 1}</Text>
        {canRemove && (
          <TouchableOpacity onPress={onRemove} style={edit.rowRemoveBtn} hitSlop={{top:8,bottom:8,left:8,right:8}}>
            <Ionicons name="trash-outline" size={14} color="#e53935"/>
          </TouchableOpacity>
        )}
      </View>
      <DowntimePicker label="Downtime" value={row.downtime} onChange={(val) => update('downtime', val)}/>
      <FieldInput label="Permasalahan" value={row.permasalahan} onChangeText={v=>update('permasalahan',v)} multiline/>
      <FieldInput label="Total Reject (KG)" value={row.totalReject} onChangeText={v=>update('totalReject',v)} keyboardType="numeric" placeholder="Contoh: 3,5"/>
      <FieldInput label="Penanganan" value={row.penanganan} onChangeText={v=>update('penanganan',v)} multiline/>
      <FieldInput label="Nama Asisten" value={row.namaAsisten} onChangeText={v=>update('namaAsisten',v)}/>
      <View style={edit.statusRow}>
        <Text style={edit.fieldLabel}>Status</Text>
        <View style={edit.statusToggleWrap}>
          <TouchableOpacity style={[edit.statusBtn, row.status==='open'&&edit.statusBtnOpen]} onPress={()=>update('status','open')}>
            <Text style={[edit.statusBtnTxt, row.status==='open'&&{color:'#c62828'}]}>OPEN</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[edit.statusBtn, row.status==='close'&&edit.statusBtnClose]} onPress={()=>update('status','close')}>
            <Text style={[edit.statusBtnTxt, row.status==='close'&&{color:'#2e7d32'}]}>CLOSE</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ─── ShiftEditor ──────────────────────────────────────────────────────────────
function ShiftEditor({ shiftNum, shift, onUpdate, enabled, onToggle }) {
  const update    = (field, val) => onUpdate({ ...shift, [field]: val });
  const updateRow = (idx, newRow) => { const rows=[...(shift.rows||[])]; rows[idx]=newRow; onUpdate({...shift,rows}); };
  const addRow    = () => onUpdate({ ...shift, rows:[...(shift.rows||[]),emptyRow()] });
  const removeRow = (idx) => { const rows=(shift.rows||[]).filter((_,i)=>i!==idx); onUpdate({...shift,rows:rows.length>0?rows:[emptyRow()]}); };

  return (
    <View style={edit.shiftCard}>
      <TouchableOpacity style={edit.shiftHeader} onPress={onToggle} activeOpacity={0.8}>
        <View style={[edit.shiftNumBadge, enabled&&edit.shiftNumBadgeActive]}>
          <Text style={[edit.shiftNumTxt, enabled&&{color:'#fff'}]}>S{shiftNum}</Text>
        </View>
        <Text style={[edit.shiftTitle, enabled&&{color:'#1565C0'}]}>Shift {shiftNum}</Text>
        <View style={edit.shiftToggleWrap}>
          <Text style={edit.shiftToggleLbl}>{enabled?'Aktif':'Nonaktif'}</Text>
          <Switch value={enabled} onValueChange={onToggle} trackColor={{false:'#D0D8E4',true:'#90CAF9'}} thumbColor={enabled?'#1565C0':'#f4f3f4'} style={{transform:[{scaleX:0.85},{scaleY:0.85}]}}/>
        </View>
      </TouchableOpacity>
      {enabled && shift && (
        <View style={edit.shiftBody}>
          <View style={edit.shiftFieldRow}>
            <View style={{flex:1}}><FieldInput label="Output (pcs)" value={shift.output} onChangeText={v=>update('output',v)} keyboardType="numeric"/></View>
            <View style={{width:12}}/>
            <View style={{flex:1}}><FieldInput label="Cavity" value={shift.cavity} onChangeText={v=>update('cavity',v)} keyboardType="numeric"/></View>
          </View>
          <View style={edit.shiftFieldRow}>
            <View style={{flex:1}}><FieldInput label="Cycle Time" value={shift.cycleTime} onChangeText={v=>update('cycleTime',v)} keyboardType="numeric"/></View>
            <View style={{width:12}}/>
            <View style={{flex:1}}><FieldInput label="Nama Karu" value={shift.karu} onChangeText={v=>update('karu',v)}/></View>
          </View>
          <View style={edit.rowsSection}>
            <Text style={edit.rowsSectionTitle}>Permasalahan</Text>
            {(shift.rows||[]).map((row,idx)=>(
              <RowEditor key={idx} row={row} idx={idx} onUpdate={nr=>updateRow(idx,nr)} onRemove={()=>removeRow(idx)} canRemove={(shift.rows||[]).length>1}/>
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

// ─── EditModal ────────────────────────────────────────────────────────────────
function EditModal({ item, onClose, onSaved }) {
  const [form, setForm]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [shiftOn, setShiftOn] = useState({1:false,2:false,3:false});

  useEffect(() => {
    if (item) {
      setForm(cloneItem(item));
      setShiftOn({1:!!item.shift1,2:!!item.shift2,3:!!item.shift3});
    }
  }, [item]);

  if (!item || !form) return null;

  const updateShift = (num, val) => setForm(p=>({...p,[`shift${num}`]:val}));
  const toggleShift = (num) => {
  setShiftOn(prev => {
    const nowOn = !prev[num];

    setForm(f => {
      // 🔥 kalau dimatikan → hapus data shift
      if (!nowOn) {
        return { ...f, [`shift${num}`]: null };
      }

      // 🔥 kalau dinyalakan → buat shift kosong
      if (nowOn && !f[`shift${num}`]) {
        return { ...f, [`shift${num}`]: emptyShift() };
      }

      return f;
    });

    return { ...prev, [num]: nowOn };
  });
};


  const cleanShift = (shift, isOn) => {
  if (!isOn) return null;
  if (!shift) return null;

  // kalau kosong semua → null
  if (!shift.output && !shift.karu && (!shift.rows || shift.rows.length === 0)) {
    return null;
  }

  return shift;
};

  const handleSave = async () => {
  setLoading(true);

  try {
    await updateDoc(doc(db, 'form_produksi', item.id), {
      tanggal: form.tanggal,
      bagianProduksi: form.bagianProduksi,
      namaProduk: form.namaProduk,
      kodeProduk: form.kodeProduk,
      noMesin: form.noMesin,
      berat: form.berat,

      // 🔥 INI BAGIAN PENTING (FIX BUG SHIFT)
      shift1: cleanShift(form.shift1, shiftOn[1]),
      shift2: cleanShift(form.shift2, shiftOn[2]),
      shift3: cleanShift(form.shift3, shiftOn[3]),
    });

    Alert.alert(
      'Berhasil ✅',
      'Data berhasil diperbarui!',
      [{ text: 'OK', onPress: () => {
          onClose();
          onSaved?.();
        }
      }]
    );

  } catch (e) {
    Alert.alert('Error ❌', 'Gagal menyimpan: ' + e.message);
  } finally {
    setLoading(false);
  }
};

  return (
    <Modal visible={!!item} transparent animationType="slide">
      <View style={edit.overlay}>
        <View style={edit.sheet}>
          <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':'height'}>
            <ScrollView>
              <View style={edit.header}>
                <View style={{flex:1}}>
                  <Text style={edit.headerLabel}>EDIT FORM</Text>
                  <Text style={edit.headerTitle} numberOfLines={1}>{form.namaProduk||form.kodeProduk||'Form'}</Text>
                </View>
                <TouchableOpacity onPress={onClose} style={edit.closeBtn} disabled={loading}>
                  <Ionicons name="close" size={22} color="#fff"/>
                </TouchableOpacity>
              </View>
              <ScrollView style={{flex:1}} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingBottom:40}}>
                <View style={edit.section}>
                  <View style={edit.sectionHeader}>
                    <View style={edit.sectionIconWrap}><Ionicons name="cube-outline" size={14} color="#1565C0"/></View>
                    <Text style={edit.sectionTitle}>Data Produksi</Text>
                  </View>
                  <FieldInput label="Tanggal" value={form.tanggal} onChangeText={v=>setForm(p=>({...p,tanggal:v}))}/>
                  <FieldInput label="Bagian Produksi" value={form.bagianProduksi} onChangeText={v=>setForm(p=>({...p,bagianProduksi:v}))}/>
                  <FieldInput label="Nama Produk" value={form.namaProduk} onChangeText={v=>setForm(p=>({...p,namaProduk:v}))}/>
                  <FieldInput label="Kode Produk" value={form.kodeProduk} onChangeText={v=>setForm(p=>({...p,kodeProduk:v}))}/>
                  <FieldInput label="No. Mesin" value={form.noMesin} onChangeText={v=>setForm(p=>({...p,noMesin:v}))}/>
                  <FieldInput label="Berat (gram)" value={form.berat} onChangeText={v=>setForm(p=>({...p,berat:v}))} keyboardType="numeric"/>
                </View>
                <View style={edit.section}>
                  <View style={edit.sectionHeader}>
                    <View style={edit.sectionIconWrap}><Ionicons name="time-outline" size={14} color="#1565C0"/></View>
                    <Text style={edit.sectionTitle}>Data Shift</Text>
                  </View>
                  {[1,2,3].map(num=>(
                    <ShiftEditor key={num} shiftNum={num} shift={form[`shift${num}`]} onUpdate={val=>updateShift(num,val)} enabled={shiftOn[num]} onToggle={()=>toggleShift(num)}/>
                  ))}
                </View>
              </ScrollView>
              <View style={edit.footer}>
                <TouchableOpacity style={edit.cancelBtn} onPress={onClose} disabled={loading}>
                  <Text style={edit.cancelTxt}>Batal</Text>
                </TouchableOpacity>
                <TouchableOpacity style={edit.saveBtn} disabled={loading}
                  onPress={()=>Alert.alert('Simpan Perubahan','Yakin ingin menyimpan?',[{text:'Batal',style:'cancel'},{text:'Simpan',onPress:handleSave}])}>
                  {loading?<ActivityIndicator size="small" color="#fff"/>:<><Ionicons name="checkmark-circle-outline" size={18} color="#fff"/><Text style={edit.saveTxt}>Simpan Perubahan</Text></>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </View>
    </Modal>
  );
}

// ─── DetailModal ──────────────────────────────────────────────────────────────
function DetailModal({ item, onClose, onSaved }) {


  useEffect(() => {
  const onBackPress = () => {
    if (item) {
      onClose();
      return true;
    }
    return false;
  };

  const subscription = BackHandler.addEventListener(
    'hardwareBackPress',
    onBackPress
  );

  return () => subscription.remove();
}, [item]);

  useEffect(() => {
  const onBackPress = () => {
    if (item) {
      onClose(); // 🔥 tutup modal
      return true; // 🔥 stop default behavior
    }
    return false;
  };

  const subscription = BackHandler.addEventListener(
    'hardwareBackPress',
    onBackPress
  );

  return () => subscription.remove();
}, [item]);

  const insets = useSafeAreaInsets();
  if (!item) return null;
  const renderShift = (shift, num) => {
    if (!shift) return null;
    return (
      <View key={num} style={styles.detailShift}>
        <Text style={styles.detailShiftTitle}>SHIFT {num}</Text>
        {[['Output',shift.output],['Cavity',shift.cavity],['Cycle Time',shift.cycleTime],['Karu',shift.karu]].map(([k,v])=>(
          <View style={styles.detailRow} key={k}><Text style={styles.detailKey}>{k}</Text><Text style={styles.detailVal}>{v||'-'}</Text></View>
        ))}
        {shift.rows?.map((row,i)=>(
          <View key={i} style={styles.rowDetail}>
            <Text style={styles.rowNum}>Permasalahan #{i+1}</Text>
            {[['Downtime',formatDowntimeDisplay(row.downtime)],['Permasalahan',row.permasalahan],['Total Reject (KG)',row.totalReject],['Penanganan',row.penanganan],['Nama Asisten',row.namaAsisten],['Status',row.status]].map(([k,v])=>(
              <View style={styles.detailRow} key={k}>
                <Text style={styles.detailKey}>{k}</Text>
                <Text style={[styles.detailVal,k==='Status'&&v==='open'&&styles.statusOpen,k==='Status'&&v==='close'&&styles.statusClose]}>{v||'-'}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    );
  };
  return (
    <Modal
  visible={!!item}
  transparent
  animationType="slide"
  onRequestClose={onClose} // 🔥 TAMBAHKAN DI SINI
>
      <View style={styles.modalOverlay}>
        <View style={styles.detailModal}>
          <View style={styles.detailHeader}>
            <Text style={styles.detailTitle}>Detail Form</Text>
            <TouchableOpacity onPress={onClose} style={styles.detailClose}><Ionicons name="close" size={22} color="#fff"/></TouchableOpacity>
          </View>
          <ScrollView
  style={styles.detailScroll}
  showsVerticalScrollIndicator={false}
  contentContainerStyle={{
    paddingBottom: 20 + insets.bottom // 🔥 AUTO AMAN
  }}
>
            <View style={styles.detailSection}>
              <Text style={styles.detailSectionTitle}>Data Produksi</Text>
              {[['Tanggal',item.tanggal],['Bagian Produksi',getLabel(BAGIAN_PRODUKSI,item.bagianProduksi)],['Nama Produk',item.namaProduk],['Kode Produk',item.kodeProduk],['No. Mesin',item.noMesin],['Berat',item.berat]].map(([k,v])=>(
                <View style={styles.detailRow} key={k}><Text style={styles.detailKey}>{k}</Text><Text style={styles.detailVal}>{v||'-'}</Text></View>
              ))}
            </View>
            {[item.shift1,item.shift2,item.shift3].map((s,i)=>renderShift(s,i+1))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── FilterModal ──────────────────────────────────────────────────────────────
const BAGIAN_OPTS = [
  {value:'',             label:'Semua'},
  {value:'PET',          label:'PET'},
  {value:'INJECT',       label:'Inject'},
  {value:'BLOW',         label:'Blow'},
  {value:'DECORATING',   label:'Decorating'},
  {value:'SECOND_PROSES',label:'Second Proses'},
];

function FilterModal({ visible, onClose, filters, onApply }) {
  const [localBagian,   setLocalBagian]   = useState(filters.bagian);
  const [localDateFrom, setLocalDateFrom] = useState(filters.dateFrom);
  const [localDateTo,   setLocalDateTo]   = useState(filters.dateTo);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) {
      setLocalBagian(filters.bagian);
      setLocalDateFrom(filters.dateFrom);
      setLocalDateTo(filters.dateTo);
    }
  }, [visible]);

  const handleApply = () => { onApply({bagian:localBagian,dateFrom:localDateFrom,dateTo:localDateTo}); onClose(); };
  const handleReset = () => {
    const empty = {bagian:'',dateFrom:'',dateTo:''};
    onApply(empty); setLocalBagian(''); setLocalDateFrom(''); setLocalDateTo(''); onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={flt.overlay}>
        <TouchableOpacity style={flt.backdrop} activeOpacity={1} onPress={onClose}/>
        <View style={flt.sheet}>
          {/* Header */}
          <View style={flt.header}>
            <View style={flt.headerLeft}>
              <View style={flt.headerIconWrap}><Ionicons name="filter" size={15} color="#fff"/></View>
              <Text style={flt.headerTitle}>Filter Data</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={flt.closeBtn}><Ionicons name="close" size={20} color="#fff"/></TouchableOpacity>
          </View>

          <ScrollView style={flt.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* Bagian Produksi */}
            <Text style={flt.sectionLabel}>Bagian Produksi</Text>
            <View style={flt.chipsWrap}>
              {BAGIAN_OPTS.map(opt=>(
                <TouchableOpacity key={opt.value} style={[flt.chip,localBagian===opt.value&&flt.chipActive]} onPress={()=>setLocalBagian(opt.value)}>
                  <Text style={[flt.chipTxt,localBagian===opt.value&&flt.chipTxtActive]}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Rentang Tanggal */}
            <Text style={flt.sectionLabel}>Rentang Tanggal</Text>
            <View style={flt.dateRow}>
              <View style={{flex:1}}>
                <DatePickerInput label="Dari Tanggal" value={localDateFrom} onChange={setLocalDateFrom}/>
              </View>
              <View style={flt.dateSep}><Ionicons name="arrow-forward" size={14} color="#bbb"/></View>
              <View style={{flex:1}}>
                <DatePickerInput label="Sampai Tanggal" value={localDateTo} onChange={setLocalDateTo}/>
              </View>
            </View>

            {/* Shortcut tanggal */}
            <Text style={flt.quickLabel}>Pilih Cepat</Text>
            <View style={flt.quickRow}>
              {[
                {label:'Hari Ini',  fn:()=>{ const t=todayStr(); setLocalDateFrom(t); setLocalDateTo(t); }},
                {label:'7 Hari',    fn:()=>{ const to=new Date(),fr=new Date(); fr.setDate(to.getDate()-6); setLocalDateFrom(fmtDate(fr)); setLocalDateTo(fmtDate(to)); }},
                {label:'30 Hari',   fn:()=>{ const to=new Date(),fr=new Date(); fr.setDate(to.getDate()-29); setLocalDateFrom(fmtDate(fr)); setLocalDateTo(fmtDate(to)); }},
                {label:'Bulan Ini', fn:()=>{ const now=new Date(),fr=new Date(now.getFullYear(),now.getMonth(),1); setLocalDateFrom(fmtDate(fr)); setLocalDateTo(fmtDate(now)); }},
              ].map(q=>(
                <TouchableOpacity key={q.label} style={flt.quickBtn} onPress={q.fn}>
                  <Text style={flt.quickBtnTxt}>{q.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>

          {/* Footer */}
          <View style={[flt.footer, { paddingBottom: 14 + insets.bottom }]}>
            <TouchableOpacity style={flt.resetBtn} onPress={handleReset}>
              <Ionicons name="refresh-outline" size={15} color="#888"/>
              <Text style={flt.resetTxt}>Reset</Text>
            </TouchableOpacity>
            <TouchableOpacity style={flt.applyBtn} onPress={handleApply}>
              <Ionicons name="checkmark-circle-outline" size={17} color="#fff"/>
              <Text style={flt.applyTxt}>Terapkan Filter</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main HistoryScreen ───────────────────────────────────────────────────────
export default function HistoryScreen() {
  // ── Safe area untuk status bar ──
  const insets = useSafeAreaInsets();

  const [forms,      setForms]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected,   setSelected]   = useState(null);
  const [editing,    setEditing]    = useState(null);
  const [search,     setSearch]     = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [filters,    setFilters]    = useState({bagian:'',dateFrom:'',dateTo:''});

  useEffect(() => {
    const q = query(collection(db,'form_produksi'), orderBy('createdAt','desc'));
    const unsub = onSnapshot(q,(snap)=>{
      setForms(snap.docs.map(d=>({id:d.id,...d.data()})));
      setLoading(false); setRefreshing(false);
    });
    return ()=>unsub();
  }, []);

  const activeFilterCount = [filters.bagian, filters.dateFrom||filters.dateTo].filter(Boolean).length;

  const filtered = useMemo(() => {
    let result = forms;

    if (search.trim()) {
      const norm = (s) => String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
      const q = norm(search);
      result = result.filter(f => norm(f.namaProduk).includes(q)||norm(f.kodeProduk).includes(q)||norm(f.noMesin).includes(q));
    }

    if (filters.bagian) {
      result = result.filter(f => f.bagianProduksi === filters.bagian);
    }

    if (filters.dateFrom || filters.dateTo) {
      const from = filters.dateFrom ? parseDate(filters.dateFrom) : null;
      const to   = filters.dateTo   ? parseDate(filters.dateTo)   : null;
      if (to) to.setHours(23,59,59,999);
      result = result.filter(f => {
        const d = parseDate(f.tanggal);
        if (!d) return false;
        if (from && d < from) return false;
        if (to   && d > to)   return false;
        return true;
      });
    }

    return result;
  }, [forms, search, filters]);

  const handleDelete = (id) => {
    Alert.alert('Hapus Form','Yakin ingin menghapus form ini?',[
      {text:'Batal',style:'cancel'},
      {text:'Hapus',style:'destructive',onPress:async()=>{
        try{ await deleteDoc(doc(db,'form_produksi',id)); }
        catch(e){ Alert.alert('Error','Gagal menghapus: '+e.message); }
      }},
    ]);
  };

  const bagianColor = (bagian) => {
    switch(bagian){
      case 'PET':           return {bg:'#E3F2FD',text:'#1565C0'};
      case 'INJECT':        return {bg:'#F3E5F5',text:'#7B1FA2'};
      case 'BLOW':          return {bg:'#E8F5E9',text:'#2E7D32'};
      case 'DECORATING':    return {bg:'#FFF8E1',text:'#F57F17'};
      case 'SECOND_PROSES': return {bg:'#FCE4EC',text:'#C62828'};
      default:              return {bg:'#FFF3E0',text:'#E65100'};
    }
  };

  // Cek apakah shift terisi (punya data output, karu, atau rows)
const isShiftFilledCard = (shift) => {
  if (!shift) return false;
  if (shift.output?.toString().trim()) return true;
  if (shift.karu?.trim()) return true;
  return (shift.rows || []).some(
    r => r.permasalahan || r.downtime || r.penanganan || parseFloat(r.totalReject) > 0
  );
};
 
// Dapatkan status tiap shift: [{num:1, hasOpen:true}, {num:2, hasOpen:false}, ...]
const getShiftStatuses = (item) => {
  return [1, 2, 3].map(n => {
    const shift = item[`shift${n}`];
    if (!isShiftFilledCard(shift)) return null;
    const hasOpen = (shift.rows || []).some(r => r.status === 'open');
    return { num: n, hasOpen };
  }).filter(Boolean);
};

  const renderItem = ({item}) => {
    const totalRejects = [item.shift1, item.shift2, item.shift3]
      .flatMap(s => s?.rows || [])
      .reduce((sum, r) => {
        const val = String(r.totalReject || 0).trim();
        const num = val.includes(',')
          ? parseFloat(val.replace(/\./g, '').replace(',', '.'))
          : parseFloat(val);
        return sum + (num || 0);
      }, 0);
 
    // Info status per shift yang terisi
    const shiftStatuses = getShiftStatuses(item);
 
    const clr = bagianColor(item.bagianProduksi);
 
    return (
      <TouchableOpacity style={styles.card} onPress={() => setSelected(item)} activeOpacity={0.85}>
        <View style={styles.cardTop}>
          <View style={styles.cardTopLeft}>
            <View style={[styles.bagianTag, {backgroundColor: clr.bg}]}>
              <Text style={[styles.bagianTagText, {color: clr.text}]}>{item.bagianProduksi || '-'}</Text>
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
 
          {/* Badge per shift — S1 OPEN, S2 CLOSE, dll */}
          <View style={styles.shiftBadgesCol}>
            {shiftStatuses.length === 0 ? (
              <View style={[styles.shiftBadgeRow, styles.badgeClose]}>
                <Text style={[styles.badgeText, {color:'#2e7d32'}]}>CLOSE</Text>
              </View>
            ) : (
              shiftStatuses.map(({ num, hasOpen }) => (
                <View
                  key={num}
                  style={[styles.shiftBadgeRow, hasOpen ? styles.badgeOpen : styles.badgeClose]}
                >
                  <View style={[
                    styles.shiftNumPill,
                    {backgroundColor: hasOpen ? '#ffcdd2' : '#c8e6c9'}
                  ]}>
                    <Text style={[
                      styles.shiftNumPillTxt,
                      {color: hasOpen ? '#c62828' : '#2e7d32'}
                    ]}>S{num}</Text>
                  </View>
                  <Ionicons
                    name={hasOpen ? 'alert-circle' : 'checkmark-circle'}
                    size={11}
                    color={hasOpen ? '#e53935' : '#2e7d32'}
                  />
                  <Text style={[styles.badgeText, {color: hasOpen ? '#e53935' : '#2e7d32'}]}>
                    {hasOpen ? 'OPEN' : 'CLOSE'}
                  </Text>
                </View>
              ))
            )}
          </View>
        </View>
 
        <View style={styles.cardFooter}>
          <View style={styles.stat}>
            <Ionicons name="warning-outline" size={13} color="#e53935"/>
            <Text style={styles.statText}>Reject: {totalRejects.toFixed(2)} KG</Text>
          </View>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.editBtn} onPress={() => setEditing(item)} hitSlop={{top:8,bottom:8,left:8,right:8}}>
              <Ionicons name="create-outline" size={15} color="#1565C0"/>
              <Text style={styles.editTxt}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(item.id)} hitSlop={{top:8,bottom:8,left:8,right:8}}>
              <Ionicons name="trash-outline" size={15} color="#e53935"/>
              <Text style={styles.deleteTxt}>Hapus</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) return (
    <View style={[styles.center,{paddingTop:insets.top}]}>
      <ActivityIndicator size="large" color="#1565C0"/>
      <Text style={styles.loadingText}>Memuat data...</Text>
    </View>
  );

  return (
    <View style={styles.container}>

      {/* ── Header — paddingTop menyesuaikan status bar otomatis ── */}
      <View style={[styles.header, {paddingTop: insets.top + 12}]}>
        <View style={{flex:1}}>
          <Text style={styles.headerTitle}>Riwayat Form</Text>
          <Text style={styles.headerCount}>{forms.length} form tersimpan</Text>
        </View>
        <View style={styles.headerActions}>
          {/* Tombol filter */}
          <TouchableOpacity
            style={[styles.filterBtn, activeFilterCount>0 && styles.filterBtnActive]}
            onPress={()=>setShowFilter(true)}
          >
            <Ionicons name="filter" size={16} color={activeFilterCount>0?'#fff':'rgba(255,255,255,0.8)'}/>
            <Text style={[styles.filterBtnTxt, activeFilterCount>0&&{color:'#fff'}]}>
              Filter{activeFilterCount>0?` (${activeFilterCount})`:''}
            </Text>
          </TouchableOpacity>
          <View style={styles.headerIcon}>
            <Ionicons name="document-text" size={20} color="#90CAF9"/>
          </View>
        </View>
      </View>

      {/* ── Active filter chips (muncul saat ada filter aktif) ── */}
      {activeFilterCount > 0 && (
        <View style={styles.activeFilterBar}>
          <Ionicons name="funnel" size={12} color="#1565C0"/>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flex:1}}>
            <View style={styles.activeFilterChips}>
              {filters.bagian && (
                <View style={styles.activeChip}>
                  <Text style={styles.activeChipTxt}>{filters.bagian}</Text>
                  <TouchableOpacity onPress={()=>setFilters(p=>({...p,bagian:''}))} hitSlop={{top:6,bottom:6,left:4,right:4}}>
                    <Ionicons name="close" size={11} color="#1565C0"/>
                  </TouchableOpacity>
                </View>
              )}
              {(filters.dateFrom||filters.dateTo) && (
                <View style={styles.activeChip}>
                  <Ionicons name="calendar-outline" size={11} color="#1565C0"/>
                  <Text style={styles.activeChipTxt}>{filters.dateFrom||'...'} – {filters.dateTo||'...'}</Text>
                  <TouchableOpacity onPress={()=>setFilters(p=>({...p,dateFrom:'',dateTo:''}))} hitSlop={{top:6,bottom:6,left:4,right:4}}>
                    <Ionicons name="close" size={11} color="#1565C0"/>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </ScrollView>
          <TouchableOpacity onPress={()=>setFilters({bagian:'',dateFrom:'',dateTo:''})} style={styles.clearAllBtn}>
            <Text style={styles.clearAllTxt}>Hapus</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Search ── */}
      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={17} color="#999"/>
        <TextInput
          style={styles.searchInput}
          placeholder="Cari produk, kode, mesin..."
          placeholderTextColor="#bbb"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
        {search.length>0&&(
          <TouchableOpacity onPress={()=>setSearch('')}>
            <Ionicons name="close-circle" size={17} color="#bbb"/>
          </TouchableOpacity>
        )}
      </View>

      {(search.length>0||activeFilterCount>0) && (
        <Text style={styles.filterInfo}>Menampilkan {filtered.length} dari {forms.length} form</Text>
      )}

      <FlatList
        data={filtered}
        keyExtractor={item=>item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>setRefreshing(true)} colors={['#1565C0']}/>}
        ListEmptyComponent={
          <View style={styles.center}>
            <Ionicons name="document-outline" size={48} color="#ccc"/>
            <Text style={styles.emptyText}>{search||activeFilterCount>0?'Tidak ada hasil':'Belum ada form tersimpan'}</Text>
          </View>
        }
      />

      <DetailModal item={selected} onClose={()=>setSelected(null)}/>
      <EditModal item={editing} onClose={()=>setEditing(null)} onSaved={()=>setEditing(null)}/>
      <FilterModal visible={showFilter} onClose={()=>setShowFilter(false)} filters={filters} onApply={setFilters}/>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:    {flex:1, backgroundColor:'#EEF2F8'},

  // Header — paddingTop diatur dinamis via insets.top di JSX
  header: {
    backgroundColor:'#1565C0',
    paddingHorizontal:16, paddingBottom:14,
    flexDirection:'row', justifyContent:'space-between', alignItems:'flex-end',
  },
  headerTitle:  {color:'#fff', fontSize:18, fontWeight:'800'},
  headerCount:  {color:'#90CAF9', fontSize:12, marginTop:2},
  headerActions:{flexDirection:'row', alignItems:'center', gap:10},
  headerIcon:   {backgroundColor:'rgba(255,255,255,0.15)', padding:8, borderRadius:10},

  // UBAH cardTop (tambah gap:8) dan cardTopLeft (hapus marginRight):
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 8,                // ← TAMBAH ini
  },
  cardTopLeft: {
    flex: 1,
    // hapus: marginRight: 10  ← hapus baris ini kalau ada
  },
 
// TAMBAH 4 key baru berikut ke dalam objek styles (di mana saja, misal setelah kodeProduk):
  shiftBadgesCol: {
    alignItems: 'flex-end',
    gap: 5,
    flexShrink: 0,
  },
  shiftBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 8,
  },
  shiftNumPill: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  shiftNumPillTxt: {
    fontSize: 9,
    fontWeight: '800',
  },

  // Filter button
  filterBtn: {
    flexDirection:'row', alignItems:'center', gap:5,
    backgroundColor:'rgba(255,255,255,0.15)',
    paddingHorizontal:12, paddingVertical:8, borderRadius:10,
  },
  filterBtnActive: {backgroundColor:'rgba(255,255,255,0.3)', borderWidth:1, borderColor:'rgba(255,255,255,0.5)'},
  filterBtnTxt: {color:'rgba(255,255,255,0.8)', fontSize:12, fontWeight:'700'},

  // Active filter bar
  activeFilterBar: {
    flexDirection:'row', alignItems:'center', gap:8,
    backgroundColor:'#EEF4FF', paddingHorizontal:12, paddingVertical:8,
    borderBottomWidth:1, borderBottomColor:'#D0DCF0',
  },
  activeFilterChips:{flexDirection:'row', gap:6, alignItems:'center'},
  activeChip: {
    flexDirection:'row', alignItems:'center', gap:5,
    backgroundColor:'#fff', paddingHorizontal:10, paddingVertical:5,
    borderRadius:20, borderWidth:1, borderColor:'#1565C0',
  },
  activeChipTxt:  {fontSize:11, color:'#1565C0', fontWeight:'700'},
  clearAllBtn:    {paddingHorizontal:8, paddingVertical:4},
  clearAllTxt:    {fontSize:11, color:'#e53935', fontWeight:'700'},

  searchBar: {
    flexDirection:'row', alignItems:'center', backgroundColor:'#fff',
    margin:12, marginBottom:4, borderRadius:10,
    paddingHorizontal:12, paddingVertical:9, elevation:2,
    shadowColor:'#000', shadowOffset:{width:0,height:1}, shadowOpacity:0.06, shadowRadius:3, gap:8,
  },
  searchInput:  {flex:1, fontSize:14, color:'#333', paddingVertical:0},
  filterInfo:   {fontSize:11, color:'#888', marginHorizontal:16, marginBottom:4, fontStyle:'italic'},
  list:         {padding:12, paddingBottom:32},

  card: {
    backgroundColor:'#fff', borderRadius:12, padding:14, marginBottom:10,
    elevation:2, shadowColor:'#1565C0', shadowOffset:{width:0,height:1}, shadowOpacity:0.07, shadowRadius:4,
  },
  cardTop:      {flexDirection:'row', justifyContent:'space-between', marginBottom:10},
  cardTopLeft:  {flex:1, marginRight:10},
  bagianTag:    {alignSelf:'flex-start', paddingHorizontal:7, paddingVertical:2, borderRadius:5, marginBottom:5},
  bagianTagText:{fontSize:10, fontWeight:'800', letterSpacing:0.5},
  cardProduk:   {fontSize:14, fontWeight:'700', color:'#1a1a1a', lineHeight:19},
  cardMeta:     {fontSize:12, color:'#888', marginTop:3},
  kodeRow:      {flexDirection:'row', alignItems:'center', gap:4, marginTop:3},
  kodeProduk:   {fontSize:11, color:'#888'},
  badge:        {flexDirection:'row', alignItems:'center', gap:3, paddingHorizontal:8, paddingVertical:4, borderRadius:8, alignSelf:'flex-start'},
  badgeOpen:    {backgroundColor:'#FFEBEE'},
  badgeClose:   {backgroundColor:'#E8F5E9'},
  badgeText:    {fontSize:10, fontWeight:'800'},
  cardFooter:   {flexDirection:'row', justifyContent:'space-between', alignItems:'center', borderTopWidth:1, borderTopColor:'#F0F4F8', paddingTop:8},
  stat:         {flexDirection:'row', alignItems:'center', gap:4},
  statText:     {fontSize:12, color:'#555'},
  actionRow:    {flexDirection:'row', alignItems:'center', gap:12},
  editBtn:      {flexDirection:'row', alignItems:'center', gap:4, padding:4},
  editTxt:      {fontSize:12, color:'#1565C0', fontWeight:'600'},
  deleteBtn:    {flexDirection:'row', alignItems:'center', gap:4, padding:4},
  deleteTxt:    {fontSize:12, color:'#e53935', fontWeight:'600'},
  center:       {flex:1, justifyContent:'center', alignItems:'center', padding:32},
  loadingText:  {color:'#888', marginTop:8},
  emptyText:    {color:'#aaa', marginTop:8, fontSize:14},

  // Detail Modal
  modalOverlay: {flex:1, backgroundColor:'rgba(0,0,0,0.6)'},
  detailModal:  {flex:1, marginTop:60, backgroundColor:'#fff', borderTopLeftRadius:20, borderTopRightRadius:20, overflow:'hidden'},
  detailHeader: {flexDirection:'row', justifyContent:'space-between', alignItems:'center', backgroundColor:'#1565C0', padding:16},
  detailTitle:  {color:'#fff', fontSize:16, fontWeight:'700'},
  detailClose:  {padding:4},
  detailScroll: {flex:1},
  detailSection:{padding:16},
  detailSectionTitle:{fontSize:13, fontWeight:'700', color:'#1565C0', marginBottom:8, textTransform:'uppercase', letterSpacing:0.5},
  detailShift:  {margin:16, marginTop:0, padding:12, backgroundColor:'#F8F9FA', borderRadius:8, borderLeftWidth:3, borderLeftColor:'#1565C0'},
  detailShiftTitle:{fontSize:12, fontWeight:'800', color:'#1565C0', marginBottom:8, letterSpacing:1},
  detailRow:    {flexDirection:'row', justifyContent:'space-between', paddingVertical:5, borderBottomWidth:1, borderBottomColor:'#eee'},
  detailKey:    {fontSize:12, color:'#888', flex:1},
  detailVal:    {fontSize:12, color:'#333', fontWeight:'600', flex:1.5, textAlign:'right'},
  rowDetail:    {marginTop:8, padding:8, backgroundColor:'#fff', borderRadius:6, borderWidth:1, borderColor:'#e0e0e0'},
  rowNum:       {fontSize:11, fontWeight:'700', color:'#1565C0', marginBottom:4},
  statusOpen:   {color:'#e53935'},
  statusClose:  {color:'#2e7d32'},
});

// ─── Filter Modal Styles ──────────────────────────────────────────────────────
const flt = StyleSheet.create({
  overlay:  {flex:1, justifyContent:'flex-end'},
  backdrop: {...StyleSheet.absoluteFillObject, backgroundColor:'rgba(0,0,0,0.45)'},
  sheet:    {backgroundColor:'#fff', borderTopLeftRadius:20, borderTopRightRadius:20, maxHeight:'80%', overflow:'hidden', elevation:20},
  header:   {backgroundColor:'#1565C0', flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingVertical:14},
  headerLeft:{flexDirection:'row', alignItems:'center', gap:10},
  headerIconWrap:{backgroundColor:'rgba(255,255,255,0.2)', width:30, height:30, borderRadius:15, justifyContent:'center', alignItems:'center'},
  headerTitle:{color:'#fff', fontSize:15, fontWeight:'800'},
  closeBtn:  {padding:4},
  body:      {padding:16},
  sectionLabel:{fontSize:12, fontWeight:'800', color:'#444', marginBottom:10, textTransform:'uppercase', letterSpacing:0.5},
  chipsWrap: {flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:20},
  chip:      {paddingHorizontal:14, paddingVertical:8, borderRadius:20, borderWidth:1.5, borderColor:'#D0DCF0', backgroundColor:'#F8FAFF'},
  chipActive:{backgroundColor:'#1565C0', borderColor:'#1565C0'},
  chipTxt:   {fontSize:12, fontWeight:'700', color:'#666'},
  chipTxtActive:{color:'#fff'},
  dateRow:   {flexDirection:'row', alignItems:'flex-end', gap:8, marginBottom:16},
  dateSep:   {paddingBottom:14, alignItems:'center'},
  quickLabel:{fontSize:11, fontWeight:'700', color:'#888', marginBottom:8},
  quickRow:  {flexDirection:'row', gap:8, flexWrap:'wrap', marginBottom:8},
  quickBtn:  {paddingHorizontal:12, paddingVertical:7, borderRadius:8, backgroundColor:'#EEF4FF', borderWidth:1, borderColor:'#D0DCF0'},
  quickBtnTxt:{fontSize:11, fontWeight:'700', color:'#1565C0'},
  footer:    {flexDirection:'row', gap:10, padding:14, borderTopWidth:1, borderTopColor:'#E8EDF5', backgroundColor:'#fff'},
  resetBtn:  {flexDirection:'row', alignItems:'center', gap:6, paddingVertical:13, paddingHorizontal:18, borderRadius:10, borderWidth:1.5, borderColor:'#D0DCF0'},
  resetTxt:  {fontSize:13, fontWeight:'700', color:'#888'},
  applyBtn:  {flex:1, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8, backgroundColor:'#1565C0', paddingVertical:13, borderRadius:10, elevation:3, shadowColor:'#1565C0', shadowOffset:{width:0,height:3}, shadowOpacity:0.25, shadowRadius:6},
  applyTxt:  {color:'#fff', fontSize:14, fontWeight:'800'},
});

// ─── Edit Modal Styles ────────────────────────────────────────────────────────
const edit = StyleSheet.create({
  overlay:  {flex:1, backgroundColor:'rgba(0,0,0,0.6)', justifyContent:'flex-end'},
  sheet:    {backgroundColor:'#F0F4FA', borderTopLeftRadius:20, borderTopRightRadius:20, height:'94%', overflow:'hidden'},
  header:   {backgroundColor:'#1565C0', flexDirection:'row', alignItems:'flex-start', paddingHorizontal:16, paddingVertical:14},
  headerLabel:{color:'#90CAF9', fontSize:10, fontWeight:'700', letterSpacing:1.2, marginBottom:2},
  headerTitle:{color:'#fff', fontSize:15, fontWeight:'800'},
  closeBtn:  {padding:4, marginLeft:8},
  section:   {backgroundColor:'#fff', marginHorizontal:12, marginTop:12, borderRadius:14, padding:14, elevation:1, shadowColor:'#000', shadowOffset:{width:0,height:1}, shadowOpacity:0.05, shadowRadius:3},
  sectionHeader:{flexDirection:'row', alignItems:'center', gap:8, marginBottom:12},
  sectionIconWrap:{backgroundColor:'#EEF4FF', padding:6, borderRadius:8},
  sectionTitle:{fontSize:13, fontWeight:'800', color:'#1565C0'},
  fieldWrap:  {marginBottom:10},
  fieldLabel: {fontSize:11, fontWeight:'700', color:'#555', marginBottom:5},
  fieldInput: {borderWidth:1.5, borderColor:'#D8E3F0', borderRadius:8, paddingHorizontal:12, paddingVertical:8, fontSize:13, color:'#222', backgroundColor:'#FAFCFF'},
  fieldInputMulti:{minHeight:60, textAlignVertical:'top'},
  shiftFieldRow:{flexDirection:'row'},
  shiftCard:  {borderWidth:1.5, borderColor:'#D8E3F0', borderRadius:12, marginBottom:10, overflow:'hidden'},
  shiftHeader:{flexDirection:'row', alignItems:'center', gap:10, padding:12, backgroundColor:'#F8FAFF'},
  shiftNumBadge:{width:28, height:28, borderRadius:14, backgroundColor:'#E8EDF5', justifyContent:'center', alignItems:'center'},
  shiftNumBadgeActive:{backgroundColor:'#1565C0'},
  shiftNumTxt:{fontSize:12, fontWeight:'800', color:'#888'},
  shiftTitle: {flex:1, fontSize:13, fontWeight:'700', color:'#888'},
  shiftToggleWrap:{flexDirection:'row', alignItems:'center', gap:6},
  shiftToggleLbl:{fontSize:11, color:'#888'},
  shiftBody:  {padding:12, backgroundColor:'#fff', borderTopWidth:1, borderTopColor:'#EEF0F2'},
  rowsSection:{marginTop:8},
  rowsSectionTitle:{fontSize:11, fontWeight:'800', color:'#546E7A', textTransform:'uppercase', letterSpacing:0.5, marginBottom:8},
  rowCard:    {backgroundColor:'#F8FAFC', borderRadius:10, padding:12, marginBottom:8, borderLeftWidth:3, borderLeftColor:'#90CAF9'},
  rowCardHeader:{flexDirection:'row', alignItems:'center', gap:8, marginBottom:10},
  rowBadge:   {backgroundColor:'#E3F2FD', paddingHorizontal:7, paddingVertical:2, borderRadius:5},
  rowBadgeTxt:{fontSize:10, fontWeight:'800', color:'#1565C0'},
  rowTitle:   {flex:1, fontSize:12, fontWeight:'700', color:'#333'},
  rowRemoveBtn:{padding:4},
  statusRow:  {flexDirection:'row', alignItems:'center', justifyContent:'space-between', marginBottom:4},
  statusToggleWrap:{flexDirection:'row', gap:6},
  statusBtn:  {paddingHorizontal:16, paddingVertical:6, borderRadius:8, borderWidth:1.5, borderColor:'#D8E3F0', backgroundColor:'#F0F4F8'},
  statusBtnOpen:{backgroundColor:'#FFEBEE', borderColor:'#e53935'},
  statusBtnClose:{backgroundColor:'#E8F5E9', borderColor:'#2e7d32'},
  statusBtnTxt:{fontSize:11, fontWeight:'800', color:'#90A4AE'},
  addRowBtn:  {flexDirection:'row', alignItems:'center', gap:6, justifyContent:'center', paddingVertical:10, borderRadius:8, borderWidth:1.5, borderColor:'#1565C0', borderStyle:'dashed', backgroundColor:'#EEF4FF', marginTop:4},
  addRowTxt:  {fontSize:12, fontWeight:'700', color:'#1565C0'},
  footer:     {flexDirection:'row', gap:10, padding:14, borderTopWidth:1, borderTopColor:'#E8EDF5', backgroundColor:'#fff'},
  cancelBtn:  {flex:1, paddingVertical:13, borderRadius:10, borderWidth:1.5, borderColor:'#D0DCF0', alignItems:'center'},
  cancelTxt:  {fontSize:14, fontWeight:'700', color:'#888'},
  saveBtn:    {flex:2, flexDirection:'row', alignItems:'center', justifyContent:'center', gap:8, backgroundColor:'#1565C0', paddingVertical:13, borderRadius:10, elevation:3, shadowColor:'#1565C0', shadowOffset:{width:0,height:3}, shadowOpacity:0.25, shadowRadius:6},
  saveTxt:    {fontSize:14, fontWeight:'800', color:'#fff'},
});