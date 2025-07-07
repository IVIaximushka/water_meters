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
  ScrollView,
  TextInput,
  Clipboard,
} from 'react-native';
import * as MediaLibrary from 'expo-media-library';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera';
import { Image as ImageIcon, CheckCircle, Camera as CameraIcon, FolderOpen, Copy } from 'lucide-react-native';
import { OpenCV, RotateFlags, ObjectType, DataTypes } from 'react-native-fast-opencv';
import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';
import RNFS from 'react-native-fs';
import { saveHistoryEntry, generateHistoryEntry } from '../../utils/storageUtils';

const { width, height } = Dimensions.get('window');

// Интерфейс для bounding box
interface Bbox {
  cls: number;
  conf: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

// Функция для получения цифр из bbox'ов
function getNumbers(boxes: Bbox[]): string {
  // Создаем копию массива для сортировки
  const sortedBoxes = [...boxes];
  
  // Сортируем по x координате
  sortedBoxes.sort((a, b) => a.x - b.x);
  
  let s = "";
  while (sortedBoxes.length > 0) {
    const box = sortedBoxes.pop()!;
    const similarBoxes = [box];
    
    while (sortedBoxes.length > 0) {
      const similarBox = sortedBoxes.pop()!;
      if (Math.abs(box.x - similarBox.x) < box.w / 3) {
        similarBoxes.push(similarBox);
      } else {
        sortedBoxes.push(similarBox);
        break;
      }
    }
    
    similarBoxes.sort((a, b) => a.cls - b.cls || a.conf - b.conf);
    const uniqueBoxes: Bbox[] = [];
    
    while (similarBoxes.length > 0) {
      const uniqueBox = similarBoxes.pop()!;
      uniqueBoxes.push(uniqueBox);
      while (similarBoxes.length > 0 && similarBoxes[similarBoxes.length - 1].cls === uniqueBox.cls) {
        similarBoxes.pop();
      }
    }
    
    if (uniqueBoxes.length === 1) {
      s = uniqueBoxes[0].cls.toString() + s;
    } else if (uniqueBoxes.length === 2) {
      const maxClass = Math.max(uniqueBoxes[0].cls, uniqueBoxes[1].cls);
      const minClass = Math.min(uniqueBoxes[0].cls, uniqueBoxes[1].cls);
      
      if (minClass > 0 && minClass + 1 === maxClass) {
        s = (s === "" || parseInt(s) === 0 ? maxClass.toString() : minClass.toString()) + s;
      } else if (minClass === 0 && maxClass === 9) {
        s = (s === "" || parseInt(s) === 0 ? minClass.toString() : maxClass.toString()) + s;
      } else {
        s = uniqueBoxes.reduce((prev, curr) => prev.conf > curr.conf ? prev : curr).cls.toString() + s;
      }
    } else {
      s = uniqueBoxes.reduce((prev, curr) => prev.conf > curr.conf ? prev : curr).cls.toString() + s;
    }
  }
  
  return s;
}

// Функция для преобразования в реальное число
function toRealNumber(number: string): string {
  const length = number.length;
  let realNumber: string;
  
  if (length >= 5 && length <= 8) {
    realNumber = parseFloat(number.slice(0, 5) + '.' + number.slice(5)).toString();
  } else if (length < 5) {
    realNumber = parseInt(number).toString();
  } else {
    realNumber = parseFloat(number.slice(0, -3) + '.' + number.slice(-3)).toString();
  }
  
  return `Распознанные цифры - ${number}\nПредполагаемые показания - ${realNumber}`;
}

export default function ImagePickerScreen() {
  const [mediaLibraryPermission, requestMediaLibraryPermission] = 
    MediaLibrary.usePermissions();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [lastPhotoSaved, setLastPhotoSaved] = useState(false);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [recognitionResult, setRecognitionResult] = useState<string | null>(null);
  const [editableReading, setEditableReading] = useState<string>('');
  const [showCamera, setShowCamera] = useState(false);
  const [cameraKey, setCameraKey] = useState(0);
  const [facing, setFacing] = useState<CameraType>('back');
  const [obbModel, setObbModel] = useState<TensorflowModel | null>(null);
  const [detectModel, setDetectModel] = useState<TensorflowModel | null>(null);
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);

