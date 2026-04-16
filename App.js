// App.js
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { View, Text, Animated } from 'react-native';
import * as Updates from 'expo-updates';

import FormScreen    from './screens/FormScreen';
import HistoryScreen from './screens/HistoryScreen';
import ReportScreen  from './screens/ReportScreen';

const Tab = createBottomTabNavigator();

// ─── Navigator tetap sama ─────────────────────────────────────────────
function AppNavigator() {
  const insets = useSafeAreaInsets();

  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor:   '#1565C0',
          tabBarInactiveTintColor: '#aaa',
          tabBarStyle: {
            borderTopWidth: 1,
            borderTopColor: '#e0e0e0',
            paddingTop: 6,
            paddingBottom: insets.bottom + 6,
            height: 60 + insets.bottom,
          },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
          tabBarIcon: ({ color, size, focused }) => {
            const icons = {
              'Input Form': focused ? 'create'      : 'create-outline',
              'Riwayat':    focused ? 'time'         : 'time-outline',
              'Laporan':    focused ? 'bar-chart'    : 'bar-chart-outline',
            };
            return <Ionicons name={icons[route.name]} size={size} color={color} />;
          },
        })}
      >
        <Tab.Screen name="Input Form" component={FormScreen}    />
        <Tab.Screen name="Riwayat"    component={HistoryScreen} />
        <Tab.Screen name="Laporan"    component={ReportScreen}  />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

// ─── Root App + AUTO OTA UPDATE ─────────────────────────────────────
export default function App() {
  const [showBanner, setShowBanner] = useState(false);
  const [fadeAnim] = useState(new Animated.Value(0));
  const [versionInfo, setVersionInfo] = useState('');

  useEffect(() => {
    let interval;

    async function checkUpdate() {
      try {
        const update = await Updates.checkForUpdateAsync();

        if (update.isAvailable) {
          console.log('Update ditemukan');

          // versi tracking
          const currentVersion = Updates.runtimeVersion || 'unknown';
          const newVersion = update.manifest?.runtimeVersion || 'latest';

          setVersionInfo(`${currentVersion} → ${newVersion}`);

          // tampilkan banner
          setShowBanner(true);

          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }).start();

          // download update
          await Updates.fetchUpdateAsync();

          // delay biar smooth
          setTimeout(() => {
            Updates.reloadAsync();
          }, 2000);
        }
      } catch (e) {
        console.log('Update error:', e);
      }
    }

    // cek pertama
    checkUpdate();

    // cek tiap 15 detik
    interval = setInterval(checkUpdate, 15000);

    return () => clearInterval(interval);
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor="#1565C0" />

      {/* APP */}
      <AppNavigator />

      {/* 🔥 AUTO UPDATE BANNER */}
      {showBanner && (
        <Animated.View style={{
          position: 'absolute',
          top: 50,
          left: 20,
          right: 20,
          backgroundColor: '#1565C0',
          padding: 12,
          borderRadius: 10,
          zIndex: 999,
          opacity: fadeAnim
        }}>
          <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '600' }}>
            🔄 Memperbarui aplikasi...
          </Text>

          <Text style={{ color: '#fff', textAlign: 'center', fontSize: 12, marginTop: 4 }}>
            {versionInfo}
          </Text>
        </Animated.View>
      )}

    </SafeAreaProvider>
  );
}