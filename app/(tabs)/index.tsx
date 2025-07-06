import React, { useState, useRef, useEffect } from 'react';
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
import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';
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
  const [obbModel, setObbModel] = useState<TensorflowModel | null>(null);
  const cameraRef = useRef<CameraView>(null);

  // Загрузка модели при монтировании компонента
  useEffect(() => {
    const loadModel = async () => {
      try {
        const model = await loadTensorflowModel(require('../../assets/weights/obb_float16.tflite'));
        setObbModel(model);
        console.log('Модель OBB успешно загружена');
      } catch (error) {
        console.error('Ошибка при загрузке модели OBB:', error);
      }
    };
    loadModel();
  }, []);

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



  // Функция для поворота и вырезания горизонтального прямоугольника
  const cropHorizontalRect = (srcMat: any, x: number, y: number, w: number, h: number, angleRad: number): any => {
    try {
      // Если высота больше ширины, меняем местами и корректируем угол
      if (h > w) {
        [w, h] = [h, w];
        angleRad = angleRad - Math.PI / 2;
      }

      const angleDeg = angleRad * 180 / Math.PI;
      const center = OpenCV.createObject(ObjectType.Point2f, x, y);

      // Получаем матрицу поворота
      const rotationMatrix= OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC3);
      OpenCV.invoke('getRotationMatrix2D', center, angleDeg, 1.0, rotationMatrix);
      
      // Поворачиваем изображение
      const rotatedMat = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC3);
      const srcInfo = OpenCV.toJSValue(srcMat);
      const size = OpenCV.createObject(ObjectType.Size, srcInfo.cols, srcInfo.rows);
      OpenCV.invoke('warpAffine', srcMat, rotatedMat, rotationMatrix, size);

      // Вычисляем границы для вырезания
      const xInt = Math.floor(x);
      const yInt = Math.floor(y);
      const wInt = Math.floor(w);
      const hInt = Math.floor(h);
      
      const left = Math.max(0, xInt - Math.floor(wInt / 2));
      const top = Math.max(0, yInt - Math.floor(hInt / 2));
      const right = Math.min(srcInfo.cols, xInt + Math.floor(wInt / 2));
      const bottom = Math.min(srcInfo.rows, yInt + Math.floor(hInt / 2));

      // Создаем ROI (Region of Interest)
      const rect = OpenCV.createObject(ObjectType.Rect, left, top, right - left, bottom - top);
      const croppedMat = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC3);
      OpenCV.invoke('crop', rotatedMat, croppedMat, rect);

      return croppedMat;
    } catch (error) {
      console.error('Ошибка при обрезке горизонтального прямоугольника:', error);
      throw error;
    }
  };

  // Функция для обрезки изображения по OBB
  const cropOBB = (srcMat: any, bestDetection: any[]): any => {
    try {
      const threshold = 20;
      const srcInfo = OpenCV.toJSValue(srcMat);
      
      // Денормализуем координаты (умножаем на размеры изображения)
      let x = bestDetection[0] * srcInfo.cols;
      let y = bestDetection[1] * srcInfo.rows;
      let w = bestDetection[2] * srcInfo.cols;
      let h = bestDetection[3] * srcInfo.rows;
      let angleRad = bestDetection[6];

      // Определяем класс (берем максимальный confidence)
      const conf1 = bestDetection[4];
      const conf2 = bestDetection[5];
      const classIndex = conf1 > conf2 ? 0 : 1;

      console.log('Параметры OBB для обрезки:', { x, y, w, h, angleRad, classIndex });

      // Проверяем условие поворота на 90 градусов
      const angleDeg = angleRad * 180 / Math.PI;
      const shouldRotate = (h > w && angleDeg < threshold) || (h < w && angleDeg > 90 - threshold);

      let finalSrcMat = srcMat;

      if (shouldRotate) {
        console.log('Поворачиваем изображение на 90 градусов');
        const rotated90Mat = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC3);
        OpenCV.invoke('rotate', srcMat, rotated90Mat, RotateFlags.ROTATE_90_CLOCKWISE);
        finalSrcMat = rotated90Mat;
        
        // Пересчитываем координаты после поворота
        const temp = x;
        x = srcInfo.rows - y;
        y = temp;
        [w, h] = [h, w];
      }

      // Добавляем коррекцию угла на основе класса
      const correctedAngle = angleRad + classIndex * Math.PI;

      // Обрезаем горизонтальный прямоугольник
      const croppedMat = cropHorizontalRect(finalSrcMat, x, y, w, h, correctedAngle);

      return croppedMat;
    } catch (error) {
      console.error('Ошибка при обрезке OBB:', error);
      throw error;
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

      // Запускаем модель, если она загружена
      if (obbModel) {
        try {
          console.log('Запускаем инференс модели...');
          
          // Создаем входной тензор
          const inputTensor = new Float32Array(floatArray);
          
          // Запускаем модель
          const outputs = obbModel.runSync([inputTensor]);
          console.log('Модель TensorFlow Lite успешно выполнена!');
          console.log('Количество выходных тензоров:', outputs.length);
          
          // Функция для преобразования массива аналогично Python reshape(7, -1)
          const reshapeArray = (array: any, rows: number) => {
            const flatArray = Array.from(array);
            const cols = Math.floor(flatArray.length / rows);
            const result = [];
            
            for (let i = 0; i < rows; i++) {
              const row = [];
              for (let j = 0; j < cols; j++) {
                const index = i * cols + j;
                if (index < flatArray.length) {
                  row.push(flatArray[index]);
                }
              }
              if (row.length === cols) {
                result.push(row);
              }
            }
            
            return result;
          };

          // Функция для транспонирования матрицы
          const transposeMatrix = (matrix: any[][]) => {
            if (matrix.length === 0) return [];
            
            const rows = matrix.length;
            const cols = matrix[0].length;
            const result = [];
            
            for (let j = 0; j < cols; j++) {
              const row = [];
              for (let i = 0; i < rows; i++) {
                row.push(matrix[i][j]);
              }
              result.push(row);
            }
            
            return result;
          };

          // Применяем преобразования к первому выходному тензору
          if (outputs.length > 0) {
            const outputTensor = outputs[0];
            console.log('Размер выходного тензора:', outputTensor.length);
            
            // Преобразуем в матрицу 7 строк
            const reshapedMatrix = reshapeArray(outputTensor, 7);
            console.log('Матрица после reshape:', reshapedMatrix.length, 'строк');
            
            // Транспонируем матрицу
            const transposedMatrix = transposeMatrix(reshapedMatrix);
            console.log('Матрица после transpose:', transposedMatrix.length, 'строк');
            
            // Структура данных в каждой строке:
            // [0] - нормализованная x-координата центра oriented bounding box
            // [1] - нормализованная y-координата центра oriented bounding box  
            // [2] - ширина oriented bounding box
            // [3] - высота oriented bounding box
            // [4] - уверенность первого класса
            // [5] - уверенность второго класса
            // [6] - угол поворота obb относительно нормали
            
            // Находим строку с максимальным значением confidence (максимум из всех значений индексов 4 и 5)
            let maxConfidence = -1;
            let bestDetection: any[] | null = null;
            
            transposedMatrix.forEach((row, rowIndex) => {
              if (row.length > 5) {
                const conf4 = row[4]; // уверенность первого класса
                const conf5 = row[5]; // уверенность второго класса
                const maxRowConfidence = Math.max(conf4, conf5);
                
                if (maxRowConfidence > maxConfidence) {
                  maxConfidence = maxRowConfidence;
                  bestDetection = row;
                }
              }
            });
            
            if (bestDetection) {
              console.log('Лучшая детекция с максимальной confidence:', maxConfidence);
              console.log('Параметры лучшей детекции:', bestDetection);
              console.log('Центр OBB (x, y):', bestDetection[0], bestDetection[1]);
              console.log('Размеры OBB (ширина, высота):', bestDetection[2], bestDetection[3]);
              console.log('Confidence класса 1:', bestDetection[4]);
              console.log('Confidence класса 2:', bestDetection[5]);
              console.log('Угол поворота OBB:', bestDetection[6]);
              
              // Обрезаем изображение по OBB
              try {
                console.log('Начинаем обрезку изображения по OBB...');
                const croppedMat = cropOBB(src, bestDetection);
                
                // Конвертируем обрезанное изображение в base64
                const croppedResult = OpenCV.toJSValue(croppedMat);
                if (croppedResult && croppedResult.base64) {
                  console.log('Обрезанное изображение успешно создано');
                  
                  // Сохраняем обрезанное изображение для отображения
                  const croppedImageUri = `data:image/jpeg;base64,${croppedResult.base64}`;
                  setProcessedImage(croppedImageUri);
                  
                  // Создаем временный файл для обрезанного изображения
                  const tempCroppedPath = `${RNFS.CachesDirectoryPath}/temp_cropped_${Date.now()}.jpg`;
                  await RNFS.writeFile(tempCroppedPath, croppedResult.base64, 'base64');
                  
                  // Сохраняем обрезанное изображение в галерею
                  if (mediaLibraryPermission?.granted) {
                    await MediaLibrary.saveToLibraryAsync(tempCroppedPath);
                    console.log('Обрезанное изображение сохранено в галерею');
                    
                    // Удаляем временный файл
                    try {
                      await RNFS.unlink(tempCroppedPath);
                    } catch (deleteError) {
                      console.warn('Не удалось удалить временный файл:', deleteError);
                    }
                  }
                } else {
                  console.error('Не удалось получить base64 обрезанного изображения');
                }
              } catch (cropError) {
                console.error('Ошибка при обрезке изображения:', cropError);
              }
            } else {
              console.log('Не найдено детекций с достаточной уверенностью');
            }
          }
          
        } catch (modelError) {
          console.error('Ошибка при запуске модели:', modelError);
        }
      } else {
        console.log('Модель OBB не загружена');
      }

      // Очищаем буферы OpenCV
      OpenCV.clearBuffers();
      
      // Возвращаем пустую строку, так как теперь изображение обрабатывается внутри функции
      return '';
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
          await processImageWithOpenCV(photo.base64);
          
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
            await processImageWithOpenCV(base64Image);
            
            setLastPhotoSaved(true);
            
            if (Platform.OS !== 'web') {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
            
            // Скрыть индикатор успеха через 2 секунды
            setTimeout(() => setLastPhotoSaved(false), 2000);
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
          <Text style={styles.successText}>Обрезанное фото сохранено!</Text>
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
            Обрезанное изображение по OBB
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
              Сделайте фото или выберите из галереи для обрезки по OBB
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