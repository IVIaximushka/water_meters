import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
  Dimensions,
  Image,
} from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { Image as ImageIcon, CheckCircle, Camera as CameraIcon, FolderOpen } from 'lucide-react-native';
import { OpenCV, RotateFlags, ObjectType, DataTypes } from 'react-native-fast-opencv';
import RNFS from 'react-native-fs';

const { width, height } = Dimensions.get('window');

export default function ImagePickerScreen() {
  const [mediaLibraryPermission, requestMediaLibraryPermission] = 
    MediaLibrary.usePermissions();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [lastPhotoSaved, setLastPhotoSaved] = useState(false);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraKey, setCameraKey] = useState(0);
  const [facing, setFacing] = useState<CameraType>('back');
  const cameraRef = useRef<CameraView>(null);

  // Функция для запроса всех разрешений
  const requestAllPermissions = async () => {
    const mediaResult = await requestMediaLibraryPermission();
    const cameraResult = await requestCameraPermission();
    
    if (!mediaResult?.granted) {
      Alert.alert(
        'Разрешение на медиатеку',
        'Для сохранения фотографий необходимо разрешение на доступ к медиатеке'
      );
    }
    
    if (!cameraResult?.granted) {
      Alert.alert(
        'Разрешение на камеру',
        'Для съемки фотографий необходимо разрешение на доступ к камере'
      );
    }
  };

  // Функция для преобразования изображения в Float32Array
  const convertImageToFloat32Array = (base64Image: string): Float32Array => {
    try {
      // Создаем Mat из base64 изображения
      const src = OpenCV.base64ToMat(base64Image);
      console.log('Исходное изображение:', src);
      
      // Получаем информацию об изображении
      const imageData = OpenCV.toJSValue(src);
      console.log('Информация об изображении:', {
        width: imageData.cols,
        height: imageData.rows,
        size: imageData.size,
        type: imageData.type
      });
      
      // Создаем копию для изменения размера
      const resized = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC3);
      const targetSize = OpenCV.createObject(ObjectType.Size, 640, 640);
      OpenCV.invoke('resize', src, resized, targetSize, 0, 0, 1);
      
      // Конвертируем в RGB формат
      const rgbMat = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC3);
      OpenCV.invoke('cvtColor', resized, rgbMat, 4); // 4 = COLOR_BGR2RGB
      
      // Получаем RGB данные
      const rgbData = OpenCV.toJSValue(rgbMat);
      
      if (rgbData && rgbData.base64) {
        console.log('RGB изображение получено, размер base64:', rgbData.base64.length);
        
        // Декодируем base64 в массив байтов
        const buf = OpenCV.matToBuffer(rgbMat, "uint8");
        const bytes = buf.buffer;
        console.log('Первые 10 байтов:', bytes.slice(0, 10));
        
        // Размеры изображения
        const width = rgbData.cols;
        const height = rgbData.rows;
        
        console.log('Создание матрицы пикселей размера:', `${height}×${width}×3`);
        
        // Создаем Float32Array с нормализацией
        const totalSize = 640 * 640 * 3;
        const floatArray = new Float32Array(totalSize);
        
        // Преобразуем байты в Float32Array с нормализацией на 255.0
        for (let i = 0; i < totalSize && i < bytes.length; i++) {
          floatArray[i] = bytes[i] / 255.0;
        }
        
        return floatArray;
      }
      
      throw new Error('Не удалось получить RGB данные изображения');
    } catch (error) {
      console.error('Ошибка при преобразовании изображения в Float32Array:', error);
      throw error;
    }
  };

  // Обработка изображения с помощью OpenCV
  const processImageWithOpenCV = async (base64Image: string): Promise<string> => {
    try {
      if (!base64Image) {
        throw new Error('Не удалось получить base64 изображения');
      }
      
      // Создаем Mat из base64 изображения
      const src = OpenCV.base64ToMat(base64Image);
      console.log(src)
      
      // Преобразуем изображение в Float32Array
      const floatArray = convertImageToFloat32Array(base64Image);
      console.log('Получен Float32Array:', floatArray.length, 'элементов');

      // Создаем Mat для результата
      const dst = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC3);
      
      // Поворачиваем изображение на 90 градусов по часовой стрелке
      OpenCV.invoke('rotate', src, dst, RotateFlags.ROTATE_90_CLOCKWISE);
      
      // Конвертируем обработанное изображение обратно в base64
      const result = OpenCV.toJSValue(dst);
      
      if (!result || !result.base64) {
        throw new Error('Не удалось получить обработанное изображение');
      }
      
      // Сохраняем обработанное изображение в состояние для отображения
      setProcessedImage(`data:image/jpeg;base64,${result.base64}`);
      
      // Очищаем буферы OpenCV
      OpenCV.clearBuffers();
      
      // Создаем временный файл для сохранения в галерею
      const tempProcessedPath = `${RNFS.CachesDirectoryPath}/temp_processed_${Date.now()}.jpg`;
      await RNFS.writeFile(tempProcessedPath, result.base64, 'base64');
      
      return tempProcessedPath;
    } catch (error) {
      console.error('Ошибка при обработке изображения:', error);
      OpenCV.clearBuffers();
      throw error;
    }
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
        base64: true,
      });

      if (photo && photo.base64 && mediaLibraryPermission?.granted) {
        try {
          // Обрабатываем изображение с помощью OpenCV
          const processedImagePath = await processImageWithOpenCV(photo.base64);
          
          // Сохраняем обработанное изображение в галерею
          await MediaLibrary.saveToLibraryAsync(processedImagePath);
          
          // Удаляем временный файл
          try {
            await RNFS.unlink(processedImagePath);
          } catch (deleteError) {
            console.warn('Не удалось удалить временный файл:', deleteError);
          }
          
          setLastPhotoSaved(true);
          
          if (Platform.OS !== 'web') {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
          
          // Принудительно обновить камеру после съемки с небольшой задержкой
          setTimeout(() => {
            setCameraKey(prev => prev + 1);
          }, 100);
          
          // Скрыть индикатор успеха через 2 секунды
          setTimeout(() => setLastPhotoSaved(false), 2000);
        } catch (processingError) {
          console.error('Ошибка при обработке изображения:', processingError);
          Alert.alert('Ошибка', 'Не удалось обработать изображение');
        }
      } else {
        Alert.alert('Ошибка', 'Не удалось сохранить фотографию');
      }
    } catch (error) {
      console.error('Ошибка при съемке:', error);
      Alert.alert('Ошибка', 'Не удалось сделать фотографию');
      // Принудительно обновить камеру в случае ошибки
      setCameraKey(prev => prev + 1);
    } finally {
      setIsCapturing(false);
    }
  };

  // Переключение камеры
  const toggleCameraFacing = () => {
    setFacing(current => (current === 'back' ? 'front' : 'back'));
  };

  // Выбор фото из галереи
  const pickImageFromGallery = async () => {
    if (isProcessing) return;
    
    setIsProcessing(true);
    setLastPhotoSaved(false);
    
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    try {
      // Запрашиваем разрешение на доступ к галерее
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Разрешение', 'Необходимо разрешение для доступа к галерее');
        return;
      }

      // Выбираем изображение
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        aspect: [4, 3],
        quality: 1,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const selectedImage = result.assets[0];
        
        if (selectedImage.uri) {
          try {
            // Конвертируем файл в base64 с помощью RNFS
            let base64Image: string;
            
            if (selectedImage.uri.startsWith('file://')) {
              // Если это локальный файл, читаем его напрямую
              base64Image = await RNFS.readFile(selectedImage.uri, 'base64');
            } else {
              // Если это URI из галереи, сначала копируем в временный файл
              const tempPath = `${RNFS.CachesDirectoryPath}/temp_selected_${Date.now()}.jpg`;
              await RNFS.copyFile(selectedImage.uri, tempPath);
              base64Image = await RNFS.readFile(tempPath, 'base64');
              
              // Удаляем временный файл
              try {
                await RNFS.unlink(tempPath);
              } catch (deleteError) {
                console.warn('Не удалось удалить временный файл:', deleteError);
              }
            }
            
            // Обрабатываем изображение с помощью OpenCV
            const processedImagePath = await processImageWithOpenCV(base64Image);
            
            // Сохраняем обработанное изображение в галерею
            if (mediaLibraryPermission?.granted) {
              await MediaLibrary.saveToLibraryAsync(processedImagePath);
              
              // Удаляем временный файл обработанного изображения
              try {
                await RNFS.unlink(processedImagePath);
              } catch (deleteError) {
                console.warn('Не удалось удалить временный файл:', deleteError);
              }
              
              setLastPhotoSaved(true);
              
              if (Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
              
              // Скрыть индикатор успеха через 2 секунды
              setTimeout(() => setLastPhotoSaved(false), 2000);
            }
          } catch (processingError) {
            console.error('Ошибка при обработке выбранного изображения:', processingError);
            Alert.alert('Ошибка', 'Не удалось обработать выбранное изображение');
          }
        }
      }
    } catch (error) {
      console.error('Ошибка при выборе изображения:', error);
      Alert.alert('Ошибка', 'Не удалось выбрать изображение из галереи');
    } finally {
      setIsProcessing(false);
    }
  };

  // Проверка разрешений
  if (!mediaLibraryPermission || !cameraPermission) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>Загрузка...</Text>
      </View>
    );
  }

  if (!mediaLibraryPermission.granted || !cameraPermission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <ImageIcon size={64} color="#666" style={styles.permissionIcon} />
        <Text style={styles.permissionTitle}>Доступ к камере и медиатеке</Text>
        <Text style={styles.permissionText}>
          Для работы приложения необходимо разрешение на доступ к камере и медиатеке
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
      {/* Индикатор успешного сохранения */}
      {lastPhotoSaved && !processedImage && (
        <View style={styles.successIndicator}>
          <CheckCircle size={24} color="#4CAF50" />
          <Text style={styles.successText}>Повернутое фото сохранено!</Text>
        </View>
      )}

      {/* Отображение обработанного изображения */}
      {processedImage && (
        <TouchableOpacity
          style={styles.processedImageContainer}
          activeOpacity={1}
          onPress={() => {
            if (Platform.OS !== 'web') {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
            setProcessedImage(null);
          }}
        >
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => {
              if (Platform.OS !== 'web') {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }
              setProcessedImage(null);
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.closeButtonText}>×</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.imageWrapper}
            activeOpacity={1}
            onPress={() => {}}
          >
            <Image
              source={{ uri: processedImage }}
              style={styles.processedImage}
              resizeMode="contain"
            />
          </TouchableOpacity>
          <Text style={styles.processedImageText}>
            Обработанное изображение (повернуто на 90°)
          </Text>
        </TouchableOpacity>
      )}

      {/* Интерфейс камеры */}
      {showCamera && !processedImage && (
        <View style={styles.cameraContainer}>
          <CameraView
            key={cameraKey}
            ref={cameraRef}
            style={styles.camera}
            facing={facing}
          />
          
          <View style={styles.cameraOverlay}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setShowCamera(false)}
            >
              <Text style={styles.closeButtonText}>×</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.flipButton}
              onPress={toggleCameraFacing}
            >
              <Text style={styles.flipButtonText}>↻</Text>
            </TouchableOpacity>
          </View>
          
          <View style={styles.cameraControls}>
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
                  <View style={styles.processingIndicator} />
                ) : (
                  <CameraIcon size={32} color="#fff" />
                )}
              </View>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Основной контент */}
      {!processedImage && !showCamera && (
        <View style={styles.mainContent}>
          <View style={styles.headerContainer}>
            <ImageIcon size={80} color="#007AFF" />
            <Text style={styles.headerTitle}>Обработка изображений</Text>
            <Text style={styles.headerSubtitle}>
              Сделайте фото или выберите из галереи для поворота на 90°
            </Text>
          </View>

          <View style={styles.buttonsContainer}>
            <TouchableOpacity
              style={[
                styles.pickButton,
                isProcessing && styles.pickButtonPressed
              ]}
              onPress={() => setShowCamera(true)}
              disabled={isProcessing}
            >
              <View style={styles.pickButtonInner}>
                <CameraIcon size={32} color="#fff" />
                <Text style={styles.pickButtonText}>Камера</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.pickButton,
                isProcessing && styles.pickButtonPressed
              ]}
              onPress={pickImageFromGallery}
              disabled={isProcessing}
            >
              <View style={styles.pickButtonInner}>
                {isProcessing ? (
                  <View style={styles.processingIndicator} />
                ) : (
                  <FolderOpen size={32} color="#fff" />
                )}
                <Text style={styles.pickButtonText}>
                  {isProcessing ? 'Обработка...' : 'Галерея'}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    padding: 20,
  },
  permissionIcon: {
    marginBottom: 20,
  },
  permissionTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
    textAlign: 'center',
  },
  permissionText: {
    fontSize: 16,
    color: '#666',
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
    zIndex: 1000,
  },
  successText: {
    color: '#4CAF50',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  processedImageContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 1000,
    elevation: 1000,
  },
  closeButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 50,
    height: 50,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1001,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 1001,
  },
  closeButtonText: {
    fontSize: 28,
    color: '#000',
    fontWeight: 'bold',
    lineHeight: 28,
  },
  processedImage: {
    width: width - 40,
    height: height - 160,
    borderRadius: 15,
    backgroundColor: '#111',
  },
  processedImageText: {
    color: '#fff',
    fontSize: 18,
    marginTop: 30,
    textAlign: 'center',
    fontWeight: '500',
  },
  imageWrapper: {
    borderRadius: 15,
  },
  mainContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  headerContainer: {
    alignItems: 'center',
    marginBottom: 50,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 20,
    marginBottom: 10,
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 18,
    color: '#666',
    textAlign: 'center',
    lineHeight: 24,
  },
  pickButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 40,
    paddingVertical: 20,
    borderRadius: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    minWidth: 200,
  },
  pickButtonPressed: {
    transform: [{ scale: 0.95 }],
    backgroundColor: '#005bb5',
  },
  pickButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 10,
  },
  processingIndicator: {
    width: 20,
    height: 20,
    backgroundColor: '#fff',
    borderRadius: 10,
  },
  // Стили для камеры
  cameraContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    zIndex: 1000,
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    zIndex: 1001,
  },
  flipButton: {
    width: 50,
    height: 50,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  flipButtonText: {
    fontSize: 24,
    color: '#000',
    fontWeight: 'bold',
  },
  cameraControls: {
    position: 'absolute',
    bottom: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 1001,
  },
  captureButton: {
    width: 80,
    height: 80,
    backgroundColor: '#007AFF',
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  captureButtonPressed: {
    transform: [{ scale: 0.9 }],
    backgroundColor: '#005bb5',
  },
  captureButtonInner: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonsContainer: {
    gap: 20,
  },
});