  // Загрузка модели при монтировании компонента
  useEffect(() => {
    const loadModels = async () => {
      try {
        // Загрузка OBB модели
        const obbModel = await loadTensorflowModel(require('../../assets/weights/obb_float16.tflite'));
        setObbModel(obbModel);
        console.log('Модель OBB успешно загружена');
        
        // Загрузка detect модели
        const detectModel = await loadTensorflowModel(require('../../assets/weights/detect_float16.tflite'));
        setDetectModel(detectModel);
        console.log('Модель detect успешно загружена');
      } catch (error) {
        console.error('Ошибка при загрузке моделей:', error);
      }
    };
    loadModels();
  }, []);



  // Ручное сохранение в историю
  const handleSaveToHistory = async () => {
    if (!processedImage || !recognitionResult) return;
    
    try {
      // Создаем запись истории
      const historyEntry = generateHistoryEntry(
        originalImage ? `data:image/jpeg;base64,${originalImage}` : '',
        originalImage ? `data:image/jpeg;base64,${originalImage}` : '',
        recognitionResult,
        editableReading
      );
      
      // Сохраняем в AsyncStorage
      await saveHistoryEntry(historyEntry);
      
      console.log('Данные вручную сохранены в историю:', historyEntry.id);
      console.log('Структура записи:', {
        id: historyEntry.id,
        date: historyEntry.date,
        hasOriginalImage: !!historyEntry.originalImage,
        hasProcessedImage: !!historyEntry.processedImage,
        recognitionResult: historyEntry.recognitionResult,
        editedReading: historyEntry.editedReading
      });
      
      // Показываем уведомление
      Alert.alert('Успех', 'Данные сохранены в историю');
      
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (error) {
      console.error('Ошибка при сохранении в историю:', error);
      Alert.alert('Ошибка', 'Не удалось сохранить данные в историю');
    }
  };

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



  // Функция для поворота и вырезания прямоугольника с последующим добавлением черных границ
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
      const rotationMatrix = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC3);
      OpenCV.invoke('getRotationMatrix2D', center, angleDeg, 1.0, rotationMatrix);
      
