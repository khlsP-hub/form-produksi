// components/AppInput.js
import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';

export default function AppInput({
  label, value, onChangeText, placeholder, keyboardType = 'default',
  multiline = false, numberOfLines = 1, error, editable = true, style
}) {
  return (
    <View style={[styles.container, style]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        style={[
          styles.input,
          multiline && styles.multiline,
          error && styles.errorBorder,
          !editable && styles.disabled,
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder || label}
        placeholderTextColor="#aaa"
        keyboardType={keyboardType}
        multiline={multiline}
        numberOfLines={numberOfLines}
        editable={editable}
        textAlignVertical={multiline ? 'top' : 'center'}
      />
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '600', color: '#333', marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#333',
    backgroundColor: '#fff',
  },
  multiline: {
    minHeight: 80,
    paddingTop: 10,
  },
  errorBorder: { borderColor: '#e53935' },
  disabled: { backgroundColor: '#f5f5f5', color: '#999' },
  errorText: { fontSize: 12, color: '#e53935', marginTop: 3 },
});
