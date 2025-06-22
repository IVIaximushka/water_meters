import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
  Dimensions,
} from 'react-native';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import * as Haptics from 'expo-haptics';
import { Camera, RotateCcw, CheckCircle } from 'lucide-react-native';

const { width, height } = Dimensions.get('window');

export default function CameraScreen() {
  const [facing, setFacing] = useState<CameraType>('back');
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [mediaLibraryPermission, requestMediaLibraryPermission] = 
    MediaLibrary.usePermissions();
  const [isCapturing, setIsCapturing] = useState(false);
  const [lastPhotoSaved, setLastPhotoSaved] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  // Функция для запроса всех разрешений
  const requestAllPermissions = async () => {
    const cameraResult = await requestCameraPermission();
    const mediaResult = await requestMediaLibraryPermission();
    
    if (!cameraResult.granted) {
      Alert.alert(
        'Разрешение на камеру',
        'Для работы приложения необходимо разрешение на использование камеры'
      );
    }
    
    if (!mediaResult?.granted) {
      Alert.alert(
        'Разрешение на медиатеку',
        'Для сохранения фотографий необходимо разрешение на доступ к медиатеке'
      );
    }
  };

  // Переключение камеры
  const toggleCameraFacing = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setFacing(current => (current === 'back' ? 'front' : 'back'));
  };

  // Съемка фотографии
  const takePicture = async () => {
    if (!cameraRef.current || isCapturing) return;
    
    setIsCapturing(true);
    setLastPhotoSaved(false);
    
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        base64: false,
      });

      if (photo && mediaLibraryPermission?.granted) {
        await MediaLibrary.saveToLibraryAsync(photo.uri);
        setLastPhotoSaved(true);
        
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        
        // Скрыть индикатор успеха через 2 секунды
        setTimeout(() => setLastPhotoSaved(false), 2000);
      } else {
        Alert.alert('Ошибка', 'Не удалось сохранить фотографию');
      }
    } catch (error) {
      console.error('Ошибка при съемке:', error);
      Alert.alert('Ошибка', 'Не удалось сделать фотографию');
    } finally {
      setIsCapturing(false);
    }
  };

  // Проверка разрешений
  if (!cameraPermission) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>Загрузка...</Text>
      </View>
    );
  }

  if (!cameraPermission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Camera size={64} color="#666" style={styles.permissionIcon} />
        <Text style={styles.permissionTitle}>Доступ к камере</Text>
        <Text style={styles.permissionText}>
          Для работы приложения необходимо разрешение на использование камеры
        </Text>
        <TouchableOpacity 
          style={styles.permissionButton} 
          onPress={requestAllPermissions}
        >
          <Text style={styles.permissionButtonText}>Предоставить доступ</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        mode="picture"
      >
        {/* Индикатор успешного сохранения */}
        {lastPhotoSaved && (
          <View style={styles.successIndicator}>
            <CheckCircle size={24} color="#4CAF50" />
            <Text style={styles.successText}>Фото сохранено!</Text>
          </View>
        )}

        {/* Элементы управления */}
        <View style={styles.controlsContainer}>
          {/* Кнопка переключения камеры */}
          <TouchableOpacity
            style={styles.flipButton}
            onPress={toggleCameraFacing}
          >
            <RotateCcw size={24} color="#fff" />
          </TouchableOpacity>

          {/* Кнопка съемки */}
          <TouchableOpacity
            style={[
              styles.captureButton,
              isCapturing && styles.captureButtonPressed
            ]}
            onPress={takePicture}
            disabled={isCapturing}
          >
            <View style={styles.captureButtonInner}>
              {isCapturing ? (
                <View style={styles.capturingIndicator} />
              ) : (
                <Camera size={32} color="#000" />
              )}
            </View>
          </TouchableOpacity>

          {/* Пустой блок для центрирования кнопки съемки */}
          <View style={styles.flipButton} />
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    padding: 20,
  },
  permissionIcon: {
    marginBottom: 20,
  },
  permissionTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
    textAlign: 'center',
  },
  permissionText: {
    fontSize: 16,
    color: '#999',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 30,
  },
  permissionButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 25,
  },
  permissionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  successIndicator: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    marginHorizontal: 20,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 25,
  },
  successText: {
    color: '#4CAF50',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  controlsContainer: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  flipButton: {
    width: 50,
    height: 50,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButton: {
    width: 80,
    height: 80,
    backgroundColor: '#fff',
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  captureButtonPressed: {
    transform: [{ scale: 0.95 }],
  },
  captureButtonInner: {
    width: 70,
    height: 70,
    backgroundColor: '#fff',
    borderRadius: 35,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#000',
  },
  capturingIndicator: {
    width: 20,
    height: 20,
    backgroundColor: '#FF3B30',
    borderRadius: 10,
  },
});