// App.js
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import FormScreen    from './screens/FormScreen';
import HistoryScreen from './screens/HistoryScreen';
import ReportScreen  from './screens/ReportScreen';

const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor="#1565C0" />
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarActiveTintColor:   '#1565C0',
            tabBarInactiveTintColor: '#aaa',
            tabBarStyle: {
              borderTopWidth: 1,
              borderTopColor: '#e0e0e0',
              paddingBottom: 6,
              paddingTop: 6,
              height: 60,
            },
            tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
            tabBarIcon: ({ color, size, focused }) => {
              const icons = {
                'Input Form': focused ? 'create'          : 'create-outline',
                'Riwayat':    focused ? 'time'            : 'time-outline',
                'Laporan':    focused ? 'bar-chart'       : 'bar-chart-outline',
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
    </SafeAreaProvider>
  );
}
