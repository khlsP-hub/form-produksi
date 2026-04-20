// screens/ReportScreen.js
import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Modal, TextInput, FlatList, Alert
} from 'react-native';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { Ionicons } from '@expo/vector-icons';
import DatePickerInput from '../components/DatePickerInput';
import { NOMOR_MESIN, BAGIAN_PRODUKSI } from '../data/masterData';

// ─── Helpers tanggal ──────────────────────────────────────────────────────────
const pad  = (n) => String(n).padStart(2, '0');
const fmtD = (d) => `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`;
const fmtQ = (d) => `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;

const parseDate = (str) => {
  if (!str) return new Date();
  const p = str.split('/');
  if (p.length !== 3) return new Date();
  return new Date(parseInt(p[2]), parseInt(p[1])-1, parseInt(p[0]));
};
const normDate = (str) => {
  if (!str) return '';
  const p = str.split('/');
  if (p.length !== 3) return str;
  return `${parseInt(p[0])}/${parseInt(p[1])}/${p[2]}`;
};
const bothFmt = (d) => {
  const a = fmtD(d), b = fmtQ(d);
  return a === b ? [a] : [a, b];
};
function datesBetween(fromStr, toStr) {
  const from = parseDate(fromStr), to = parseDate(toStr);
  from.setHours(0,0,0,0); to.setHours(0,0,0,0);
  const dates = [], cur = new Date(from);
  while (cur <= to) { dates.push(new Date(cur)); cur.setDate(cur.getDate()+1); }
  return dates;
}
function getDateRange(mode) {
  const today = new Date(); today.setHours(0,0,0,0);
  const dates = [];
  if (mode==='harian') { dates.push(new Date(today)); }
  else if (mode==='mingguan') { for(let i=6;i>=0;i--){const d=new Date(today);d.setDate(today.getDate()-i);dates.push(d);} }
  else if (mode==='bulanan') { const y=today.getFullYear(),m=today.getMonth(),days=new Date(y,m+1,0).getDate(); for(let i=1;i<=days;i++) dates.push(new Date(y,m,i)); }
  else if (mode==='tahunan') { const y=today.getFullYear(); for(let m=0;m<12;m++) dates.push(new Date(y,m,1)); }
  return dates;
}

// ─── Kalkulasi ────────────────────────────────────────────────────────────────
const parseNum = (s) => {
  if (!s && s !== 0) return 0;
  const str = String(s).trim();
  if (!str) return 0;

  if (str.includes(',')) {
    return parseFloat(str.replace(/\./g, '').replace(',', '.')) || 0;
  }

  const dotCount = (str.match(/\./g) || []).length;

  if (dotCount > 1) {
    return parseFloat(str.replace(/\./g, '')) || 0;
  }

  if (dotCount === 1) {
    const afterDot = str.split('.')[1];
    if (afterDot && afterDot.length === 3) {
      return parseFloat(str.replace(/\./g, '')) || 0;
    }
    return parseFloat(str) || 0;
  }

  return parseFloat(str) || 0;
};
const shiftTotalReject = (shift) =>
  (shift?.rows || []).reduce(
    (sum, r) => sum + parseNum(r.totalRejectRaw ?? r.totalReject),
    0
  );
const isShiftFilled = (shift) => {
  if (!shift) return false;
  if (parseNum(shift.output)>0) return true;
  if (shift.karu?.trim()) return true;
  return shift.rows?.some(r=>r.permasalahan||r.penanganan||r.downtime||parseNum(r.totalRejectRaw??r.totalReject)>0)||false;
};
const getShiftValue = (shift, beratStr) => {
  if (!isShiftFilled(shift)) return null;
 
  const reject = shiftTotalReject(shift);
 
  // Prioritaskan outputRaw (angka murni) → fallback ke output (string)
  const outputRaw = shift.outputRaw;
  const output = outputRaw !== undefined && outputRaw !== null && outputRaw !== ''
    ? parseNum(outputRaw)
    : parseNum(shift.output);
 
  const berat = parseNum(beratStr);
 
  if (output > 0 && berat > 0) {
    const outputKg = (output * berat) / 1000;
    const total    = reject + outputKg;
 
    if (total === 0) return { value: 0, isPct: true };
 
    // Sanity check: reject tidak mungkin > total produksi + reject
    // Kalau hasilnya > 100% berarti ada masalah data, tampilkan apa adanya tapi tandai
    const pct = (reject / total) * 100;
    return {
      value:  pct,
      isPct:  true,
      reject: reject,
      outputKg,
      total,
    };
  }
 
  // Kalau output atau berat tidak tersedia, tampilkan KG saja
  return { value: reject, isPct: false };
}
const getOverallTrend = (vals) => {
  const v=vals.filter(x=>x!==null);
  if (v.length<2) return null;
  let naik=0,turun=0;
  for(let i=1;i<v.length;i++){if(v[i]>v[i-1]+0.01)naik++;else if(v[i]<v[i-1]-0.01)turun++;}
  if(naik>0&&turun===0) return {id:'naik',      label:'Tren Naik',  color:'#c62828',bg:'#FFEBEE',icon:'trending-up'  };
  if(turun>0&&naik===0) return {id:'turun',     label:'Tren Turun', color:'#2e7d32',bg:'#E8F5E9',icon:'trending-down' };
  if(naik>0&&turun>0)   return {id:'fluktuatif',label:'Fluktuatif', color:'#e65100',bg:'#FFF3E0',icon:'pulse'         };
  return                        {id:'sama',      label:'Stabil',     color:'#455a64',bg:'#ECEFF1',icon:'remove-outline'};
};

// ─── Fetch ────────────────────────────────────────────────────────────────────
async function fetchDocsByDates(dates) {
  if (!dates || dates.length === 0) return [];
  const labels=new Set(); dates.forEach(d=>bothFmt(d).forEach(f=>labels.add(f)));
  const arr=[...labels]; let allDocs=[];
  for(let i=0;i<arr.length;i+=10){
    const q=query(collection(db,'form_produksi'),where('tanggal','in',arr.slice(i,i+10)));
    const snap=await getDocs(q);
    snap.docs.forEach(d=>allDocs.push({id:d.id,...d.data()}));
  }
  const seen=new Set();
  return allDocs.filter(d=>{if(seen.has(d.id))return false;seen.add(d.id);return true;});
}

// ─── Asisten helpers ──────────────────────────────────────────────────────────
function extractAsistens(docs) {
  const set=new Set();
  docs.forEach(doc=>[doc.shift1,doc.shift2,doc.shift3].forEach(s=>s?.rows?.forEach(r=>{const n=r.namaAsisten?.trim();if(n)set.add(n);})));
  return [...set].sort();
}
function buildAsistenData(docs, namaAsisten) {
  const points=[];
  docs.forEach(doc=>[1,2,3].forEach(n=>{
    const shift=doc[`shift${n}`];
    if(!isShiftFilled(shift)) return;
    const myRows=(shift.rows||[]).filter(r=>r.namaAsisten?.trim().toLowerCase()===namaAsisten.toLowerCase()&&(r.permasalahan||r.downtime||parseNum(r.totalRejectRaw??r.totalReject)>0));
    if(myRows.length===0) return;
    const myReject=myRows.reduce((sum,r)=>sum+parseNum(r.totalRejectRaw??r.totalReject),0);
    const output=parseNum(shift.outputRaw??shift.output), berat=parseNum(doc.berat);
    const outKg=(output>0&&berat>0)?(output*berat)/1000:0;
    const total = myReject + outKg;
    const rejectPct = total > 0 ? (myReject / total) * 100 : null;
    points.push({tanggal:doc.tanggal,normTgl:normDate(doc.tanggal),shiftNum:n,noMesin:doc.noMesin||'-',kodeProduk:doc.namaProduk||doc.kodeProduk||'-',berat:doc.berat,output,outKg,rejectKg:myReject,rejectPct,rows:myRows,hasOpen:myRows.some(r=>r.status==='open'),karu:shift.karu});
  }));
  return points.sort((a,b)=>{const ta=parseDate(a.tanggal).getTime(),tb=parseDate(b.tanggal).getTime();return ta!==tb?ta-tb:a.shiftNum-b.shiftNum;});
}

// ─── Mesin helpers ────────────────────────────────────────────────────────────
function extractMesins(docs) {
  const set=new Set();
  docs.forEach(d=>{if(d.noMesin?.trim())set.add(d.noMesin.trim());});
  NOMOR_MESIN.forEach(m=>{if(m.value)set.add(m.value);});
  return [...set].sort();
}

// ─── Fetch asisten dari master_karyawan Firestore ─────────────────────────────
async function fetchAsistenByBagian(bagian) {
  if (!bagian) return [];
  try {
    const q = query(
      collection(db, 'master_karyawan'),
      where('bagian', '==', bagian),
      where('role', '==', 'asisten')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data().nama).filter(Boolean).sort();
  } catch (e) {
    console.error('fetchAsistenByBagian error:', e);
    return [];
  }
}

function buildMesinData(docs, noMesin) {
  const mesinDocs = docs.filter(d => (d.noMesin||'').trim() === noMesin.trim());
  const asistens  = extractAsistens(mesinDocs);
  return asistens.map((nama, i) => {
    const points   = buildAsistenData(mesinDocs, nama);
    const totalKg  = points.reduce((s,p)=>s+p.rejectKg,0);
    const pcts     = points.map(p=>p.rejectPct).filter(p=>p!==null);
    const avgPct   = pcts.length>0 ? pcts.reduce((a,b)=>a+b,0)/pcts.length : null;
    const over3    = pcts.filter(p=>p>=3).length;
    const trend    = getOverallTrend(points.map(p=>p.rejectPct??p.rejectKg));
    const avgPerShift = [1,2,3].map(sn=>{
      const sp=points.filter(p=>p.shiftNum===sn);
      const sp_pcts=sp.map(p=>p.rejectPct).filter(p=>p!==null);
      if(sp_pcts.length>0) return sp_pcts.reduce((a,b)=>a+b,0)/sp_pcts.length;
      const sp_kgs=sp.map(p=>p.rejectKg);
      if(sp_kgs.length>0) return sp_kgs.reduce((a,b)=>a+b,0)/sp_kgs.length;
      return null;
    });
    return {nama,color:ASISTEN_COLORS[i%ASISTEN_COLORS.length],bg:ASISTEN_BG[i%ASISTEN_BG.length],points,totalKg,avgPct,over3,trend,avgPerShift,count:points.length};
  });
}

// ─── Konstanta warna ──────────────────────────────────────────────────────────
const ASISTEN_COLORS = ['#1565C0','#00897B','#6A1B9A','#c62828','#e65100','#455a64'];
const ASISTEN_BG     = ['#E3F2FD','#E0F2F1','#F3E5F5','#FFEBEE','#FFF3E0','#ECEFF1'];
const ASISTEN_BORDER = ['#90CAF9','#80CBC4','#CE93D8','#EF9A9A','#FFCC80','#B0BEC5'];

// ─── Shared UI Components ─────────────────────────────────────────────────────
function ExpandBtn({ open, color='#1565C0' }) {
  return (
    <View style={[sh.expandBtn, open && {backgroundColor:'#EEF4FF',borderColor:color}]}>
      <Ionicons name={open?'chevron-up':'chevron-down'} size={13} color={open?color:'#bbb'}/>
    </View>
  );
}

function TrendBadge({ trend, small }) {
  if (!trend) return null;
  return (
    <View style={[sh.trendBadge, {backgroundColor:trend.bg}, small && sh.trendBadgeSm]}>
      <Ionicons name={trend.icon} size={small?9:11} color={trend.color}/>
      <Text style={[sh.trendTxt, {color:trend.color}, small && sh.trendTxtSm]}>{trend.label}</Text>
    </View>
  );
}

function DateRangeRow({ fromDate, toDate, onFromChange, onToChange }) {
  return (
    <View style={sh.dateRow}>
      <View style={{flex:1}}><DatePickerInput label="Dari Tanggal" value={fromDate} onChange={onFromChange}/></View>
      <View style={sh.dateSep}><Ionicons name="arrow-forward" size={15} color="#bbb"/></View>
      <View style={{flex:1}}><DatePickerInput label="Sampai Tanggal" value={toDate} onChange={onToChange}/></View>
    </View>
  );
}

function ActionBtn({ label, icon, onPress, disabled, loading: isLoading }) {
  return (
    <TouchableOpacity style={[sh.actionBtn, disabled && sh.actionBtnDisabled]} onPress={onPress} disabled={disabled||isLoading}>
      {isLoading
        ? <ActivityIndicator size="small" color="#fff"/>
        : <><Ionicons name={icon} size={16} color="#fff"/><Text style={sh.actionBtnTxt}>{label}</Text></>
      }
    </TouchableOpacity>
  );
}

// ─── StatSectionLabel ────────────────────────────────────────────────────────
function StatSectionLabel({ label }) {
  return (
    <View style={sc.sectionLabelRow}>
      <View style={sc.sectionLabelLine}/>
      <Text style={sc.sectionLabelTxt}>{label}</Text>
      <View style={sc.sectionLabelLine}/>
    </View>
  );
}

// ─── SummaryStatCard ─────────────────────────────────────────────────────────
function SummaryStatCard({ num, label, unit, color, iconName, accentColor, bgColor, footer }) {
  const finalAccent = accentColor || color || '#185FA5';
  const finalBg     = bgColor     || '#E6F1FB';
  return (
    <View style={[sc.card, { borderTopColor: finalAccent }]}>
      <View style={[sc.iconWrap, { backgroundColor: finalBg }]}>
        <Ionicons name={iconName || 'stats-chart'} size={15} color={finalAccent} />
      </View>
      <Text style={sc.cardLabel}>{label}</Text>
      <View style={sc.valueRow}>
        <Text style={[sc.cardValue, { color: finalAccent }]}>{num}</Text>
        {unit ? <Text style={[sc.cardUnit, { color: finalAccent }]}>{unit}</Text> : null}
      </View>
      {footer ? <Text style={sc.cardFooter}>{footer}</Text> : null}
    </View>
  );
}

// ─── TrendStatCard ────────────────────────────────────────────────────────────
function TrendStatCard({ num, label, color, bg, iconName }) {
  return (
    <View style={[sc.trendCard, { borderTopColor: color }]}>
      <View style={[sc.trendIconWrap, { backgroundColor: bg }]}>
        <Ionicons name={iconName} size={16} color={color} />
      </View>
      <Text style={[sc.trendNum, { color }]}>{num}</Text>
      <Text style={sc.trendLabel}>{label}</Text>
    </View>
  );
}

// ─── SummarySection ──────────────────────────────────────────────────────────
function SummarySection({ stats, activeReport }) {
  // BUG FIX: Guard jika stats null/undefined
  if (!stats) return null;

  return (
    <View style={sc.summaryWrapper}>
      <StatSectionLabel label="Ringkasan Periode" />
      <View style={sc.row}>
        <SummaryStatCard
          num={stats.total}
          label="Form Tercatat"
          unit=" form"
          accentColor="#185FA5"
          bgColor="#E6F1FB"
          iconName="document-text-outline"
          footer="Periode aktif"
        />
        <SummaryStatCard
          num={(stats.totalReject||0).toFixed(1)}
          label="Total Reject"
          unit=" KG"
          accentColor="#A32D2D"
          bgColor="#FCEBEB"
          iconName="alert-circle-outline"
          footer="Semua shift"
        />
      </View>

      {activeReport === 1 && (
        <>
          <StatSectionLabel label="Analisis Tren Shift" />
          <View style={sc.trendRow}>
            <TrendStatCard num={stats.naikCount||0}  label={'Tren\nNaik'}      color="#A32D2D" bg="#FCEBEB" iconName="trending-up"   />
            <TrendStatCard num={stats.fluktCount||0} label={'Fluktu-\natif'}   color="#854F0B" bg="#FAEEDA" iconName="pulse"          />
            <TrendStatCard num={stats.turunCount||0} label={'Tren\nTurun'}     color="#3B6D11" bg="#EAF3DE" iconName="trending-down"  />
          </View>
        </>
      )}

      {activeReport === 2 && (
        <>
          <StatSectionLabel label="Peringatan Reject" />
          <View style={sc.row}>
            <SummaryStatCard
              num={stats.over3Count||0}
              label="Form Reject ≥ 3%"
              unit=" form"
              accentColor="#854F0B"
              bgColor="#FAEEDA"
              iconName="warning-outline"
              footer={`Dari ${stats.total||0} total form`}
            />
          </View>
        </>
      )}
    </View>
  );
}

// ─── AsistenPointCard ─────────────────────────────────────────────────────────
function AsistenPointCard({ point }) {
  const [open,setOpen]=useState(false);
  const isHigh=point.rejectPct!==null&&point.rejectPct>=3;
  return (
    <View style={[apc.card,isHigh&&apc.cardWarn,point.hasOpen&&apc.cardOpen]}>
      <TouchableOpacity style={apc.header} onPress={()=>setOpen(o=>!o)} activeOpacity={0.85}>
        <View style={apc.left}>
          <View style={apc.shiftRow}>
            <View style={[apc.shiftBadge,{backgroundColor:ASISTEN_COLORS[(point.shiftNum-1)%ASISTEN_COLORS.length]||'#1565C0'}]}>
              <Text style={apc.shiftTxt}>Shift {point.shiftNum}</Text>
            </View>
            {point.hasOpen&&<View style={apc.openBadge}><Ionicons name="alert-circle" size={10} color="#c62828"/><Text style={apc.openTxt}>OPEN</Text></View>}
          </View>
          <Text style={apc.tanggal}>{point.tanggal}</Text>
          <Text style={apc.mesin}>{point.noMesin}</Text>
          <Text style={apc.produk} numberOfLines={1}>{point.kodeProduk}</Text>
          {point.karu?<Text style={apc.karu}>Karu: {point.karu}</Text>:null}
        </View>
        <View style={apc.right}>
          {point.rejectPct!==null
            ? <><Text style={[apc.pct,isHigh&&apc.pctHigh]}>{point.rejectPct.toFixed(1)}%</Text><Text style={apc.pctLabel}>Reject</Text><Text style={apc.kg}>{point.rejectKg.toFixed(2)} KG</Text></>
            : <><Text style={[apc.pct,{fontSize:18}]}>{point.rejectKg.toFixed(2)}</Text><Text style={apc.pctLabel}>KG Reject</Text></>
          }
          {point.output>0&&<Text style={apc.output}>{point.output.toLocaleString('id-ID')} pcs</Text>}
          <ExpandBtn open={open}/>
        </View>
      </TouchableOpacity>
      {open&&(
        <View style={apc.body}>
          <Text style={apc.bodyTitle}>Permasalahan yang Ditangani</Text>
          {(point.rows||[]).map((row,i)=>{
            const rKg=parseNum(row.totalRejectRaw??row.totalReject),isRowOpen=row.status==='open';
            return(
              <View key={i} style={[apc.row,isRowOpen&&apc.rowOpen]}>
                <View style={apc.rowTop}>
                  <View style={apc.rowNum}><Text style={apc.rowNumTxt}>#{i+1}</Text></View>
                  <View style={[apc.pill,isRowOpen?apc.pillOpen:apc.pillClose]}><Text style={[apc.pillTxt,{color:isRowOpen?'#c62828':'#2e7d32'}]}>{(row.status||'-').toUpperCase()}</Text></View>
                  {rKg>0&&<View style={apc.rejectTag}><Text style={apc.rejectTagTxt}>{rKg.toFixed(2)} KG</Text></View>}
                </View>
                {[['timer-outline','Downtime',row.downtime?`${row.downtime} menit`:null],
                  ['warning-outline','Masalah',row.permasalahan],
                  ['checkmark-circle-outline','Penanganan',row.penanganan]]
                  .filter(([,,v])=>v).map(([icon,lbl,val])=>(
                    <View key={lbl} style={apc.field}><Ionicons name={icon} size={11} color="#888" style={{marginTop:1}}/><Text style={apc.fieldLbl}>{lbl}:</Text><Text style={apc.fieldVal}>{val}</Text></View>
                ))}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ─── Chart bar asisten (scroll horizontal) ────────────────────────────────────
const CHART_H = 90;
function AsitenChart({ points }) {
  if (!points||points.length===0) return null;
  const vals=points.map(p=>p.rejectPct??p.rejectKg);
  const maxVal=Math.max(3,...vals,0.01);
  const trend=getOverallTrend(vals);
  const SHIFT_COLORS={1:'#1565C0',2:'#00897B',3:'#6A1B9A'};
  return (
    <View style={ach.box}>
      <View style={ach.topRow}>
        <Text style={ach.title}>Grafik Reject per Shift</Text>
        <TrendBadge trend={trend}/>
      </View>
      <View style={ach.legendRow}>
        {[1,2,3].map(n=>(<View key={n} style={ach.legendItem}><View style={[ach.legendDot,{backgroundColor:SHIFT_COLORS[n]}]}/><Text style={ach.legendTxt}>Shift {n}</Text></View>))}
        <View style={ach.legendItem}><View style={[ach.legendDot,{backgroundColor:'#e53935'}]}/><Text style={ach.legendTxt}>≥3%</Text></View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{width:Math.max(points.length*64,240),paddingHorizontal:4}}>
          <View style={ach.barsRow}>
            {points.map((p,i)=>{
              const val=p.rejectPct??p.rejectKg,barPx=Math.max((val/maxVal)*CHART_H,3),isHigh=p.rejectPct!==null&&p.rejectPct>=3;
              return(
                <View key={i} style={ach.barWrap}>
                  <Text style={[ach.valTxt,isHigh&&ach.valHigh]}>{p.rejectPct!==null?`${p.rejectPct.toFixed(1)}%`:`${p.rejectKg.toFixed(1)}kg`}</Text>
                  <View style={[ach.track,{height:CHART_H}]}><View style={[ach.fill,{height:barPx,backgroundColor:isHigh?'#e53935':SHIFT_COLORS[p.shiftNum]||'#1565C0'}]}/></View>
                  <Text style={ach.dateTxt}>{p.normTgl}</Text>
                  <View style={[ach.shiftDot,{backgroundColor:SHIFT_COLORS[p.shiftNum]||'#1565C0'}]}><Text style={ach.shiftDotTxt}>S{p.shiftNum}</Text></View>
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
      <View style={ach.threshRow}><View style={ach.threshLine}/><Text style={ach.threshTxt}>Batas 3%</Text></View>
      <Text style={ach.note}>{points.some(p=>p.rejectPct!==null)?'Reject asisten (KG) ÷ output shift (KG) × 100':'Total reject dalam KG'}</Text>
    </View>
  );
}

// ─── Chart komparasi beberapa asisten per shift ───────────────────────────────
function KomparasiChart({ compData }) {
  if (!compData || compData.length === 0) return null;
  const allVals=compData.flatMap(d=>d.avgPerShift.filter(v=>v!==null));
  if (allVals.length===0) return null;
  const maxVal=Math.max(3,...allVals,0.01);
  return (
    <View style={komp.chartCard}>
      <View style={komp.chartHeaderRow}><Ionicons name="bar-chart-outline" size={14} color="#1565C0"/><Text style={komp.chartCardTitle}>Rata-rata Reject per Shift</Text></View>
      <View style={komp.chartLegend}>
        {compData.map((d,i)=>(<View key={i} style={komp.chartLegendItem}><View style={[komp.chartLegendDot,{backgroundColor:d.color}]}/><Text style={komp.chartLegendTxt} numberOfLines={1}>{d.nama.split(' ')[0]}</Text></View>))}
        <View style={komp.chartLegendItem}><View style={[komp.chartLegendDot,{backgroundColor:'#e53935'}]}/><Text style={komp.chartLegendTxt}>≥3%</Text></View>
      </View>
      <View style={komp.chartArea}>
        {[1,2,3].map(sn=>{
          const si=sn-1,hasData=compData.some(d=>d.avgPerShift[si]!==null);
          return(
            <View key={sn} style={komp.shiftGroup}>
              <View style={komp.shiftBarsWrap}>
                {compData.map((d,i)=>{
                  const val=d.avgPerShift[si],barH=val!==null?Math.max((val/maxVal)*90,4):0,isHigh=val!==null&&val>=3;
                  return(
                    <View key={i} style={komp.barWrap}>
                      <Text style={[komp.barValTxt,{color:isHigh?'#e53935':d.color}]}>{val!==null?`${val.toFixed(1)}%`:'—'}</Text>
                      <View style={[komp.barTrack,{height:90}]}>{val!==null&&<View style={[komp.barFill,{height:barH,backgroundColor:isHigh?'#e53935':d.color}]}/>}</View>
                      <View style={[komp.barDot,{backgroundColor:d.color}]}/>
                    </View>
                  );
                })}
              </View>
              <View style={[komp.shiftLabelBox,!hasData&&{opacity:0.4}]}><Text style={komp.shiftLabelTxt}>Shift {sn}</Text></View>
            </View>
          );
        })}
      </View>
      <Text style={komp.chartNote}>Persentase: reject asisten (KG) ÷ output shift (KG) × 100</Text>
    </View>
  );
}

// ─── WinnerCard ───────────────────────────────────────────────────────────────
function WinnerCard({ compData, label='mesin ini' }) {
  if (!compData || compData.length === 0) return null;
  const withPct=compData.filter(d=>d.avgPct!==null);
  if (withPct.length<2) return null;
  const best=withPct.reduce((a,b)=>a.avgPct<b.avgPct?a:b);
  const worst=withPct.reduce((a,b)=>a.avgPct>b.avgPct?a:b);
  if (best.nama===worst.nama) return null;
  return(
    <View style={komp.winnerCard}>
      <View style={komp.winnerHalf}>
        <View style={komp.winnerIconWrap}><Ionicons name="trophy" size={20} color="#F9A825"/></View>
        <View style={{flex:1}}>
          <Text style={komp.winnerLbl}>Performa Terbaik</Text>
          <Text style={[komp.winnerName,{color:best.color}]} numberOfLines={1}>{best.nama}</Text>
          <View style={[komp.winnerPill,{backgroundColor:best.bg,borderColor:best.color}]}><Text style={[komp.winnerPillTxt,{color:best.color}]}>avg {best.avgPct.toFixed(1)}% reject</Text></View>
        </View>
      </View>
      <View style={komp.winnerDivider}/>
      <View style={komp.winnerHalf}>
        <View style={[komp.winnerIconWrap,{backgroundColor:'#FFEBEE'}]}><Ionicons name="trending-up" size={18} color="#e53935"/></View>
        <View style={{flex:1}}>
          <Text style={komp.winnerLbl}>Perlu Perhatian</Text>
          <Text style={[komp.winnerName,{color:worst.color}]} numberOfLines={1}>{worst.nama}</Text>
          <View style={[komp.winnerPill,{backgroundColor:'#FFEBEE',borderColor:'#e53935'}]}><Text style={[komp.winnerPillTxt,{color:'#e53935'}]}>avg {worst.avgPct.toFixed(1)}% reject</Text></View>
        </View>
      </View>
    </View>
  );
}

// ─── Tabel statistik perbandingan ─────────────────────────────────────────────
function StatTable({ compData }) {
  if (!compData || compData.length===0) return null;
  const rows=[
    {label:'Shift Kerja',  getValue:d=>`${d.count}`},
    {label:'Total Reject', getValue:d=>`${d.totalKg.toFixed(2)} KG`},
    {label:'Avg Reject',   getValue:d=>d.avgPct!==null?`${d.avgPct.toFixed(1)}%`:'-'},
    {label:'Shift ≥3%',   getValue:d=>`${d.over3}x`, isWarn:d=>d.over3>0},
    {label:'Avg Shift 1',  getValue:d=>d.avgPerShift[0]!==null?`${d.avgPerShift[0].toFixed(1)}%`:'-'},
    {label:'Avg Shift 2',  getValue:d=>d.avgPerShift[1]!==null?`${d.avgPerShift[1].toFixed(1)}%`:'-'},
    {label:'Avg Shift 3',  getValue:d=>d.avgPerShift[2]!==null?`${d.avgPerShift[2].toFixed(1)}%`:'-'},
  ];
  return(
    <View style={komp.tableCard}>
      <View style={komp.tableHeaderRow}><Ionicons name="stats-chart-outline" size={13} color="#1565C0"/><Text style={komp.tableCardTitle}>Perbandingan Statistik</Text></View>
      <View style={komp.tableColHeaders}>
        <Text style={komp.tableMetricCol}> </Text>
        {compData.map((d,i)=>(<View key={i} style={[komp.tableNameCol,{borderBottomColor:d.color}]}><Text style={[komp.tableNameTxt,{color:d.color}]} numberOfLines={1}>{d.nama.split(' ')[0]}</Text></View>))}
      </View>
      {rows.map((row,ri)=>(
        <View key={ri} style={[komp.tableRow,ri%2===0&&komp.tableRowAlt]}>
          <Text style={komp.tableMetricTxt}>{row.label}</Text>
          {compData.map((d,i)=>{const val=row.getValue(d),warn=row.isWarn?.(d);return(<View key={i} style={komp.tableValCell}><Text style={[komp.tableValTxt,{color:warn?'#e53935':d.color},warn&&{fontWeight:'900'}]}>{val}</Text></View>);})}
        </View>
      ))}
    </View>
  );
}

// ─── AsistenCompactCard ───────────────────────────────────────────────────────
function AsistenCompactCard({ data }) {
  const [open,setOpen]=useState(false);
  const colorIdx = ASISTEN_COLORS.indexOf(data.color);
  const borderColor = colorIdx >= 0 ? ASISTEN_BORDER[colorIdx] : data.color;
  return(
    <View style={[komp.compCard,{borderTopColor:data.color,borderLeftColor:borderColor}]}>
      <TouchableOpacity style={komp.compCardHeader} onPress={()=>setOpen(o=>!o)} activeOpacity={0.85}>
        <View style={[komp.compAvatar,{backgroundColor:data.color}]}><Text style={komp.compAvatarTxt}>{data.nama.charAt(0).toUpperCase()}</Text></View>
        <View style={{flex:1}}>
          <Text style={[komp.compName,{color:data.color}]}>{data.nama}</Text>
          <Text style={komp.compMeta}>{data.count} shift · {data.totalKg.toFixed(2)} KG{data.avgPct!==null?` · avg ${data.avgPct.toFixed(1)}%`:''}</Text>
        </View>
        {data.over3>0&&<View style={komp.compWarnTag}><Ionicons name="warning" size={10} color="#e65100"/><Text style={komp.compWarnTxt}>{data.over3}x ≥3%</Text></View>}
        <ExpandBtn open={open} color={data.color}/>
      </TouchableOpacity>
      {open&&(
        <View style={komp.compBody}>
          {(!data.points||data.points.length===0)
            ? <Text style={komp.compEmpty}>Tidak ada data pada rentang ini</Text>
            : data.points.map((p,i)=><AsistenPointCard key={i} point={p}/>)
          }
        </View>
      )}
    </View>
  );
}

// ─── Modal Picker Asisten ─────────────────────────────────────────────────────
function AsistenPickerModal({ visible, onClose, knownAsistens, selectedOne, onSelectOne, selectedMany, onToggleMany, maxMany=3, mode='single' }) {
  const [q,setQ]=useState('');
  const filtered=useMemo(()=>!q.trim()?knownAsistens:knownAsistens.filter(n=>n.toLowerCase().includes(q.toLowerCase())),[knownAsistens,q]);
  return(
    <Modal visible={visible} transparent animationType="slide">
      <View style={pick.overlay}>
        <View style={pick.sheet}>
          <View style={pick.header}>
            <View>
              <Text style={pick.headerTxt}>Pilih Asisten</Text>
              {mode==='multi'&&<Text style={pick.headerSub}>{(selectedMany||[]).length}/{maxMany} terpilih</Text>}
            </View>
            <TouchableOpacity onPress={()=>{onClose();setQ('');}} style={pick.closeBtn}><Ionicons name="close" size={20} color="#fff"/></TouchableOpacity>
          </View>
          {mode==='multi'&&(selectedMany||[]).length>0&&(
            <View style={pick.chipsRow}>
              {(selectedMany||[]).map((nama,i)=>(<View key={nama} style={[pick.chip,{backgroundColor:ASISTEN_BG[i%ASISTEN_BG.length],borderColor:ASISTEN_COLORS[i%ASISTEN_COLORS.length]}]}><View style={[pick.chipNum,{backgroundColor:ASISTEN_COLORS[i%ASISTEN_COLORS.length]}]}><Text style={pick.chipNumTxt}>{i+1}</Text></View><Text style={[pick.chipName,{color:ASISTEN_COLORS[i%ASISTEN_COLORS.length]}]}>{nama}</Text></View>))}
            </View>
          )}
          <View style={pick.searchRow}>
            <Ionicons name="search-outline" size={16} color="#aaa"/>
            <TextInput style={pick.searchInput} placeholder="Cari nama asisten..." placeholderTextColor="#bbb" value={q} onChangeText={setQ} autoFocus autoCapitalize="words"/>
            {q.length>0&&<TouchableOpacity onPress={()=>setQ('')}><Ionicons name="close-circle" size={16} color="#bbb"/></TouchableOpacity>}
          </View>
          <Text style={pick.countTxt}>{filtered.length} asisten ditemukan</Text>
          {filtered.length===0&&q.trim()&&mode==='single'&&(
            <TouchableOpacity style={pick.manualBtn} onPress={()=>{onSelectOne(q.trim());onClose();setQ('');}}>
              <Ionicons name="add-circle-outline" size={16} color="#1565C0"/>
              <Text style={pick.manualTxt}>Cari "{q}" secara manual</Text>
            </TouchableOpacity>
          )}
          <FlatList data={filtered} keyExtractor={item=>item} keyboardShouldPersistTaps="handled"
            renderItem={({item})=>{
              if (mode==='single') {
                const isSel=selectedOne===item;
                return(<TouchableOpacity style={[pick.item,isSel&&pick.itemActive]} onPress={()=>{onSelectOne(item);onClose();setQ('');}}>
                  <View style={pick.itemLeft}><View style={[pick.avatar,isSel&&pick.avatarActive]}><Text style={[pick.avatarTxt,isSel&&pick.avatarTxtActive]}>{item.charAt(0).toUpperCase()}</Text></View><Text style={[pick.itemName,isSel&&pick.itemNameActive]}>{item}</Text></View>
                  {isSel&&<Ionicons name="checkmark-circle" size={18} color="#1565C0"/>}
                </TouchableOpacity>);
              } else {
                const selIdx=(selectedMany||[]).indexOf(item),isSel=selIdx!==-1,isMaxed=!isSel&&(selectedMany||[]).length>=maxMany;
                return(<TouchableOpacity style={[pick.item,isSel&&{backgroundColor:ASISTEN_BG[selIdx%ASISTEN_BG.length]},isMaxed&&{opacity:0.4}]}
                  onPress={()=>{if(!isMaxed){onToggleMany(item);if(!isSel&&(selectedMany||[]).length+1>=maxMany)onClose();}}} disabled={isMaxed}>
                  <View style={pick.itemLeft}>
                    <View style={[pick.avatar,isSel&&{backgroundColor:ASISTEN_COLORS[selIdx%ASISTEN_COLORS.length]}]}>
                      <Text style={[pick.avatarTxt,isSel&&pick.avatarTxtActive]}>{isSel?selIdx+1:item.charAt(0).toUpperCase()}</Text>
                    </View>
                    <Text style={[pick.itemName,isSel&&{color:ASISTEN_COLORS[selIdx%ASISTEN_COLORS.length],fontWeight:'700'}]}>{item}</Text>
                  </View>
                  {isSel?<Ionicons name="checkmark-circle" size={18} color={ASISTEN_COLORS[selIdx%ASISTEN_COLORS.length]}/>:isMaxed?<Text style={{fontSize:10,color:'#ccc'}}>Maks {maxMany}</Text>:null}
                </TouchableOpacity>);
              }
            }}
            ListEmptyComponent={<View style={pick.emptyBox}><Ionicons name="people-outline" size={32} color="#ddd"/><Text style={pick.emptyTxt}>Belum ada data asisten</Text></View>}
          />
        </View>
      </View>
    </Modal>
  );
}

// ─── Modal Picker Mesin ───────────────────────────────────────────────────────
function MesinPickerModal({ visible, onClose, mesinList, selected, onSelect }) {
  const [q,setQ]=useState('');
  const filtered=useMemo(()=>!q.trim()?mesinList:mesinList.filter(m=>m.toLowerCase().includes(q.toLowerCase())),[mesinList,q]);
  return(
    <Modal visible={visible} transparent animationType="slide">
      <View style={pick.overlay}>
        <View style={pick.sheet}>
          <View style={pick.header}>
            <Text style={pick.headerTxt}>Pilih Mesin</Text>
            <TouchableOpacity onPress={()=>{onClose();setQ('');}} style={pick.closeBtn}><Ionicons name="close" size={20} color="#fff"/></TouchableOpacity>
          </View>
          <View style={pick.searchRow}>
            <Ionicons name="search-outline" size={16} color="#aaa"/>
            <TextInput style={pick.searchInput} placeholder="Cari no. mesin..." placeholderTextColor="#bbb" value={q} onChangeText={setQ} autoFocus/>
            {q.length>0&&<TouchableOpacity onPress={()=>setQ('')}><Ionicons name="close-circle" size={16} color="#bbb"/></TouchableOpacity>}
          </View>
          <Text style={pick.countTxt}>{filtered.length} mesin tersedia</Text>
          <FlatList data={filtered} keyExtractor={item=>item} keyboardShouldPersistTaps="handled"
            renderItem={({item})=>{
              const isSel=selected===item;
              return(<TouchableOpacity style={[pick.item,isSel&&pick.itemActive]} onPress={()=>{onSelect(item);onClose();setQ('');}}>
                <View style={pick.itemLeft}>
                  <View style={[pick.mesinIcon,isSel&&{backgroundColor:'#1565C0'}]}><Ionicons name="settings-outline" size={16} color={isSel?'#fff':'#1565C0'}/></View>
                  <Text style={[pick.itemName,isSel&&pick.itemNameActive]}>{item}</Text>
                </View>
                {isSel&&<Ionicons name="checkmark-circle" size={18} color="#1565C0"/>}
              </TouchableOpacity>);
            }}
            ListEmptyComponent={<View style={pick.emptyBox}><Ionicons name="settings-outline" size={32} color="#ddd"/><Text style={pick.emptyTxt}>Tidak ada mesin ditemukan</Text></View>}
          />
        </View>
      </View>
    </Modal>
  );
}

// ─── Panel: Per Asisten Individual ───────────────────────────────────────────
function IndividualPanel({ allDocs, initRangeDocs }) {
  const today=new Date(), weekAgo=new Date(today); weekAgo.setDate(today.getDate()-6);
  const [fromDate,setFromDate]=useState(fmtD(weekAgo));
  const [toDate,setToDate]=useState(fmtD(today));
  const [bagian,setBagian]=useState('');
  const [asisten,setAsisten]=useState('');
  const [loading,setLoading]=useState(false);
  const [rangeDocs,setRangeDocs]=useState(initRangeDocs||[]);
  const [searched,setSearched]=useState(false);
  const [showPicker,setShowPicker]=useState(false);
  const [karyawanList,setKaryawanList]=useState([]);
  const [karyawanLoading,setKaryawanLoading]=useState(false);

  useEffect(()=>{
    if (!bagian) { setKaryawanList([]); setAsisten(''); return; }
    setKaryawanLoading(true);
    setAsisten('');
    fetchAsistenByBagian(bagian)
      .then(list => setKaryawanList(list))
      .catch(e => console.error(e))
      .finally(() => setKaryawanLoading(false));
  },[bagian]);

  const knownAsistens=useMemo(()=>{
    if (karyawanList.length > 0) return karyawanList;
    return extractAsistens([...(allDocs||[]),...(rangeDocs||[])]);
  },[karyawanList,allDocs,rangeDocs]);

  const points=useMemo(()=>(!searched||!asisten.trim())?[]:buildAsistenData(rangeDocs,asisten.trim()),[rangeDocs,asisten,searched]);

  const handleSearch=useCallback(async()=>{
    if(!asisten.trim()) return;
    setLoading(true);setSearched(false);
    try{const docs=await fetchDocsByDates(datesBetween(fromDate,toDate));setRangeDocs(docs);setSearched(true);}
    catch(e){console.error(e);}finally{setLoading(false);}
  },[asisten,fromDate,toDate]);

  const stats=useMemo(()=>{
    if(points.length===0) return null;
    const totalKg=points.reduce((s,p)=>s+p.rejectKg,0);
    const pcts=points.map(p=>p.rejectPct).filter(p=>p!==null);
    return{totalKg,avgPct:pcts.length>0?pcts.reduce((a,b)=>a+b,0)/pcts.length:null,over3:pcts.filter(p=>p>=3).length,trend:getOverallTrend(points.map(p=>p.rejectPct??p.rejectKg)),count:points.length};
  },[points]);

  return(
    <View style={ap.container}>
      <View style={ap.filterCard}>
        <View style={ap.filterHeader}><Ionicons name="person-outline" size={15} color="#1565C0"/><Text style={ap.filterTitle}>Lihat Reject Per Asisten</Text></View>
        <DateRangeRow fromDate={fromDate} toDate={toDate} onFromChange={setFromDate} onToChange={setToDate}/>

        <Text style={ap.fieldLabel}>Bagian Produksi</Text>
        <View style={ap.bagianRow}>
          {(BAGIAN_PRODUKSI||[]).map(b=>(
            <TouchableOpacity key={b.value} style={[ap.bagianBtn, bagian===b.value && ap.bagianBtnActive]} onPress={()=>setBagian(b.value)}>
              <Text style={[ap.bagianBtnTxt, bagian===b.value && ap.bagianBtnTxtActive]}>{b.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={ap.fieldLabel}>Nama Asisten *</Text>
        <TouchableOpacity style={[ap.selector,asisten&&ap.selectorFilled]} onPress={()=>{ if(!bagian){Alert.alert('Pilih bagian produksi dulu');return;} setShowPicker(true);}} activeOpacity={0.8}>
          <Ionicons name="person-outline" size={15} color={asisten?'#1565C0':'#bbb'}/>
          <Text style={[ap.selectorTxt,asisten&&ap.selectorTxtFilled]} numberOfLines={1}>
            {karyawanLoading ? 'Memuat asisten...' : asisten || (bagian ? 'Pilih nama asisten...' : 'Pilih bagian dulu...')}
          </Text>
          {karyawanLoading ? <ActivityIndicator size="small" color="#1565C0"/> : <Ionicons name="chevron-down" size={14} color="#bbb"/>}
        </TouchableOpacity>

        <ActionBtn label="Tampilkan Laporan" icon="search" onPress={handleSearch} disabled={!asisten.trim()||loading} loading={loading}/>
      </View>

      {searched&&!loading&&(points.length===0?(
        <View style={ap.emptyBox}>
          <Ionicons name="person-outline" size={40} color="#ddd"/>
          <Text style={ap.emptyTxt}>Data tidak ditemukan</Text>
          <Text style={ap.emptySub}>{asisten} tidak tercatat di {fromDate} – {toDate}</Text>
        </View>
      ):(
        <>
          <View style={ap.resultHeader}>
            <View style={ap.resultLeft}>
              <View style={ap.personAvatar}><Ionicons name="person" size={18} color="#fff"/></View>
              <View><Text style={ap.resultName}>{asisten}</Text><Text style={ap.resultRange}>{fromDate} — {toDate}</Text></View>
            </View>
            <TrendBadge trend={stats?.trend}/>
          </View>
          {stats && (
            <View style={sc.summaryWrapper}>
              <View style={sc.row}>
                <SummaryStatCard num={stats.count} label="Shift Dikerjakan" accentColor="#185FA5" bgColor="#E6F1FB" iconName="time-outline" footer="Total shift tercatat"/>
                <SummaryStatCard num={stats.totalKg.toFixed(2)} label="Total Reject" unit=" KG" accentColor="#A32D2D" bgColor="#FCEBEB" iconName="alert-circle-outline"/>
              </View>
              {(stats.avgPct !== null || stats.over3 > 0) && (
                <View style={sc.row}>
                  {stats.avgPct !== null && (
                    <SummaryStatCard num={stats.avgPct.toFixed(1)} label="Avg Reject" unit="%" accentColor={stats.avgPct>=3?'#A32D2D':'#3B6D11'} bgColor={stats.avgPct>=3?'#FCEBEB':'#EAF3DE'} iconName="analytics-outline"/>
                  )}
                  {stats.over3 > 0 && (
                    <SummaryStatCard num={stats.over3} label="Shift ≥3%" accentColor="#854F0B" bgColor="#FAEEDA" iconName="warning-outline" footer="Perlu perhatian"/>
                  )}
                </View>
              )}
            </View>
          )}
          <AsitenChart points={points}/>
          <View style={ap.detailHeader}><Text style={ap.detailTitle}>Detail per Shift ({points.length} shift)</Text></View>
          {points.map((p,i)=><AsistenPointCard key={i} point={p}/>)}
        </>
      ))}

      <AsistenPickerModal visible={showPicker} onClose={()=>setShowPicker(false)} knownAsistens={knownAsistens} selectedOne={asisten} onSelectOne={setAsisten} mode="single"/>
    </View>
  );
}

// ─── Panel: Bandingkan Asisten ────────────────────────────────────────────────
function BandingkanPanel({ allDocs, initRangeDocs }) {
  const today=new Date(), weekAgo=new Date(today); weekAgo.setDate(today.getDate()-6);
  const [fromDate,setFromDate]=useState(fmtD(weekAgo));
  const [toDate,setToDate]=useState(fmtD(today));
  const [bagian,setBagian]=useState('');
  const [selected,setSelected]=useState([]);
  const [loading,setLoading]=useState(false);
  const [rangeDocs,setRangeDocs]=useState(initRangeDocs||[]);
  const [searched,setSearched]=useState(false);
  const [showPicker,setShowPicker]=useState(false);
  const [karyawanList,setKaryawanList]=useState([]);
  const [karyawanLoading,setKaryawanLoading]=useState(false);

  useEffect(()=>{
    if (!bagian) { setKaryawanList([]); setSelected([]); return; }
    setKaryawanLoading(true);
    setSelected([]);
    fetchAsistenByBagian(bagian)
      .then(list => setKaryawanList(list))
      .catch(e => console.error(e))
      .finally(() => setKaryawanLoading(false));
  },[bagian]);

  const knownAsistens=useMemo(()=>{
    if (karyawanList.length > 0) return karyawanList;
    return extractAsistens([...(allDocs||[]),...(rangeDocs||[])]);
  },[karyawanList,allDocs,rangeDocs]);

  const toggle=(nama)=>setSelected(prev=>prev.includes(nama)?prev.filter(n=>n!==nama):prev.length>=3?prev:[...prev,nama]);

  const handleCompare=useCallback(async()=>{
    if(selected.length<2) return;
    setLoading(true);setSearched(false);
    try{const docs=await fetchDocsByDates(datesBetween(fromDate,toDate));setRangeDocs(docs);setSearched(true);}
    catch(e){console.error(e);}finally{setLoading(false);}
  },[selected,fromDate,toDate]);

  const compData=useMemo(()=>{
    if(!searched||selected.length===0) return [];
    return selected.map((nama,i)=>{
      const points=buildAsistenData(rangeDocs,nama);
      const totalKg=points.reduce((s,p)=>s+p.rejectKg,0);
      const pcts=points.map(p=>p.rejectPct).filter(p=>p!==null);
      const avgPct=pcts.length>0?pcts.reduce((a,b)=>a+b,0)/pcts.length:null;
      const over3=pcts.filter(p=>p>=3).length;
      const trend=getOverallTrend(points.map(p=>p.rejectPct??p.rejectKg));
      const avgPerShift=[1,2,3].map(sn=>{
        const sp=points.filter(p=>p.shiftNum===sn);
        const sp_pcts=sp.map(p=>p.rejectPct).filter(p=>p!==null);
        if(sp_pcts.length>0) return sp_pcts.reduce((a,b)=>a+b,0)/sp_pcts.length;
        const sp_kgs=sp.map(p=>p.rejectKg);
        if(sp_kgs.length>0) return sp_kgs.reduce((a,b)=>a+b,0)/sp_kgs.length;
        return null;
      });
      return{nama,color:ASISTEN_COLORS[i%ASISTEN_COLORS.length],bg:ASISTEN_BG[i%ASISTEN_BG.length],points,totalKg,avgPct,over3,trend,avgPerShift,count:points.length};
    });
  },[rangeDocs,selected,searched]);

  return(
    <View style={ap.container}>
      <View style={ap.filterCard}>
        <View style={ap.filterHeader}><Ionicons name="git-compare-outline" size={15} color="#1565C0"/><Text style={ap.filterTitle}>Penilaian Performa Asisten</Text></View>
        <Text style={ap.filterSub}>Pilih 2–3 asisten untuk membandingkan performa</Text>
        <DateRangeRow fromDate={fromDate} toDate={toDate} onFromChange={setFromDate} onToChange={setToDate}/>

        <Text style={ap.fieldLabel}>Bagian Produksi</Text>
        <View style={ap.bagianRow}>
          {(BAGIAN_PRODUKSI||[]).map(b=>(
            <TouchableOpacity key={b.value} style={[ap.bagianBtn, bagian===b.value && ap.bagianBtnActive]} onPress={()=>setBagian(b.value)}>
              <Text style={[ap.bagianBtnTxt, bagian===b.value && ap.bagianBtnTxtActive]}>{b.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[ap.fieldLabel,{marginBottom:8}]}>
          Asisten Dipilih <Text style={{color:'#aaa',fontWeight:'400'}}>({selected.length}/3)</Text>
          {karyawanLoading && <Text style={{color:'#1565C0'}}> — Memuat...</Text>}
        </Text>
        <View style={ap.chipsRow}>
          {selected.map((nama,i)=>(
            <View key={nama} style={[ap.chip,{backgroundColor:ASISTEN_BG[i%ASISTEN_BG.length],borderColor:ASISTEN_COLORS[i%ASISTEN_COLORS.length]}]}>
              <View style={[ap.chipNum,{backgroundColor:ASISTEN_COLORS[i%ASISTEN_COLORS.length]}]}><Text style={ap.chipNumTxt}>{i+1}</Text></View>
              <Text style={[ap.chipName,{color:ASISTEN_COLORS[i%ASISTEN_COLORS.length]}]} numberOfLines={1}>{nama}</Text>
              <TouchableOpacity onPress={()=>toggle(nama)} hitSlop={{top:8,bottom:8,left:4,right:4}}>
                <Ionicons name="close-circle" size={15} color={ASISTEN_COLORS[i%ASISTEN_COLORS.length]}/>
              </TouchableOpacity>
            </View>
          ))}
          {selected.length<3&&(
            <TouchableOpacity style={ap.addChip} onPress={()=>{
              if(!bagian){Alert.alert('Pilih bagian produksi dulu');return;}
              setShowPicker(true);
            }}>
              <Ionicons name="add-circle-outline" size={15} color="#1565C0"/>
              <Text style={ap.addChipTxt}>{selected.length===0?'Pilih asisten':'Tambah'}</Text>
            </TouchableOpacity>
          )}
        </View>
        {selected.length<2&&<View style={ap.hintRow}><Ionicons name="information-circle-outline" size={13} color="#90a4ae"/><Text style={ap.hintTxt}>{bagian?'Minimal 2 asisten untuk membandingkan':'Pilih bagian produksi dulu'}</Text></View>}
        <ActionBtn label="Bandingkan Sekarang" icon="git-compare-outline" onPress={handleCompare} disabled={selected.length<2||loading} loading={loading}/>
      </View>

      {searched&&!loading&&compData.length>0&&(
        <>
          <View style={ap.compHeaders}>
            {compData.map((d,i)=>(
              <View key={i} style={[ap.compHeaderCard,{borderTopColor:d.color}]}>
                <View style={[ap.compAvatar,{backgroundColor:d.color}]}><Text style={ap.compAvatarTxt}>{d.nama.charAt(0).toUpperCase()}</Text></View>
                <Text style={[ap.compName,{color:d.color}]} numberOfLines={2}>{d.nama}</Text>
                {d.trend?<TrendBadge trend={d.trend} small/>:<Text style={ap.noDataTxt}>Tidak ada data</Text>}
              </View>
            ))}
          </View>
          <StatTable compData={compData}/>
          <KomparasiChart compData={compData}/>
          <WinnerCard compData={compData}/>
          <Text style={ap.detailTitle}>Detail per Asisten</Text>
          {compData.map((d,i)=><AsistenCompactCard key={i} data={d}/>)}
        </>
      )}

      <AsistenPickerModal visible={showPicker} onClose={()=>setShowPicker(false)} knownAsistens={knownAsistens} selectedMany={selected} onToggleMany={toggle} mode="multi" maxMany={3}/>
    </View>
  );
}

// ─── Panel: Per Mesin ─────────────────────────────────────────────────────────
function PerMesinPanel({ allDocs, initRangeDocs }) {
  const today=new Date(), weekAgo=new Date(today); weekAgo.setDate(today.getDate()-6);
  const [fromDate,setFromDate]=useState(fmtD(weekAgo));
  const [toDate,setToDate]=useState(fmtD(today));
  const [mesin,setMesin]=useState('');
  const [loading,setLoading]=useState(false);
  const [rangeDocs,setRangeDocs]=useState(initRangeDocs||[]);
  const [searched,setSearched]=useState(false);
  const [showMesinPicker,setShowMesinPicker]=useState(false);

  const mesinList=useMemo(()=>extractMesins([...(allDocs||[]),...(rangeDocs||[])]),[allDocs,rangeDocs]);
  const mesinData=useMemo(()=>(!searched||!mesin.trim())?[]:buildMesinData(rangeDocs,mesin),[rangeDocs,mesin,searched]);

  const handleSearch=useCallback(async()=>{
    if(!mesin.trim()) return;
    setLoading(true);setSearched(false);
    try{const docs=await fetchDocsByDates(datesBetween(fromDate,toDate));setRangeDocs(docs);setSearched(true);}
    catch(e){console.error(e);}finally{setLoading(false);}
  },[mesin,fromDate,toDate]);

  const totalAsisten=mesinData.length;
  const totalReject=mesinData.reduce((s,d)=>s+d.totalKg,0);
  const withPct=mesinData.filter(d=>d.avgPct!==null);
  const avgMesin=withPct.length>0?withPct.reduce((s,d)=>s+d.avgPct,0)/withPct.length:null;

  return(
    <View style={ap.container}>
      <View style={ap.filterCard}>
        <View style={ap.filterHeader}><Ionicons name="settings-outline" size={15} color="#1565C0"/><Text style={ap.filterTitle}>Analisis Per Mesin</Text></View>
        <Text style={ap.filterSub}>Pilih 1 mesin untuk melihat performa semua asisten di mesin tersebut</Text>
        <DateRangeRow fromDate={fromDate} toDate={toDate} onFromChange={setFromDate} onToChange={setToDate}/>
        <Text style={ap.fieldLabel}>No. Mesin *</Text>
        <TouchableOpacity style={[ap.selector,mesin&&ap.selectorFilled]} onPress={()=>setShowMesinPicker(true)} activeOpacity={0.8}>
          <Ionicons name="settings-outline" size={15} color={mesin?'#1565C0':'#bbb'}/>
          <Text style={[ap.selectorTxt,mesin&&ap.selectorTxtFilled]} numberOfLines={1}>{mesin||'Pilih no. mesin...'}</Text>
          <Ionicons name="chevron-down" size={14} color="#bbb"/>
        </TouchableOpacity>
        <ActionBtn label="Tampilkan Laporan" icon="search" onPress={handleSearch} disabled={!mesin.trim()||loading} loading={loading}/>
      </View>

      {searched&&!loading&&(mesinData.length===0?(
        <View style={ap.emptyBox}>
          <Ionicons name="settings-outline" size={40} color="#ddd"/>
          <Text style={ap.emptyTxt}>Data tidak ditemukan</Text>
          <Text style={ap.emptySub}>Tidak ada data untuk {mesin} di {fromDate} – {toDate}</Text>
        </View>
      ):(
        <>
          <View style={[ap.resultHeader,{backgroundColor:'#00695C'}]}>
            <View style={ap.resultLeft}>
              <View style={[ap.personAvatar,{backgroundColor:'rgba(255,255,255,0.25)'}]}><Ionicons name="settings" size={18} color="#fff"/></View>
              <View>
                <Text style={ap.resultName}>{mesin}</Text>
                <Text style={ap.resultRange}>{fromDate} — {toDate} · {totalAsisten} asisten</Text>
              </View>
            </View>
          </View>

          <View style={sc.summaryWrapper}>
            <View style={sc.row}>
              <SummaryStatCard num={totalAsisten} label="Asisten Tercatat" accentColor="#185FA5" bgColor="#E6F1FB" iconName="people-outline" footer="Di mesin ini"/>
              <SummaryStatCard num={totalReject.toFixed(2)} label="Total Reject" unit=" KG" accentColor="#A32D2D" bgColor="#FCEBEB" iconName="alert-circle-outline"/>
            </View>
            <View style={sc.row}>
              {avgMesin !== null && (
                <SummaryStatCard num={avgMesin.toFixed(1)} label="Avg Reject" unit="%" accentColor={avgMesin>=3?'#A32D2D':'#3B6D11'} bgColor={avgMesin>=3?'#FCEBEB':'#EAF3DE'} iconName="analytics-outline"/>
              )}
              <SummaryStatCard num={mesinData.filter(d=>d.over3>0).length} label="Asisten ≥3%" accentColor="#854F0B" bgColor="#FAEEDA" iconName="warning-outline" footer="Perlu perhatian"/>
            </View>
          </View>

          <WinnerCard compData={mesinData} label={mesin}/>
          <KomparasiChart compData={mesinData}/>
          <StatTable compData={mesinData}/>
          <Text style={ap.detailTitle}>Performa Asisten di {mesin}</Text>
          {mesinData.map((d,i)=><AsistenCompactCard key={i} data={d}/>)}
        </>
      ))}

      <MesinPickerModal visible={showMesinPicker} onClose={()=>setShowMesinPicker(false)} mesinList={mesinList} selected={mesin} onSelect={setMesin}/>
    </View>
  );
}

// ─── PerAsistenScreen (container sub-tab) ─────────────────────────────────────
function PerAsistenScreen({ allDocs }) {
  const [subMode,setSubMode]=useState('individual');
  const today=new Date(), weekAgo=new Date(today); weekAgo.setDate(today.getDate()-6);
  const [initRangeDocs,setInitRangeDocs]=useState([]);
  const [initLoading,setInitLoading]=useState(true);

  useEffect(()=>{
    fetchDocsByDates(datesBetween(fmtD(weekAgo),fmtD(today)))
      .then(docs=>setInitRangeDocs(docs)).catch(console.error).finally(()=>setInitLoading(false));
  },[]);

  const TABS=[{key:'individual',label:'Per Asisten',icon:'person-outline'},{key:'bandingkan',label:'Bandingkan',icon:'git-compare-outline'},{key:'permesin',label:'Per Mesin',icon:'settings-outline'}];

  return(
    <View style={{flex:1}}>
      <View style={pa.tabBar}>
        {TABS.map(tab=>(
          <TouchableOpacity key={tab.key} style={[pa.tab,subMode===tab.key&&pa.tabActive]} onPress={()=>setSubMode(tab.key)}>
            <Ionicons name={tab.icon} size={13} color={subMode===tab.key?'#fff':'#1565C0'}/>
            <Text style={[pa.tabTxt,subMode===tab.key&&pa.tabTxtActive]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {initLoading?(
        <View style={{flex:1,justifyContent:'center',alignItems:'center'}}><ActivityIndicator size="large" color="#1565C0"/><Text style={{color:'#888',marginTop:10}}>Memuat data...</Text></View>
      ):(
        <ScrollView style={{flex:1}} showsVerticalScrollIndicator={false}>
          {subMode==='individual'&&<IndividualPanel allDocs={allDocs||[]} initRangeDocs={initRangeDocs}/>}
          {subMode==='bandingkan'&&<BandingkanPanel allDocs={allDocs||[]} initRangeDocs={initRangeDocs}/>}
          {subMode==='permesin'&&<PerMesinPanel allDocs={allDocs||[]} initRangeDocs={initRangeDocs}/>}
          <View style={{height:40}}/>
        </ScrollView>
      )}
    </View>
  );
}

// ─── Chart & helpers laporan 1&2 ──────────────────────────────────────────────
const CHART_H2=80;
function GroupChartBox({ pcts }) {
  if (!pcts) return null;
  const valid=pcts.filter(p=>p!==null);
  if(valid.length===0) return null;
  const maxVal=Math.max(3,...valid);
  const trend=getOverallTrend(pcts);
  return(
    <View style={ch.box}>
      <View style={ch.topRow}><Text style={ch.title}>Rata-rata Reject per Shift</Text><TrendBadge trend={trend}/></View>
      <View style={ch.chartRow}>
        {pcts.map((val,idx)=>{
          const barPx=val!==null?Math.max((val/maxVal)*CHART_H2,3):0,isHigh=val!==null&&val>=3;
          let arrow=null;
          if(idx>0&&val!==null&&pcts[idx-1]!==null){
            if(val>pcts[idx-1]+0.01)arrow={name:'arrow-up',color:'#c62828'};
            else if(val<pcts[idx-1]-0.01)arrow={name:'arrow-down',color:'#2e7d32'};
            else arrow={name:'remove-outline',color:'#90a4ae'};
          }
          return(
            <View key={idx} style={ch.barGroup}>
              {arrow&&<View style={ch.arrowWrap}><Ionicons name={arrow.name} size={14} color={arrow.color}/></View>}
              <View style={ch.barCol}>
                <Text style={[ch.valTxt,isHigh&&ch.valHigh]}>{val!==null?`${val.toFixed(1)}%`:'-'}</Text>
                <View style={[ch.track,{height:CHART_H2}]}>{val!==null&&<View style={[ch.fill,{height:barPx,backgroundColor:isHigh?'#e53935':'#1565C0'}]}/>}</View>
                <Text style={ch.lblTxt}>Shift {idx+1}</Text>
              </View>
            </View>
          );
        })}
      </View>
      <Text style={ch.note}>Persentase: reject (KG) ÷ (reject + output) × 100</Text>
    </View>
  );
}

function ShiftDetailRow({ shiftNum, shift }) {
  if(!shift) return null;
  const reject=shiftTotalReject(shift),output=parseNum(shift.outputRaw??shift.output),hasIssue=shift.rows?.some(r=>r.permasalahan||r.downtime);
  return(
    <View style={sd.card}>
      <View style={sd.header}>
        <View style={sd.numBadge}><Text style={sd.numTxt}>S{shiftNum}</Text></View>
        <View style={sd.meta}><Text style={sd.karu}>Karu: <Text style={sd.karuVal}>{shift.karu||'-'}</Text></Text><Text style={sd.out}>{output>0?`${output.toLocaleString('id-ID')} pcs`:'Output: -'}</Text></View>
        <View style={sd.rejectWrap}><Text style={sd.rejectKg}>{reject>0?`${reject.toFixed(2)} KG`:'0 KG'}</Text><Text style={sd.rejectLabel}>Reject</Text></View>
      </View>
      <View style={sd.body}>
        {!hasIssue?(<View style={sd.ok}><Ionicons name="checkmark-circle" size={15} color="#81c784"/><Text style={sd.okTxt}>Tidak ada permasalahan dicatat</Text></View>)
        :(shift.rows||[]).map((row,i)=>{
          if(!row.permasalahan&&!row.downtime) return null;
          const isOpen=row.status==='open';
          return(<View key={i} style={[sd.problem,isOpen&&sd.problemOpen]}>
            <View style={sd.problemTop}><View style={sd.problemNum}><Text style={sd.problemNumTxt}>#{i+1}</Text></View><Text style={sd.asisten}>{row.namaAsisten||'-'}</Text><View style={[sd.pill,isOpen?sd.pillOpen:sd.pillClose]}><Text style={[sd.pillTxt,{color:isOpen?'#c62828':'#2e7d32'}]}>{(row.status||'-').toUpperCase()}</Text></View></View>
            {[['timer-outline','Downtime',row.downtime?`${row.downtime} menit`:null],['warning-outline','Masalah',row.permasalahan],['checkmark-circle-outline','Penanganan',row.penanganan]].filter(([,,v])=>v).map(([icon,lbl,val])=>(<View key={lbl} style={sd.field}><Ionicons name={icon} size={11} color="#888" style={{marginTop:1}}/><Text style={sd.fieldLabel}>{lbl}:</Text><Text style={sd.fieldVal}>{val}</Text></View>))}
          </View>);
        })}
      </View>
    </View>
  );
}

function FormCard({ doc, activeReport }) {
  const [open,setOpen]=useState(false);
  const rawShifts=[1,2,3].map(n=>({num:n,data:doc[`shift${n}`]}));
  const shiftsData=rawShifts.map(s=>getShiftValue(s.data,doc.berat));
  const rawVals=shiftsData.map(s=>s?.value??null);
  const filled=rawShifts.filter(s=>isShiftFilled(s.data));
  const totalReject=filled.reduce((sum,s)=>sum+shiftTotalReject(s.data),0);
  const anyOpen=filled.some(s=>s.data?.rows?.some(r=>r.status==='open'));
  const trend=getOverallTrend(rawVals);
  const hasOver3=shiftsData.some(s=>s?.isPct&&s.value>=3);
  const isWarn=(activeReport===1&&trend&&(trend.id==='naik'||trend.id==='fluktuatif'))||(activeReport===2&&hasOver3);
  return(
    <View style={[fc.card,isWarn&&fc.cardWarn]}>
      <TouchableOpacity style={fc.header} onPress={()=>setOpen(o=>!o)} activeOpacity={0.85}>
        <View style={fc.left}>
          <View style={fc.badgeRow}>
            {trend&&<View style={[fc.badge,{backgroundColor:trend.bg}]}><Ionicons name={trend.icon} size={10} color={trend.color}/><Text style={[fc.badgeTxt,{color:trend.color}]}>{trend.label}</Text></View>}
            {hasOver3&&<View style={[fc.badge,{backgroundColor:'#FFF3E0'}]}><Ionicons name="warning" size={10} color="#e65100"/><Text style={[fc.badgeTxt,{color:'#e65100'}]}>Reject ≥3%</Text></View>}
            {anyOpen&&<View style={[fc.badge,{backgroundColor:'#FCE4EC'}]}><Ionicons name="alert-circle" size={10} color="#c62828"/><Text style={[fc.badgeTxt,{color:'#c62828'}]}>OPEN</Text></View>}
          </View>
          <Text style={fc.mesin}>{doc.noMesin||'-'}</Text>
          <Text style={fc.produk} numberOfLines={1}>{doc.namaProduk||doc.kodeProduk||'-'}</Text>
        </View>
        <View style={fc.right}>
          <Text style={fc.totalVal}>{totalReject.toFixed(2)}</Text><Text style={fc.totalUnit}>KG Reject</Text>
          <ExpandBtn open={open}/>
        </View>
      </TouchableOpacity>
      {!open&&(<View style={fc.pills}>{rawShifts.map((s,i)=>{const sv=shiftsData[i],rej=shiftTotalReject(s.data),high=sv?.isPct&&sv.value>=3,empty=!isShiftFilled(s.data);return(<View key={s.num} style={[fc.pill,high&&fc.pillHigh,empty&&fc.pillEmpty]}><Text style={fc.pillLbl}>S{s.num}</Text>{empty?<Text style={fc.pillDash}>—</Text>:<><Text style={[fc.pillKg,high&&fc.pillRed]}>{rej>0?`${rej.toFixed(1)}kg`:'0'}</Text>{sv?.isPct&&<Text style={[fc.pillPct,high&&fc.pillRed]}>{sv.value.toFixed(1)}%</Text>}</>}</View>);})}</View>)}
      {open&&(<View style={fc.detail}><Text style={fc.detailTitle}>Catatan per Shift</Text>{filled.map(s=><ShiftDetailRow key={s.num} shiftNum={s.num} shift={s.data}/>)}</View>)}
    </View>
  );
}

function DateGroup({ dateLabel, docs, defaultOpen, activeReport }) {
  const [open,setOpen]=useState(defaultOpen);
  const safeDocs = docs || [];
  const totalReject=safeDocs.reduce((sum,d)=>sum+[1,2,3].reduce((s2,n)=>s2+shiftTotalReject(d[`shift${n}`]),0),0);
  const groupPcts=[1,2,3].map(n=>{let tot=0,cnt=0;safeDocs.forEach(d=>{const sv=getShiftValue(d[`shift${n}`],d.berat);if(sv){tot+=sv.value;cnt++;}});return cnt>0?tot/cnt:null;});
  const trend=getOverallTrend(groupPcts);
  return(
    <View style={dg.wrapper}>
      <TouchableOpacity style={dg.header} onPress={()=>setOpen(o=>!o)} activeOpacity={0.85}>
        <View style={dg.left}><Text style={dg.date}>{dateLabel}</Text><Text style={dg.sub}>{safeDocs.length} form · {totalReject.toFixed(2)} KG reject</Text></View>
        <View style={dg.right}><TrendBadge trend={trend}/><Ionicons name={open?'chevron-up':'chevron-down'} size={16} color="rgba(255,255,255,0.8)"/></View>
      </TouchableOpacity>
      {open && (
        <View style={dg.body}>
          <GroupChartBox pcts={groupPcts}/>
          {Object.entries(
            safeDocs.reduce((acc, doc) => {
              const bagian = doc.bagianProduksi || 'LAINNYA';
              if (!acc[bagian]) acc[bagian] = [];
              acc[bagian].push(doc);
              return acc;
            }, {})
          ).map(([bagian, list]) => (
            <View key={bagian} style={{ marginBottom: 10 }}>
              <Text style={{ fontWeight: '700', color: '#1565C0', marginBottom: 6, marginTop: 4 }}>
                {bagian}
              </Text>
              {(list||[]).map(d => (
                <FormCard key={d.id} doc={d} activeReport={activeReport}/>
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Main ReportScreen ────────────────────────────────────────────────────────
const MODES=[{key:'harian',label:'Hari Ini'},{key:'mingguan',label:'Minggu Ini'},{key:'bulanan',label:'Bulan Ini'},{key:'tahunan',label:'Tahun Ini'}];
const REPORT_TYPES=[{id:1,label:'Trend Shift',icon:'trending-up'},{id:2,label:'Reject ≥3%',icon:'warning'},{id:3,label:'Perbandingan',icon:'people'}];

export default function ReportScreen() {
  const [activeReport, setActiveReport] = useState(1);
  const [mode,         setMode]         = useState('tahunan');
  const [docs,         setDocs]         = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [lastFetch,    setLastFetch]    = useState(null);
  const [filterBagian, setFilterBagian] = useState('');
  const [fromDate,     setFromDate]     = useState('');
  const [toDate,       setToDate]       = useState('');

  const fetchData = useCallback(async (selectedMode) => {
    setLoading(true);
    try {
      let allDocs = [];
      if (selectedMode === 'tahunan') {
        const year = new Date().getFullYear();
        const snap = await getDocs(collection(db, 'form_produksi'));
        allDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .filter(d => {
            const p = (d.tanggal || '').split('/');
            return p.length === 3 && parseInt(p[2]) === year;
          });
      } else {
        allDocs = await fetchDocsByDates(getDateRange(selectedMode));
      }
      const map = {};
      allDocs.forEach(doc => {
        const key = `${doc.tanggal}_${doc.noMesin}_${doc.kodeProduk || doc.namaProduk}`;
        if (!map[key]) {
          map[key] = { ...doc };
        } else {
          if (isShiftFilled(doc.shift1)) map[key].shift1 = doc.shift1;
          if (isShiftFilled(doc.shift2)) map[key].shift2 = doc.shift2;
          if (isShiftFilled(doc.shift3)) map[key].shift3 = doc.shift3;
          if (doc.berat && !map[key].berat) map[key].berat = doc.berat;
        }
      });
      setDocs(Object.values(map));
      setLastFetch(new Date());
    } catch (e) {
      console.error('fetchData error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // BUG FIX: Fetch otomatis saat masuk laporan 1 & 2
  useEffect(() => {
    if (activeReport !== 3) {
      fetchData('tahunan');
    }
  }, [activeReport, fetchData]);

  // Ganti mode → reset filter tanggal kustom
  const handleModeChange = (newMode) => {
    setMode(newMode);
    setFromDate('');
    setToDate('');
  };

  // Filter
  const filteredDocs = useMemo(() => {
    if (!docs || docs.length === 0) return [];
    let result = docs;
    if (activeReport === 2) {
      result = docs.filter(d =>
        [1,2,3].some(n => {
          const sv = getShiftValue(d[`shift${n}`], d.berat);
          return sv?.isPct && sv.value >= 3;
        })
      );
    }
    if (filterBagian) {
      result = result.filter(doc => doc.bagianProduksi === filterBagian);
    }
    if (fromDate && toDate) {
      const from = parseDate(fromDate).getTime();
      const to   = parseDate(toDate).getTime();
      result = result.filter(doc => {
        const t = parseDate(doc.tanggal).getTime();
        return t >= from && t <= to;
      });
    }
    return result;
  }, [docs, activeReport, filterBagian, fromDate, toDate]);

  // BUG FIX: stats dideklarasikan dengan useMemo di sini (sebelumnya TIDAK ADA → crash)
  const stats = useMemo(() => {
    if (!filteredDocs || filteredDocs.length === 0) {
      return { total: 0, totalReject: 0, naikCount: 0, fluktCount: 0, turunCount: 0, over3Count: 0 };
    }
    const total = filteredDocs.length;
    const totalReject = filteredDocs.reduce((sum, d) =>
      sum + [1,2,3].reduce((s2, n) => s2 + shiftTotalReject(d[`shift${n}`]), 0), 0
    );
    let naikCount = 0, fluktCount = 0, turunCount = 0, over3Count = 0;
    filteredDocs.forEach(doc => {
      const vals = [1,2,3].map(n => getShiftValue(doc[`shift${n}`], doc.berat)?.value ?? null);
      const trend = getOverallTrend(vals);
      if (trend?.id === 'naik') naikCount++;
      else if (trend?.id === 'fluktuatif') fluktCount++;
      else if (trend?.id === 'turun') turunCount++;
      const hasOver3 = [1,2,3].some(n => {
        const sv = getShiftValue(doc[`shift${n}`], doc.berat);
        return sv?.isPct && sv.value >= 3;
      });
      if (hasOver3) over3Count++;
    });
    return { total, totalReject, naikCount, fluktCount, turunCount, over3Count };
  }, [filteredDocs]);

  // BUG FIX: grouped diurutkan berdasarkan bulan/tahun dengan benar
  const grouped = useMemo(() => {
    if (!filteredDocs || filteredDocs.length === 0) return [];

    const map = {};
    filteredDocs.forEach(doc => {
      const tgl = doc?.tanggal;
      if (!tgl) return;
      const p = tgl.split('/');
      if (p.length !== 3) return;
      const [dd, mm, yy] = p;
      const bulanKey = `${mm}/${yy}`;
      if (!map[bulanKey]) map[bulanKey] = {};
      if (!map[bulanKey][tgl]) map[bulanKey][tgl] = [];
      map[bulanKey][tgl].push(doc);
    });

    const bulan = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agt','Sep','Okt','Nov','Des'];

    // BUG FIX: Urutkan bulan dari terbaru ke terlama
    return Object.entries(map)
      .sort((a, b) => {
        const [mmA, yyA] = a[0].split('/').map(Number);
        const [mmB, yyB] = b[0].split('/').map(Number);
        if (yyB !== yyA) return yyB - yyA;
        return mmB - mmA;
      })
      .map(([bulanKey, tanggalMap]) => {
        const [mm, yy] = bulanKey.split('/');
        // Urutkan tanggal dari terbaru ke terlama
        const sortedDates = Object.entries(tanggalMap || {})
          .sort((a, b) => {
            const tA = parseDate(a[0]).getTime();
            const tB = parseDate(b[0]).getTime();
            return tB - tA;
          })
          .map(([tgl, docs]) => ({ label: tgl, docs: docs || [] }));

        return {
          label: `${bulan[parseInt(mm)-1] || ''} ${yy}`,
          dates: sortedDates,
        };
      });
  }, [filteredDocs]);

  const hasActiveFilter = !!filterBagian || (!!fromDate && !!toDate);

  return (
    <View style={s.container}>

      {/* Header */}
      <View style={s.header}>
        <View style={s.headerBadge}>
          <Ionicons name="bar-chart" size={12} color="#90CAF9"/>
          <Text style={s.headerBadgeTxt}>LAPORAN ANALISIS</Text>
        </View>
        <Text style={s.headerTitle}>{REPORT_TYPES.find(r => r.id === activeReport)?.label || 'Laporan'}</Text>
        {lastFetch && activeReport <= 2 && (
          <Text style={s.headerSub}>
            Diperbarui {lastFetch.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        )}
      </View>

      {/* Tab tipe laporan */}
      <View style={s.reportBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.reportBarInner}>
          {REPORT_TYPES.map(rt => (
            <TouchableOpacity
              key={rt.id}
              style={[s.reportTab, activeReport === rt.id && s.reportTabActive]}
              onPress={() => setActiveReport(rt.id)}
            >
              <Ionicons name={rt.icon} size={13} color={activeReport === rt.id ? '#fff' : '#1565C0'}/>
              <Text style={[s.reportTabTxt, activeReport === rt.id && s.reportTabTxtActive]}>{rt.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {activeReport === 3 ? (
        <PerAsistenScreen allDocs={docs}/>
      ) : (
        <>
          {loading ? (
            <View style={s.center}>
              <ActivityIndicator size="large" color="#1565C0"/>
              <Text style={s.loadTxt}>Memuat data...</Text>
            </View>
          ) : (
            <ScrollView
              style={s.scroll}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={loading}
                  onRefresh={() => fetchData('tahunan')}
                  colors={['#1565C0']}
                />
              }
            >
              {/* ══ 1. FILTER CARD ══ */}
              <View style={s.filterCard}>
                <View style={s.filterCardHeader}>
                  <Ionicons name="filter" size={13} color="#1565C0"/>
                  <Text style={s.filterCardTitle}>Filter Laporan</Text>
                  {hasActiveFilter && (
                    <TouchableOpacity
                      onPress={() => { setFilterBagian(''); setFromDate(''); setToDate(''); }}
                      style={s.filterResetBtn}
                    >
                      <Ionicons name="refresh-outline" size={12} color="#e53935"/>
                      <Text style={s.filterResetTxt}>Reset</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <Text style={s.filterSectionLabel}>Bagian Produksi</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                  <View style={s.filterChipsRow}>
                    <TouchableOpacity
                      style={[s.filterChip, !filterBagian && s.filterChipActive]}
                      onPress={() => setFilterBagian('')}
                    >
                      <Text style={[s.filterChipTxt, !filterBagian && s.filterChipTxtActive]}>Semua</Text>
                    </TouchableOpacity>
                    {(BAGIAN_PRODUKSI||[]).map(b => (
                      <TouchableOpacity
                        key={b.value}
                        style={[s.filterChip, filterBagian === b.value && s.filterChipActive]}
                        onPress={() => setFilterBagian(filterBagian === b.value ? '' : b.value)}
                      >
                        <Text style={[s.filterChipTxt, filterBagian === b.value && s.filterChipTxtActive]}>
                          {b.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>

                <Text style={s.filterSectionLabel}>Rentang Tanggal Kustom</Text>
                <Text style={s.filterSectionHint}>
                  Kosongkan untuk pakai periode: {MODES.find(m => m.key === mode)?.label}
                </Text>
                <View style={s.filterDateRow}>
                  <View style={{ flex: 1 }}>
                    <DatePickerInput label="Dari" value={fromDate} onChange={setFromDate}/>
                  </View>
                  <View style={s.filterDateSep}>
                    <Ionicons name="arrow-forward" size={14} color="#bbb"/>
                  </View>
                  <View style={{ flex: 1 }}>
                    <DatePickerInput label="Sampai" value={toDate} onChange={setToDate}/>
                  </View>
                </View>

                {hasActiveFilter && (
                  <View style={s.filterActiveInfo}>
                    <Ionicons name="information-circle-outline" size={13} color="#1565C0"/>
                    <Text style={s.filterActiveInfoTxt}>
                      {filteredDocs.length} dari {docs.length} form
                      {filterBagian ? ` · ${filterBagian}` : ''}
                      {fromDate && toDate ? ` · ${fromDate}–${toDate}` : ''}
                    </Text>
                  </View>
                )}
              </View>

              {/* ══ 2. SUMMARY CARDS ══ */}
              <SummarySection stats={stats} activeReport={activeReport}/>

              {/* ══ 3. LEGEND ══ */}
              <View style={s.legend}>
                <Text style={s.legendTitle}>Keterangan:</Text>
                <View style={s.legendRow}>
                  {[
                    {icon:'trending-up',color:'#c62828',lbl:'Reject naik'},
                    {icon:'pulse',color:'#e65100',lbl:'Fluktuatif'},
                    {icon:'trending-down',color:'#2e7d32',lbl:'Reject turun'}
                  ].map((l, i) => (
                    <View key={i} style={s.legendItem}>
                      <Ionicons name={l.icon} size={12} color={l.color}/>
                      <Text style={s.legendTxt}>{l.lbl}</Text>
                    </View>
                  ))}
                  <View style={s.legendItem}>
                    <View style={s.legendDot}/>
                    <Text style={s.legendTxt}>Reject ≥3%</Text>
                  </View>
                </View>
              </View>

              {/* ══ 4. DATA LIST ══ */}
              {!grouped || grouped.length === 0 ? (
                <View style={s.empty}>
                  <Ionicons name="checkmark-done-circle-outline" size={54} color="#a5d6a7"/>
                  <Text style={s.emptyTxt}>Tidak ada data</Text>
                </View>
              ) : (
                <View style={s.list}>
                  {grouped.map((g, i) => (
                    <View key={i} style={{ marginBottom: 12 }}>
                      <Text style={{ fontWeight: '700', fontSize: 14, color: '#1565C0', marginBottom: 6 }}>
                        {g.label}
                      </Text>
                      {(g.dates || []).map((d, idx) => (
                        <DateGroup
                          key={idx}
                          dateLabel={d.label || '-'}
                          docs={d.docs || []}
                          defaultOpen={idx === 0}
                          activeReport={activeReport}
                        />
                      ))}
                    </View>
                  ))}
                </View>
              )}

              <View style={{ height: 40 }}/>
            </ScrollView>
          )}
        </>
      )}
    </View>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const s=StyleSheet.create({
  filterCard:        { backgroundColor:'#fff', marginHorizontal:14, marginTop:14, marginBottom:4, borderRadius:14, padding:14, elevation:2, shadowColor:'#1565C0', shadowOffset:{width:0,height:1}, shadowOpacity:0.07, shadowRadius:4 },
  filterCardHeader:  { flexDirection:'row', alignItems:'center', gap:7, marginBottom:12 },
  filterCardTitle:   { fontSize:13, fontWeight:'800', color:'#1565C0', flex:1 },
  filterResetBtn:    { flexDirection:'row', alignItems:'center', gap:4, backgroundColor:'#FFEBEE', paddingHorizontal:10, paddingVertical:5, borderRadius:20 },
  filterResetTxt:    { fontSize:11, fontWeight:'700', color:'#e53935' },
  filterSectionLabel:{ fontSize:11, fontWeight:'700', color:'#6B87A8', textTransform:'uppercase', letterSpacing:0.6, marginBottom:8 },
  filterSectionHint: { fontSize:10, color:'#aaa', fontStyle:'italic', marginTop:-5, marginBottom:8 },
  filterChipsRow:    { flexDirection:'row', gap:8, paddingRight:4 },
  filterChip:        { paddingHorizontal:14, paddingVertical:7, borderRadius:20, backgroundColor:'#EEF4FF', borderWidth:1.5, borderColor:'#D0DCF0' },
  filterChipActive:  { backgroundColor:'#1565C0', borderColor:'#1565C0' },
  filterChipTxt:     { fontSize:12, fontWeight:'700', color:'#6B87A8' },
  filterChipTxtActive:{ color:'#fff' },
  filterDateRow:     { flexDirection:'row', alignItems:'flex-end', gap:8 },
  filterDateSep:     { paddingBottom:14, alignItems:'center' },
  filterActiveInfo:  { flexDirection:'row', alignItems:'center', gap:6, backgroundColor:'#EEF4FF', paddingHorizontal:10, paddingVertical:7, borderRadius:8, marginTop:10 },
  filterActiveInfoTxt:{ fontSize:11, color:'#1565C0', fontWeight:'600', flex:1 },
  container:        {flex:1,backgroundColor:'#EEF2F8'},
  header:           {backgroundColor:'#1565C0',paddingHorizontal:20,paddingTop:16,paddingBottom:20,alignItems:'center'},
  headerBadge:      {flexDirection:'row',alignItems:'center',gap:5,backgroundColor:'rgba(255,255,255,0.18)',paddingHorizontal:10,paddingVertical:4,borderRadius:20,marginBottom:6},
  headerBadgeTxt:   {color:'#90CAF9',fontSize:10,fontWeight:'700',letterSpacing:1},
  headerTitle:      {color:'#fff',fontSize:18,fontWeight:'800'},
  headerSub:        {color:'rgba(255,255,255,0.65)',fontSize:11,marginTop:3},
  reportBar:        {backgroundColor:'#fff',borderBottomWidth:1,borderBottomColor:'#E8EDF5'},
  reportBarInner:   {paddingHorizontal:12,paddingVertical:10,gap:8,flexDirection:'row'},
  reportTab:        {flexDirection:'row',alignItems:'center',gap:6,backgroundColor:'#EEF4FF',paddingHorizontal:14,paddingVertical:8,borderRadius:20},
  reportTabActive:  {backgroundColor:'#1565C0'},
  reportTabTxt:     {fontSize:12,fontWeight:'700',color:'#1565C0'},
  reportTabTxtActive:{color:'#fff'},
  scroll:           {flex:1},
  center:           {flex:1,justifyContent:'center',alignItems:'center',padding:40},
  loadTxt:          {color:'#888',marginTop:10,fontSize:13},
  legend:           {marginHorizontal:14,marginBottom:4,backgroundColor:'#fff',borderRadius:10,padding:12,elevation:1},
  legendTitle:      {fontSize:11,fontWeight:'700',color:'#666',marginBottom:6},
  legendRow:        {flexDirection:'row',flexWrap:'wrap',gap:12},
  legendItem:       {flexDirection:'row',alignItems:'center',gap:4},
  legendDot:        {width:10,height:10,borderRadius:2,backgroundColor:'#FFF3E0',borderWidth:1,borderColor:'#e65100'},
  legendTxt:        {fontSize:11,color:'#666'},
  list:             {paddingHorizontal:12,paddingTop:8,paddingBottom:8,gap:10},
  empty:            {alignItems:'center',paddingVertical:60,paddingHorizontal:24,gap:8},
  emptyTxt:         {fontSize:16,fontWeight:'700',color:'#90a4ae'},
  emptySub:         {fontSize:12,color:'#bbb',textAlign:'center'},
});

const sc=StyleSheet.create({
  summaryWrapper:{paddingHorizontal:14,paddingTop:14,paddingBottom:4,gap:10},
  row:{flexDirection:'row',gap:10},
  sectionLabelRow:{flexDirection:'row',alignItems:'center',gap:8,marginBottom:2},
  sectionLabelLine:{flex:1,height:1,backgroundColor:'#D8E4F0'},
  sectionLabelTxt:{fontSize:10,fontWeight:'700',color:'#6B87A8',letterSpacing:0.8,textTransform:'uppercase'},
  card:{flex:1,backgroundColor:'#fff',borderRadius:12,padding:14,borderTopWidth:3,borderTopColor:'#185FA5',borderLeftWidth:1,borderLeftColor:'#E8EDF5',borderRightWidth:1,borderRightColor:'#E8EDF5',borderBottomWidth:1,borderBottomColor:'#E8EDF5',elevation:2,shadowColor:'#1565C0',shadowOffset:{width:0,height:2},shadowOpacity:0.07,shadowRadius:4,gap:4},
  iconWrap:{width:30,height:30,borderRadius:8,justifyContent:'center',alignItems:'center',marginBottom:4},
  cardLabel:{fontSize:11,fontWeight:'600',color:'#6B87A8',lineHeight:14},
  valueRow:{flexDirection:'row',alignItems:'baseline',gap:2},
  cardValue:{fontSize:24,fontWeight:'800',lineHeight:28},
  cardUnit:{fontSize:12,fontWeight:'700'},
  cardFooter:{fontSize:10,color:'#9BAEC2',marginTop:2},
  trendRow:{flexDirection:'row',gap:10},
  trendCard:{flex:1,backgroundColor:'#fff',borderRadius:12,padding:12,alignItems:'center',borderTopWidth:3,borderWidth:1,borderColor:'#E8EDF5',elevation:2,shadowColor:'#000',shadowOffset:{width:0,height:1},shadowOpacity:0.06,shadowRadius:3,gap:5},
  trendIconWrap:{width:36,height:36,borderRadius:18,justifyContent:'center',alignItems:'center'},
  trendNum:{fontSize:22,fontWeight:'800',lineHeight:26},
  trendLabel:{fontSize:10,fontWeight:'600',color:'#6B87A8',textAlign:'center',lineHeight:13},
});

const pa=StyleSheet.create({
  tabBar:{flexDirection:'row',margin:12,marginBottom:0,backgroundColor:'#fff',borderRadius:12,padding:4,elevation:2,shadowColor:'#000',shadowOffset:{width:0,height:1},shadowOpacity:0.07,shadowRadius:3},
  tab:{flex:1,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:5,paddingVertical:10,borderRadius:9},
  tabActive:{backgroundColor:'#1565C0'},
  tabTxt:{fontSize:11,fontWeight:'700',color:'#1565C0'},
  tabTxtActive:{color:'#fff'},
});

const ap=StyleSheet.create({
  bagianRow:{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:14},
  bagianBtn:{paddingHorizontal:14,paddingVertical:8,borderRadius:20,borderWidth:1.5,borderColor:'#D0DCF0',backgroundColor:'#F8FAFF'},
  bagianBtnActive:{borderColor:'#1565C0',backgroundColor:'#1565C0'},
  bagianBtnTxt:{fontSize:12,fontWeight:'700',color:'#888'},
  bagianBtnTxtActive:{color:'#fff'},
  container:{padding:12,gap:12},
  filterCard:{backgroundColor:'#fff',borderRadius:14,padding:16,elevation:3,shadowColor:'#1565C0',shadowOffset:{width:0,height:2},shadowOpacity:0.09,shadowRadius:6},
  filterHeader:{flexDirection:'row',alignItems:'center',gap:8,marginBottom:4},
  filterTitle:{fontSize:14,fontWeight:'800',color:'#1565C0'},
  filterSub:{fontSize:11,color:'#888',marginBottom:14,marginLeft:24},
  fieldLabel:{fontSize:12,fontWeight:'700',color:'#444',marginBottom:6},
  selector:{flexDirection:'row',alignItems:'center',gap:10,borderWidth:1.5,borderColor:'#D0DCF0',borderRadius:10,paddingHorizontal:12,paddingVertical:12,backgroundColor:'#F8FAFF',marginBottom:14},
  selectorFilled:{borderColor:'#1565C0',backgroundColor:'#EEF4FF'},
  selectorTxt:{flex:1,fontSize:14,color:'#aaa'},
  selectorTxtFilled:{color:'#1565C0',fontWeight:'700'},
  chipsRow:{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:10},
  chip:{flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:10,paddingVertical:7,borderRadius:20,borderWidth:1.5,maxWidth:160},
  chipNum:{width:20,height:20,borderRadius:10,justifyContent:'center',alignItems:'center'},
  chipNumTxt:{color:'#fff',fontSize:10,fontWeight:'800'},
  chipName:{fontSize:12,fontWeight:'700',flex:1},
  addChip:{flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:12,paddingVertical:8,borderRadius:20,borderWidth:1.5,borderColor:'#1565C0',borderStyle:'dashed',backgroundColor:'#EEF4FF'},
  addChipTxt:{fontSize:12,fontWeight:'700',color:'#1565C0'},
  hintRow:{flexDirection:'row',alignItems:'center',gap:5,marginBottom:14},
  hintTxt:{fontSize:11,color:'#90a4ae',fontStyle:'italic'},
  emptyBox:{backgroundColor:'#fff',borderRadius:14,padding:32,alignItems:'center',gap:10,elevation:2},
  emptyTxt:{fontSize:15,fontWeight:'700',color:'#90a4ae'},
  emptySub:{fontSize:12,color:'#bbb',textAlign:'center',lineHeight:18},
  resultHeader:{backgroundColor:'#1565C0',borderRadius:12,padding:14,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  resultLeft:{flexDirection:'row',alignItems:'center',gap:12,flex:1},
  personAvatar:{backgroundColor:'rgba(255,255,255,0.2)',width:40,height:40,borderRadius:20,justifyContent:'center',alignItems:'center'},
  resultName:{color:'#fff',fontSize:16,fontWeight:'800'},
  resultRange:{color:'rgba(255,255,255,0.7)',fontSize:11,marginTop:2},
  compHeaders:{flexDirection:'row',gap:8},
  compHeaderCard:{flex:1,backgroundColor:'#fff',borderRadius:12,padding:12,alignItems:'center',borderTopWidth:3,elevation:2,shadowColor:'#000',shadowOffset:{width:0,height:1},shadowOpacity:0.06,shadowRadius:3},
  compAvatar:{width:40,height:40,borderRadius:20,justifyContent:'center',alignItems:'center',marginBottom:8},
  compAvatarTxt:{color:'#fff',fontSize:18,fontWeight:'800'},
  compName:{fontSize:12,fontWeight:'800',textAlign:'center',marginBottom:6},
  noDataTxt:{fontSize:9,color:'#ccc',fontStyle:'italic'},
  detailHeader:{paddingHorizontal:2,paddingTop:4,paddingBottom:8},
  detailTitle:{fontSize:12,fontWeight:'700',color:'#546e7a',textTransform:'uppercase',letterSpacing:0.5,paddingHorizontal:2,marginBottom:4},
});

const sh=StyleSheet.create({
  expandBtn:{padding:5,backgroundColor:'#F0F4FA',borderRadius:8,borderWidth:1,borderColor:'#E8EDF5'},
  trendBadge:{flexDirection:'row',alignItems:'center',gap:4,paddingHorizontal:8,paddingVertical:4,borderRadius:8},
  trendBadgeSm:{paddingHorizontal:6,paddingVertical:3},
  trendTxt:{fontSize:10,fontWeight:'700'},
  trendTxtSm:{fontSize:9},
  dateRow:{flexDirection:'row',alignItems:'flex-end',gap:8,marginBottom:14},
  dateSep:{paddingBottom:14,alignItems:'center'},
  actionBtn:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,backgroundColor:'#1565C0',paddingVertical:14,borderRadius:12,elevation:3,shadowColor:'#1565C0',shadowOffset:{width:0,height:3},shadowOpacity:0.3,shadowRadius:6},
  actionBtnDisabled:{backgroundColor:'#B0BEC5',elevation:0,shadowOpacity:0},
  actionBtnTxt:{color:'#fff',fontSize:15,fontWeight:'800'},
});

const dg=StyleSheet.create({
  wrapper:{backgroundColor:'#fff',borderRadius:14,overflow:'hidden',elevation:3,shadowColor:'#1565C0',shadowOffset:{width:0,height:2},shadowOpacity:0.1,shadowRadius:6},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',backgroundColor:'#1565C0',paddingHorizontal:16,paddingVertical:13},
  left:{flex:1},
  date:{color:'#fff',fontSize:15,fontWeight:'800'},
  sub:{color:'rgba(255,255,255,0.7)',fontSize:11,marginTop:2},
  right:{flexDirection:'row',alignItems:'center',gap:8},
  body:{backgroundColor:'#F8FAFC',paddingHorizontal:10,paddingVertical:10,gap:8},
});

const fc=StyleSheet.create({
  card:{backgroundColor:'#fff',borderRadius:10,overflow:'hidden',borderLeftWidth:3,borderLeftColor:'#CFD8DC',elevation:1,shadowColor:'#000',shadowOffset:{width:0,height:1},shadowOpacity:0.05,shadowRadius:2},
  cardWarn:{borderLeftColor:'#e53935'},
  header:{flexDirection:'row',justifyContent:'space-between',padding:12,alignItems:'flex-start'},
  left:{flex:1,marginRight:8},
  badgeRow:{flexDirection:'row',flexWrap:'wrap',gap:5,marginBottom:6},
  badge:{flexDirection:'row',alignItems:'center',gap:3,paddingHorizontal:6,paddingVertical:3,borderRadius:6},
  badgeTxt:{fontSize:9,fontWeight:'700'},
  mesin:{fontSize:14,fontWeight:'800',color:'#1565C0'},
  produk:{fontSize:11,color:'#666',marginTop:2},
  right:{alignItems:'flex-end'},
  totalVal:{fontSize:20,fontWeight:'800',color:'#e53935'},
  totalUnit:{fontSize:9,color:'#aaa',marginTop:1},
  pills:{flexDirection:'row',gap:6,paddingHorizontal:12,paddingBottom:10},
  pill:{flex:1,backgroundColor:'#F0F4FA',borderRadius:8,paddingVertical:7,alignItems:'center'},
  pillHigh:{backgroundColor:'#FFEBEE'},
  pillEmpty:{backgroundColor:'#F5F5F5',opacity:0.7},
  pillLbl:{fontSize:9,fontWeight:'700',color:'#888',marginBottom:2},
  pillDash:{fontSize:14,color:'#ccc'},
  pillKg:{fontSize:12,fontWeight:'800',color:'#333'},
  pillPct:{fontSize:10,color:'#777'},
  pillRed:{color:'#e53935'},
  detail:{backgroundColor:'#F8FAFC',borderTopWidth:1,borderTopColor:'#EEF0F2',paddingHorizontal:10,paddingBottom:10},
  detailTitle:{fontSize:11,fontWeight:'700',color:'#888',paddingTop:10,paddingBottom:6,paddingHorizontal:2,textTransform:'uppercase',letterSpacing:0.5},
});

const sd=StyleSheet.create({
  card:{backgroundColor:'#fff',borderRadius:8,overflow:'hidden',borderLeftWidth:3,borderLeftColor:'#42A5F5',marginBottom:6,elevation:1,shadowColor:'#000',shadowOffset:{width:0,height:1},shadowOpacity:0.04,shadowRadius:2},
  header:{flexDirection:'row',alignItems:'center',gap:10,padding:11},
  numBadge:{backgroundColor:'#1565C0',width:28,height:28,borderRadius:14,justifyContent:'center',alignItems:'center'},
  numTxt:{color:'#fff',fontSize:11,fontWeight:'800'},
  meta:{flex:1},
  karu:{fontSize:11,color:'#888'},
  karuVal:{fontWeight:'700',color:'#222'},
  out:{fontSize:10,color:'#aaa',marginTop:1},
  rejectWrap:{alignItems:'flex-end'},
  rejectKg:{fontSize:13,fontWeight:'800',color:'#333'},
  rejectLabel:{fontSize:9,color:'#aaa'},
  body:{paddingHorizontal:11,paddingBottom:10,borderTopWidth:1,borderTopColor:'#F0F4F8'},
  ok:{flexDirection:'row',alignItems:'center',gap:6,backgroundColor:'#F1F8E9',padding:8,borderRadius:6,marginTop:8},
  okTxt:{fontSize:11,color:'#558b2f'},
  problem:{backgroundColor:'#F8FAFC',borderRadius:7,padding:10,marginTop:8,borderLeftWidth:2,borderLeftColor:'#90CAF9'},
  problemOpen:{borderLeftColor:'#e53935',backgroundColor:'#FFF5F5'},
  problemTop:{flexDirection:'row',alignItems:'center',gap:6,marginBottom:6,flexWrap:'wrap'},
  problemNum:{backgroundColor:'#E3F2FD',paddingHorizontal:7,paddingVertical:2,borderRadius:4},
  problemNumTxt:{fontSize:10,fontWeight:'800',color:'#1565C0'},
  asisten:{fontSize:11,fontWeight:'700',color:'#333',flex:1},
  pill:{paddingHorizontal:7,paddingVertical:2,borderRadius:5},
  pillOpen:{backgroundColor:'#FFEBEE'},
  pillClose:{backgroundColor:'#E8F5E9'},
  pillTxt:{fontSize:9,fontWeight:'800'},
  field:{flexDirection:'row',gap:5,marginTop:4,alignItems:'flex-start'},
  fieldLabel:{fontSize:11,fontWeight:'700',color:'#666'},
  fieldVal:{fontSize:11,color:'#333',flex:1,lineHeight:16},
});

const ch=StyleSheet.create({
  box:{backgroundColor:'#fff',borderRadius:10,padding:14,marginBottom:4,borderWidth:1,borderColor:'#E8EDF5',elevation:1},
  topRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:16},
  title:{fontSize:12,fontWeight:'800',color:'#1565C0'},
  chartRow:{flexDirection:'row',alignItems:'flex-end',justifyContent:'space-around'},
  barGroup:{flexDirection:'row',alignItems:'flex-end',flex:1},
  arrowWrap:{paddingBottom:20,paddingHorizontal:4,alignItems:'center'},
  barCol:{flex:1,alignItems:'center'},
  valTxt:{fontSize:10,fontWeight:'800',color:'#444',marginBottom:4},
  valHigh:{color:'#e53935'},
  track:{width:30,backgroundColor:'#EEF4FF',borderRadius:6,justifyContent:'flex-end',overflow:'hidden'},
  fill:{width:'100%',borderRadius:6},
  lblTxt:{fontSize:10,fontWeight:'700',color:'#666',marginTop:6},
  note:{fontSize:9,color:'#aaa',textAlign:'center',marginTop:8},
});

const ach=StyleSheet.create({
  box:{backgroundColor:'#fff',borderRadius:12,padding:14,elevation:2,shadowColor:'#1565C0',shadowOffset:{width:0,height:1},shadowOpacity:0.08,shadowRadius:4,borderWidth:1,borderColor:'#E8EDF5'},
  topRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:8},
  title:{fontSize:12,fontWeight:'800',color:'#1565C0'},
  legendRow:{flexDirection:'row',gap:12,marginBottom:12,flexWrap:'wrap'},
  legendItem:{flexDirection:'row',alignItems:'center',gap:4},
  legendDot:{width:10,height:10,borderRadius:5},
  legendTxt:{fontSize:10,color:'#666'},
  barsRow:{flexDirection:'row',alignItems:'flex-end',paddingTop:4},
  barWrap:{alignItems:'center',paddingHorizontal:4,minWidth:56},
  valTxt:{fontSize:9,fontWeight:'800',color:'#444',marginBottom:4,textAlign:'center'},
  valHigh:{color:'#e53935'},
  track:{width:28,backgroundColor:'#EEF4FF',borderRadius:6,justifyContent:'flex-end',overflow:'hidden'},
  fill:{width:'100%',borderRadius:6},
  dateTxt:{fontSize:8,color:'#888',marginTop:5,textAlign:'center'},
  shiftDot:{marginTop:3,paddingHorizontal:6,paddingVertical:2,borderRadius:8,alignItems:'center'},
  shiftDotTxt:{fontSize:8,fontWeight:'800',color:'#fff'},
  threshRow:{flexDirection:'row',alignItems:'center',gap:8,marginTop:8},
  threshLine:{flex:1,height:1,backgroundColor:'#ffcdd2'},
  threshTxt:{fontSize:9,color:'#e53935',fontWeight:'600'},
  note:{fontSize:9,color:'#aaa',textAlign:'center',marginTop:6},
});

const apc=StyleSheet.create({
  card:{backgroundColor:'#fff',borderRadius:10,overflow:'hidden',borderLeftWidth:3,borderLeftColor:'#1565C0',elevation:1,shadowColor:'#000',shadowOffset:{width:0,height:1},shadowOpacity:0.05,shadowRadius:2},
  cardWarn:{borderLeftColor:'#e53935'},
  cardOpen:{borderLeftColor:'#e53935'},
  header:{flexDirection:'row',justifyContent:'space-between',padding:12,alignItems:'flex-start'},
  left:{flex:1,marginRight:10},
  shiftRow:{flexDirection:'row',alignItems:'center',gap:6,marginBottom:5},
  shiftBadge:{paddingHorizontal:10,paddingVertical:3,borderRadius:8},
  shiftTxt:{fontSize:11,fontWeight:'800',color:'#fff'},
  openBadge:{flexDirection:'row',alignItems:'center',gap:3,backgroundColor:'#FFEBEE',paddingHorizontal:7,paddingVertical:3,borderRadius:6},
  openTxt:{fontSize:9,color:'#c62828',fontWeight:'800'},
  tanggal:{fontSize:13,fontWeight:'700',color:'#222'},
  mesin:{fontSize:11,fontWeight:'700',color:'#1565C0',marginTop:2},
  produk:{fontSize:10,color:'#888',marginTop:1},
  karu:{fontSize:10,color:'#aaa',marginTop:1},
  right:{alignItems:'flex-end'},
  pct:{fontSize:22,fontWeight:'800',color:'#333'},
  pctHigh:{color:'#e53935'},
  pctLabel:{fontSize:9,color:'#aaa'},
  kg:{fontSize:11,color:'#888',marginTop:1},
  output:{fontSize:9,color:'#aaa',marginTop:2},
  body:{backgroundColor:'#F8FAFC',borderTopWidth:1,borderTopColor:'#EEF0F2',paddingHorizontal:12,paddingBottom:12},
  bodyTitle:{fontSize:11,fontWeight:'700',color:'#888',paddingTop:10,paddingBottom:8,textTransform:'uppercase',letterSpacing:0.5},
  row:{backgroundColor:'#fff',borderRadius:8,padding:10,marginBottom:6,borderLeftWidth:2,borderLeftColor:'#90CAF9'},
  rowOpen:{borderLeftColor:'#e53935',backgroundColor:'#FFF5F5'},
  rowTop:{flexDirection:'row',alignItems:'center',gap:6,marginBottom:6,flexWrap:'wrap'},
  rowNum:{backgroundColor:'#E3F2FD',paddingHorizontal:7,paddingVertical:2,borderRadius:4},
  rowNumTxt:{fontSize:10,fontWeight:'800',color:'#1565C0'},
  pill:{paddingHorizontal:7,paddingVertical:2,borderRadius:5},
  pillOpen:{backgroundColor:'#FFEBEE'},
  pillClose:{backgroundColor:'#E8F5E9'},
  pillTxt:{fontSize:9,fontWeight:'800'},
  rejectTag:{backgroundColor:'#FFF3E0',paddingHorizontal:7,paddingVertical:2,borderRadius:4},
  rejectTagTxt:{fontSize:9,color:'#e65100',fontWeight:'700'},
  field:{flexDirection:'row',gap:5,marginTop:4,alignItems:'flex-start'},
  fieldLbl:{fontSize:11,fontWeight:'700',color:'#666'},
  fieldVal:{fontSize:11,color:'#333',flex:1,lineHeight:16},
});

const komp=StyleSheet.create({
  chartCard:{backgroundColor:'#fff',borderRadius:14,padding:14,elevation:2,shadowColor:'#1565C0',shadowOffset:{width:0,height:1},shadowOpacity:0.08,shadowRadius:4},
  chartHeaderRow:{flexDirection:'row',alignItems:'center',gap:7,marginBottom:10},
  chartCardTitle:{fontSize:13,fontWeight:'800',color:'#1565C0'},
  chartLegend:{flexDirection:'row',flexWrap:'wrap',gap:12,marginBottom:14},
  chartLegendItem:{flexDirection:'row',alignItems:'center',gap:5},
  chartLegendDot:{width:10,height:10,borderRadius:5},
  chartLegendTxt:{fontSize:10,color:'#555',fontWeight:'600'},
  chartArea:{flexDirection:'row',justifyContent:'space-around',alignItems:'flex-end'},
  shiftGroup:{flex:1,alignItems:'center',gap:6},
  shiftBarsWrap:{flexDirection:'row',alignItems:'flex-end',gap:4},
  barWrap:{alignItems:'center'},
  barValTxt:{fontSize:9,fontWeight:'800',marginBottom:4},
  barTrack:{width:22,backgroundColor:'#EEF4FF',borderRadius:5,justifyContent:'flex-end',overflow:'hidden'},
  barFill:{width:'100%',borderRadius:5},
  barDot:{width:8,height:8,borderRadius:4,marginTop:3},
  shiftLabelBox:{backgroundColor:'#EEF4FF',paddingHorizontal:10,paddingVertical:4,borderRadius:8},
  shiftLabelTxt:{fontSize:10,fontWeight:'800',color:'#1565C0'},
  chartNote:{fontSize:9,color:'#aaa',textAlign:'center',marginTop:12},
  winnerCard:{backgroundColor:'#fff',borderRadius:14,flexDirection:'row',padding:14,elevation:2,shadowColor:'#F9A825',shadowOffset:{width:0,height:1},shadowOpacity:0.15,shadowRadius:4},
  winnerHalf:{flex:1,flexDirection:'row',alignItems:'flex-start',gap:10},
  winnerIconWrap:{backgroundColor:'#FFF8E1',width:40,height:40,borderRadius:20,justifyContent:'center',alignItems:'center'},
  winnerLbl:{fontSize:10,color:'#888',fontWeight:'600',marginBottom:3},
  winnerName:{fontSize:13,fontWeight:'800',marginBottom:4},
  winnerPill:{paddingHorizontal:8,paddingVertical:3,borderRadius:8,borderWidth:1},
  winnerPillTxt:{fontSize:10,fontWeight:'700'},
  winnerDivider:{width:1,backgroundColor:'#EEF0F2',marginHorizontal:12},
  tableCard:{backgroundColor:'#fff',borderRadius:14,overflow:'hidden',elevation:2,shadowColor:'#1565C0',shadowOffset:{width:0,height:1},shadowOpacity:0.07,shadowRadius:4},
  tableHeaderRow:{flexDirection:'row',alignItems:'center',gap:7,padding:14,borderBottomWidth:1,borderBottomColor:'#EEF0F2'},
  tableCardTitle:{fontSize:13,fontWeight:'800',color:'#1565C0'},
  tableColHeaders:{flexDirection:'row',paddingHorizontal:12,paddingVertical:8,backgroundColor:'#F8FAFC'},
  tableMetricCol:{width:90},
  tableNameCol:{flex:1,alignItems:'center',borderBottomWidth:2,marginHorizontal:3,paddingBottom:4},
  tableNameTxt:{fontSize:11,fontWeight:'800'},
  tableRow:{flexDirection:'row',alignItems:'center',paddingHorizontal:12,paddingVertical:10},
  tableRowAlt:{backgroundColor:'#F8FAFC'},
  tableMetricTxt:{width:90,fontSize:11,color:'#666',fontWeight:'600'},
  tableValCell:{flex:1,alignItems:'center'},
  tableValTxt:{fontSize:12,fontWeight:'800'},
  compCard:{backgroundColor:'#fff',borderRadius:12,overflow:'hidden',borderTopWidth:3,borderLeftWidth:3,elevation:1,shadowColor:'#000',shadowOffset:{width:0,height:1},shadowOpacity:0.05,shadowRadius:2},
  compCardHeader:{flexDirection:'row',alignItems:'center',padding:12,gap:10},
  compAvatar:{width:36,height:36,borderRadius:18,justifyContent:'center',alignItems:'center'},
  compAvatarTxt:{color:'#fff',fontSize:16,fontWeight:'800'},
  compName:{fontSize:13,fontWeight:'800'},
  compMeta:{fontSize:10,color:'#888',marginTop:2},
  compWarnTag:{flexDirection:'row',alignItems:'center',gap:3,backgroundColor:'#FFF3E0',paddingHorizontal:7,paddingVertical:3,borderRadius:6},
  compWarnTxt:{fontSize:9,color:'#e65100',fontWeight:'700'},
  compBody:{paddingHorizontal:10,paddingBottom:10,gap:6},
  compEmpty:{fontSize:12,color:'#aaa',textAlign:'center',paddingVertical:12},
});

const pick=StyleSheet.create({
  overlay:{flex:1,backgroundColor:'rgba(0,0,0,0.55)',justifyContent:'flex-end'},
  sheet:{backgroundColor:'#fff',borderTopLeftRadius:20,borderTopRightRadius:20,maxHeight:'80%',overflow:'hidden'},
  header:{backgroundColor:'#1565C0',flexDirection:'row',alignItems:'flex-start',justifyContent:'space-between',paddingHorizontal:16,paddingVertical:14},
  headerTxt:{color:'#fff',fontSize:16,fontWeight:'700'},
  headerSub:{color:'rgba(255,255,255,0.7)',fontSize:11,marginTop:2},
  closeBtn:{padding:4},
  chipsRow:{flexDirection:'row',flexWrap:'wrap',gap:6,paddingHorizontal:12,paddingVertical:8,borderBottomWidth:1,borderBottomColor:'#F0F4F8'},
  chip:{flexDirection:'row',alignItems:'center',gap:5,paddingHorizontal:8,paddingVertical:4,borderRadius:12,borderWidth:1},
  chipNum:{width:16,height:16,borderRadius:8,justifyContent:'center',alignItems:'center'},
  chipNumTxt:{color:'#fff',fontSize:9,fontWeight:'800'},
  chipName:{fontSize:11,fontWeight:'700'},
  searchRow:{flexDirection:'row',alignItems:'center',gap:8,margin:12,paddingHorizontal:12,paddingVertical:10,backgroundColor:'#F3F6FB',borderRadius:10,borderWidth:1,borderColor:'#E0E8F5'},
  searchInput:{flex:1,fontSize:14,color:'#333',paddingVertical:0},
  countTxt:{fontSize:11,color:'#888',paddingHorizontal:16,marginBottom:4,fontStyle:'italic'},
  manualBtn:{flexDirection:'row',alignItems:'center',gap:8,marginHorizontal:12,marginBottom:8,padding:12,backgroundColor:'#EEF4FF',borderRadius:10,borderWidth:1,borderColor:'#D0DCF0'},
  manualTxt:{fontSize:13,color:'#1565C0',fontWeight:'600',flex:1},
  item:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingVertical:13,borderBottomWidth:1,borderBottomColor:'#F0F4F8'},
  itemActive:{backgroundColor:'#EEF4FF'},
  itemLeft:{flexDirection:'row',alignItems:'center',gap:12},
  avatar:{width:36,height:36,borderRadius:18,backgroundColor:'#EEF4FF',justifyContent:'center',alignItems:'center'},
  avatarActive:{backgroundColor:'#1565C0'},
  avatarTxt:{fontSize:15,fontWeight:'800',color:'#1565C0'},
  avatarTxtActive:{color:'#fff'},
  itemName:{fontSize:14,fontWeight:'600',color:'#333'},
  itemNameActive:{color:'#1565C0',fontWeight:'700'},
  mesinIcon:{width:36,height:36,borderRadius:10,backgroundColor:'#EEF4FF',justifyContent:'center',alignItems:'center'},
  emptyBox:{alignItems:'center',paddingVertical:40,gap:10},
  emptyTxt:{fontSize:13,color:'#bbb'},
});