// components/SearchableDropdown.js
import React, { useState, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, Modal, FlatList,
  StyleSheet, TextInput
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function SearchableDropdown({ label, options = [], value, onChange, error, placeholder = 'Cari atau pilih...' }) {
  const [visible, setVisible] = useState(false);
  const [query, setQuery]     = useState('');

  const selected = options.find(o => o.value === value);

  const filtered = useMemo(() => {
    if (!query.trim()) return options.filter(o => o.value !== '');
    const q = query.toLowerCase();
    return options.filter(o =>
      o.value !== '' && (
        o.label.toLowerCase().includes(q) ||
        (o.kode || o.value).toLowerCase().includes(q)
      )
    );
  }, [query, options]);

  const handleOpen = () => {
    setQuery('');
    setVisible(true);
  };

  const handleSelect = (item) => {
    onChange(item.value);
    setVisible(false);
    setQuery('');
  };

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TouchableOpacity
        style={[styles.selector, error && styles.errorBorder]}
        onPress={handleOpen}
        activeOpacity={0.7}
      >
        <Text style={[styles.selectorText, !value && styles.placeholder]} numberOfLines={1}>
          {selected ? selected.label : placeholder}
        </Text>
        <Ionicons name="search" size={16} color="#1565C0" />
      </TouchableOpacity>
      {error && <Text style={styles.errorText}>{error}</Text>}

      <Modal visible={visible} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.modal}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{label || 'Pilih'}</Text>
              <TouchableOpacity onPress={() => setVisible(false)} style={styles.closeBtn}>
                <Ionicons name="close" size={22} color="#fff" />
              </TouchableOpacity>
            </View>

            {/* Search Bar */}
            <View style={styles.searchRow}>
              <Ionicons name="search-outline" size={18} color="#999" style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Ketik nama produk atau kode..."
                placeholderTextColor="#bbb"
                value={query}
                onChangeText={setQuery}
                autoFocus
                autoCapitalize="none"
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => setQuery('')}>
                  <Ionicons name="close-circle" size={18} color="#bbb" />
                </TouchableOpacity>
              )}
            </View>

            {/* Result Count */}
            <Text style={styles.resultCount}>
              {filtered.length} item ditemukan
            </Text>

            {/* List */}
            <FlatList
              data={filtered}
              keyExtractor={(item) => item.value}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const isSelected = item.value === value;
                return (
                  <TouchableOpacity
                    style={[styles.option, isSelected && styles.selectedOption]}
                    onPress={() => handleSelect(item)}
                  >
                    <View style={styles.optionContent}>
                      <Text
                        style={[styles.optionLabel, isSelected && styles.selectedLabel]}
                        numberOfLines={2}
                      >
                        {item.label}
                      </Text>
                      {(item.kode || item.value) && (
                        <View style={styles.kodePill}>
                          <Text style={styles.kodeText}>{item.kode || item.value}</Text>
                        </View>
                      )}
                    </View>
                    {isSelected && <Ionicons name="checkmark-circle" size={20} color="#1565C0" />}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.emptyBox}>
                  <Ionicons name="search-outline" size={32} color="#ddd" />
                  <Text style={styles.emptyText}>Tidak ditemukan</Text>
                  <Text style={styles.emptySubText}>Coba kata kunci lain</Text>
                </View>
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { marginBottom: 12 },
  label:        { fontSize: 13, fontWeight: '600', color: '#333', marginBottom: 4 },
  selector: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1.5, borderColor: '#D0DCF0', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11, backgroundColor: '#F8FAFF',
  },
  errorBorder:  { borderColor: '#e53935' },
  selectorText: { fontSize: 14, color: '#333', flex: 1, marginRight: 8 },
  placeholder:  { color: '#aaa' },
  errorText:    { fontSize: 12, color: '#e53935', marginTop: 3 },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '85%', overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#1565C0', paddingHorizontal: 16, paddingVertical: 14,
  },
  modalTitle:  { fontSize: 16, fontWeight: '700', color: '#fff', flex: 1 },
  closeBtn:    { padding: 4 },

  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    margin: 12, paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: '#F3F6FB', borderRadius: 10,
    borderWidth: 1, borderColor: '#E0E8F5',
  },
  searchIcon:   { marginRight: 8 },
  searchInput:  { flex: 1, fontSize: 14, color: '#333', paddingVertical: 0 },

  resultCount: {
    fontSize: 11, color: '#888', paddingHorizontal: 16,
    marginBottom: 4, fontStyle: 'italic',
  },

  option: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 11, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: '#F0F4FB',
  },
  selectedOption:  { backgroundColor: '#EEF4FF' },
  optionContent:   { flex: 1, marginRight: 8 },
  optionLabel:     { fontSize: 13, color: '#222', lineHeight: 18 },
  selectedLabel:   { color: '#1565C0', fontWeight: '600' },
  kodePill: {
    alignSelf: 'flex-start', backgroundColor: '#E3F2FD',
    borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, marginTop: 3,
  },
  kodeText: { fontSize: 10, color: '#1565C0', fontWeight: '700', letterSpacing: 0.5 },

  emptyBox:    { alignItems: 'center', paddingVertical: 40 },
  emptyText:   { color: '#bbb', marginTop: 8, fontSize: 14, fontWeight: '600' },
  emptySubText:{ color: '#ccc', fontSize: 12, marginTop: 4 },
});
