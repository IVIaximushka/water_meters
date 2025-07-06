import { Tabs } from 'expo-router';
import { Image } from 'lucide-react-native';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#000',
          borderTopColor: '#333',
        },
        tabBarActiveTintColor: '#fff',
        tabBarInactiveTintColor: '#666',
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Обработка фото',
          tabBarIcon: ({ size, color }) => (
            <Image size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}