      // Поворачиваем изображение
      const rotatedMat = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC3);
      const srcInfo = OpenCV.toJSValue(srcMat);
      const size = OpenCV.createObject(ObjectType.Size, srcInfo.cols, srcInfo.rows);
      OpenCV.invoke('warpAffine', srcMat, rotatedMat, rotationMatrix, size);

      // Обрезаем прямоугольник (не квадрат)
      const xInt = Math.floor(x);
      const yInt = Math.floor(y);
      const wInt = Math.floor(w);
      const hInt = Math.floor(h);
      
      const left = Math.max(0, xInt - Math.floor(wInt / 2));
      const top = Math.max(0, yInt - Math.floor(hInt / 2));
      const right = Math.min(srcInfo.cols, xInt + Math.floor(wInt / 2));
      const bottom = Math.min(srcInfo.rows, yInt + Math.floor(hInt / 2));

      const actualWidth = right - left;
      const actualHeight = bottom - top;
      
      console.log(`Обрезаем прямоугольник: ${actualWidth}x${actualHeight}`);

      // Создаем ROI для прямоугольника
      const rect = OpenCV.createObject(ObjectType.Rect, left, top, actualWidth, actualHeight);
      const croppedMat = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC3);
      OpenCV.invoke('crop', rotatedMat, croppedMat, rect);

      // Получаем размеры обрезанного изображения
      const croppedInfo = OpenCV.toJSValue(croppedMat);
      const croppedWidth = croppedInfo.cols;
      const croppedHeight = croppedInfo.rows;
      
      console.log(`Размеры обрезанного изображения: ${croppedWidth}x${croppedHeight}`);

      // Определяем коэффициент масштабирования для resize с сохранением пропорций
      const maxDimension = Math.max(croppedWidth, croppedHeight);
      const scaleFactor = 640 / maxDimension;
      
      const newWidth = Math.floor(croppedWidth * scaleFactor);
      const newHeight = Math.floor(croppedHeight * scaleFactor);
      
      console.log(`Новые размеры после resize: ${newWidth}x${newHeight}, scale: ${scaleFactor}`);

      // Выполняем resize с сохранением пропорций
      const resizedMat = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC3);
      const newSize = OpenCV.createObject(ObjectType.Size, newWidth, newHeight);
      OpenCV.invoke('resize', croppedMat, resizedMat, newSize, 0, 0, 1); // 1 = INTER_LINEAR

      // Вычисляем отступы для центрирования в квадрате 640x640
      const targetSize = 640;
      const top_pad = Math.floor((targetSize - newHeight) / 2);
      const bottom_pad = targetSize - newHeight - top_pad;
      const left_pad = Math.floor((targetSize - newWidth) / 2);
      const right_pad = targetSize - newWidth - left_pad;

      console.log(`Отступы: top=${top_pad}, bottom=${bottom_pad}, left=${left_pad}, right=${right_pad}`);

      // Создаем финальное изображение с черными границами
      const finalMat = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC3);
      const blackColor = OpenCV.createObject(ObjectType.Scalar, 0, 0, 0); // Черный цвет (BGR)
      
      OpenCV.invoke('copyMakeBorder', resizedMat, finalMat, top_pad, bottom_pad, left_pad, right_pad, 0, blackColor); // 0 = BORDER_CONSTANT

      return finalMat;
    } catch (error) {
      console.error('Ошибка при обрезке с черными границами:', error);
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
  const convertImageToFloat32Array = (srcMat: any): Float32Array => {
    try {
      console.log('Исходное изображение:', srcMat);
      
      // Получаем информацию об изображении
      const imageData = OpenCV.toJSValue(srcMat);
      console.log('Информация об изображении:', {
        width: imageData.cols,
        height: imageData.rows,
        size: imageData.size,
        type: imageData.type
      });
      
      // Создаем копию для изменения размера
      const resized = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC3);
      const targetSize = OpenCV.createObject(ObjectType.Size, 640, 640);
      OpenCV.invoke('resize', srcMat, resized, targetSize, 0, 0, 1);
      
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
      
      // Сохраняем оригинальное изображение
      setOriginalImage(base64Image);
      
      // Создаем Mat из base64 изображения
      const src = OpenCV.base64ToMat(base64Image);
      console.log(src)
      
      // Преобразуем изображение в Float32Array
      const floatArray = convertImageToFloat32Array(src);
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
                  
                  // Применяем detect модель к обрезанному изображению
                  if (detectModel) {
                    try {
                      console.log('Применяем detect модель к обрезанному изображению...');
                      
                      // Конвертируем обрезанное изображение в Float32Array
                      const croppedFloatArray = convertImageToFloat32Array(croppedMat);
                      console.log('Обрезанное изображение преобразовано в Float32Array:', croppedFloatArray.length, 'элементов');
                      
                      // Запускаем detect модель
                      const detectOutputs = detectModel.runSync([croppedFloatArray]);
                      console.log('Detect модель успешно выполнена!');
                      console.log('Количество выходных тензоров detect модели:', detectOutputs.length);
                      
                      if (detectOutputs.length > 0) {
                        const detectOutputTensor = detectOutputs[0];
                        console.log('Размер выходного тензора detect модели:', detectOutputTensor.length);
                        
                        // Применяем reshape(14, -1) и transpose
                        const detectReshapedMatrix = reshapeArray(detectOutputTensor, 14);
                        console.log('Detect матрица после reshape:', detectReshapedMatrix.length, 'строк');
                        
                        const detectTransposedMatrix = transposeMatrix(detectReshapedMatrix);
                        console.log('Detect матрица после transpose:', detectTransposedMatrix.length, 'строк');
                        
                        // Выводим первые 5 строк вывода модели
                        console.log('Первые 5 строк вывода detect модели:');
                        for (let i = 0; i < Math.min(5, detectTransposedMatrix.length); i++) {
                          console.log(`Строка ${i + 1}:`, detectTransposedMatrix[i]);
                        }
                        
                        // Проходим по строкам и вычисляем класс для каждой детекции
                        // Формат выхода: bbox координаты центра, ширина и высота x y w h, 10 уверенностей классов
                        interface Detection {
                          rowIndex: number;
                          x: number;
                          y: number;
                          w: number;
                          h: number;
                          predictedClass: number;
                          maxConfidence: number;
                          classConfidences: number[];
                        }
                        const filteredDetections: Detection[] = [];
                        const confidenceThreshold = 0.5;
                        let totalDetections = 0;
                        let filteredCount = 0;
                        
                        detectTransposedMatrix.forEach((row, rowIndex) => {
                          if (row.length >= 14) {
                            totalDetections++;
                            
                            const x = row[0]; // x координата центра
                            const y = row[1]; // y координата центра  
                            const w = row[2]; // ширина
                            const h = row[3]; // высота
                            
                            // Уверенности классов находятся в индексах 4-13 (10 классов)
                            const classConfidences = row.slice(4, 14);
                            
                            // Находим индекс наибольшей уверенности
                            let maxConfidenceIndex = 0;
                            let maxConfidence = classConfidences[0];
                            
                            for (let i = 1; i < classConfidences.length; i++) {
                              if (classConfidences[i] > maxConfidence) {
                                maxConfidence = classConfidences[i];
                                maxConfidenceIndex = i;
                              }
                            }
                            
                            // Класс = индекс наибольшей вероятности (без вычитания 4)
                            const predictedClass = maxConfidenceIndex;
                            
                            // Фильтруем по порогу confidence
                            if (maxConfidence > confidenceThreshold) {
                              filteredCount++;
                              filteredDetections.push({
                                rowIndex: rowIndex + 1,
                                x,
                                y,
                                w,
                                h,
                                predictedClass,
                                maxConfidence,
                                classConfidences
                              });
                            }
                          }
                        });
                        
                        console.log(`Всего детекций: ${totalDetections}, прошли фильтр (confidence > ${confidenceThreshold}): ${filteredCount}`);
                        
                        // Группируем детекции по классам
                        const detectionsByClass: { [key: number]: Detection[] } = {};
                        
                        filteredDetections.forEach((detection) => {
                          if (!detectionsByClass[detection.predictedClass]) {
                            detectionsByClass[detection.predictedClass] = [];
                          }
                          detectionsByClass[detection.predictedClass].push(detection);
                        });
                        
                        // Сортируем детекции в каждом классе по убыванию уверенности и выводим по 10 лучших
                        console.log(`Найдено ${filteredDetections.length} детекций:`);
                        console.log(`Детекции сгруппированы по ${Object.keys(detectionsByClass).length} классам:`);
                        
                        Object.keys(detectionsByClass).forEach((classKey) => {
                          const classIndex = parseInt(classKey);
                          const classDetections = detectionsByClass[classIndex];
                          
                          // Сортируем по убыванию уверенности
                          classDetections.sort((a, b) => b.maxConfidence - a.maxConfidence);
                          
                          // Берем первые 10 детекций для этого класса
                          const top10 = classDetections.slice(0, 10);
                          
                          console.log(`\n=== КЛАСС ${classIndex} (${classDetections.length} детекций) ===`);
                          console.log(`Топ-${top10.length} детекций для класса ${classIndex}:`);
                          
                          top10.forEach((detection, index) => {
                            console.log(`${index + 1}. Детекция ${detection.rowIndex}:`);
                            console.log(`   Координаты центра: x=${detection.x.toFixed(4)}, y=${detection.y.toFixed(4)}`);
                            console.log(`   Размеры: w=${detection.w.toFixed(4)}, h=${detection.h.toFixed(4)}`);
                            console.log(`   Уверенность: ${detection.maxConfidence.toFixed(4)}`);
                            console.log(`   Все уверенности классов:`, detection.classConfidences.map((c: number) => c.toFixed(4)));
                          });
                        });

                        // Создаем массив Bbox для функции getNumbers
                        const bboxes: Bbox[] = filteredDetections.map((detection) => ({
                          cls: detection.predictedClass,
                          conf: detection.maxConfidence,
                          x: detection.x,
                          y: detection.y,
                          w: detection.w,
                          h: detection.h
                        }));

                        console.log('\n=== РАСПОЗНАВАНИЕ ЦИФР ===');
                        console.log('Создано bbox\'ов для обработки:', bboxes.length);
                        
                        if (bboxes.length > 0) {
                          try {
                            const digits = getNumbers(bboxes);
                            console.log('Распознанные цифры:', digits);
                            
                            if (digits && digits.length > 0) {
                              const result = toRealNumber(digits);
                              console.log('Результат распознавания:', result);
                              
                              // Устанавливаем результат для отображения на экране
                              setRecognitionResult(result);
                              
                              // Извлекаем только предполагаемые показания для редактирования
                              const lines = result.split('\n');
                              const readingLine = lines.find(line => line.includes('Предполагаемые показания - '));
                              if (readingLine) {
                                const reading = readingLine.split('Предполагаемые показания - ')[1];
                                setEditableReading(reading || '');
                              }
                            } else {
                              console.log('Цифры не распознаны');
                              setRecognitionResult('Цифры не распознаны');
                              setEditableReading('');
                            }
                          } catch (error) {
                            console.error('Ошибка при распознавании цифр:', error);
                            setRecognitionResult('Ошибка при распознавании цифр');
                          }
                        } else {
                          console.log('Нет bbox\'ов для обработки');
                          setRecognitionResult('Нет обнаруженных цифр');
                          setEditableReading('');
                        }
                      }
                      
                    } catch (detectError) {
                      console.error('Ошибка при запуске detect модели:', detectError);
                    }
                  } else {
                    console.log('Detect модель не загружена');
                  }
                  
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
    } finally {
      setIsProcessing(false);
    }
  };

  // Съемка фотографии
  const takePicture = async () => {
    if (!cameraRef.current || isCapturing) return;
    
    setIsCapturing(true);
    setLastPhotoSaved(false);
    setRecognitionResult(null);
    setEditableReading('');
    setOriginalImage(null);
    
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



  // Копирование в буфер обмена
  const copyToClipboard = async (text: string) => {
    try {
      await Clipboard.setString(text);
      Alert.alert('Успех', 'Показания скопированы в буфер обмена');
      
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (error) {
      console.error('Ошибка при копировании:', error);
      Alert.alert('Ошибка', 'Не удалось скопировать показания');
    }
  };

  // Выбор фото из галереи
  const pickImageFromGallery = async () => {
    if (isProcessing) return;
    
    setIsProcessing(true);
    setLastPhotoSaved(false);
    setRecognitionResult(null);
    setEditableReading('');
    setOriginalImage(null);
    
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
        <View style={styles.processedImageContainer}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => {
              if (Platform.OS !== 'web') {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }
              setProcessedImage(null);
              setRecognitionResult(null);
              setEditableReading('');
              setOriginalImage(null);
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.closeButtonText}>×</Text>
          </TouchableOpacity>
          
          <ScrollView 
            style={styles.resultsScrollView}
            contentContainerStyle={styles.resultsContainer}
            showsVerticalScrollIndicator={false}
          >
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
            
            {recognitionResult && (
              <View style={styles.recognitionResultContainer}>
                <Text style={styles.recognitionResultTitle}>
                  Результат распознавания:
                </Text>
                <Text style={styles.recognitionResultText}>
                  {recognitionResult}
                </Text>
                
                <View style={styles.editableContainer}>
                  <Text style={styles.editableLabel}>
                    Показания счетчика:
                  </Text>
                  <View style={styles.inputContainer}>
                    <TextInput
                      style={styles.editableInput}
                      value={editableReading}
                      onChangeText={setEditableReading}
                      placeholder="Введите показания"
                      keyboardType="numeric"
                      selectTextOnFocus
                    />
                    <TouchableOpacity
                      style={styles.copyIconButton}
                      onPress={() => copyToClipboard(editableReading)}
                      disabled={!editableReading.trim()}
                    >
                      <Copy size={20} color={editableReading.trim() ? "#4CAF50" : "#ccc"} />
                    </TouchableOpacity>
                  </View>
                  
                  <TouchableOpacity
                    style={styles.saveButton}
                    onPress={handleSaveToHistory}
                    disabled={!processedImage || !recognitionResult}
                  >
                    <Text style={styles.saveButtonText}>
                      Сохранить
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>
        </View>
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
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    zIndex: 1001,
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
  resultsScrollView: {
    flex: 1,
    width: '100%',
  },
  resultsContainer: {
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 20,
  },
  recognitionResultContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 15,
    padding: 20,
    marginTop: 20,
    marginHorizontal: 20,
    alignItems: 'center',
  },
  recognitionResultTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
    textAlign: 'center',
  },
  recognitionResultText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
  },
  editableContainer: {
    marginTop: 20,
    width: '100%',
    alignItems: 'center',
  },
  editableLabel: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
    gap: 12,
  },
  editableInput: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 15,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#ddd',
    textAlign: 'center',
  },
  copyIconButton: {
    padding: 12,
    borderRadius: 25,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },

  saveButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
    width: '100%',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});