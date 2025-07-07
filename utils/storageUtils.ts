// import AsyncStorage from '@react-native-async-storage/async-storage';

export interface HistoryEntry {
  id: string;
  date: string;
  originalImage: string;      // оригинальное фото (до обработки)
  processedImage: string;     // оригинальное фото (сохраняется то же что и originalImage)
  recognitionResult: string;  // результат распознавания
  editedReading: string;      // показания пользователя
  timestamp: number;
}

const STORAGE_KEY = 'waterMeterHistory';

// Временное хранилище в памяти для демонстрации
let memoryStorage: HistoryEntry[] = [];

// Функция для создания тестовой записи (только для отладки)
export const createTestEntry = () => {
  const testEntry = generateHistoryEntry(
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA/8A',
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA/8A',
    'Тестовая запись - для проверки функциональности',
    '12345'
  );
  
  memoryStorage.push(testEntry);
  console.log('Добавлена тестовая запись:', testEntry.id);
};

export const saveHistoryEntry = async (entry: HistoryEntry): Promise<void> => {
  try {
    // Добавляем новую запись в начало массива
    memoryStorage = [entry, ...memoryStorage];
    
    // Ограничиваем количество записей (например, до 100)
    if (memoryStorage.length > 100) {
      memoryStorage = memoryStorage.slice(0, 100);
    }
    
    // Для будущего использования с AsyncStorage:
    // await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(memoryStorage));
    
    console.log('История сохранена:', entry.id);
    console.log('Всего записей в истории:', memoryStorage.length);
  } catch (error) {
    console.error('Ошибка при сохранении записи в историю:', error);
    throw error;
  }
};

export const getHistory = async (): Promise<HistoryEntry[]> => {
  try {
    // Возвращаем данные из временного хранилища
    const sortedHistory = memoryStorage.sort((a: HistoryEntry, b: HistoryEntry) => b.timestamp - a.timestamp);
    console.log('Загружено записей из истории:', sortedHistory.length);
    
    // Для будущего использования с AsyncStorage:
    // const savedHistory = await AsyncStorage.getItem(STORAGE_KEY);
    // if (savedHistory) {
    //   const parsedHistory = JSON.parse(savedHistory);
    //   return parsedHistory.sort((a: HistoryEntry, b: HistoryEntry) => b.timestamp - a.timestamp);
    // }
    
    return sortedHistory;
  } catch (error) {
    console.error('Ошибка при загрузке истории:', error);
    return [];
  }
};

export const deleteHistoryEntry = async (id: string): Promise<void> => {
  try {
    // Удаляем запись из временного хранилища
    memoryStorage = memoryStorage.filter(entry => entry.id !== id);
    
    // Для будущего использования с AsyncStorage:
    // await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(memoryStorage));
    
    console.log('Запись удалена:', id);
    console.log('Осталось записей в истории:', memoryStorage.length);
  } catch (error) {
    console.error('Ошибка при удалении записи:', error);
    throw error;
  }
};

export const updateHistoryEntryReading = async (id: string, editedReading: string): Promise<void> => {
  try {
    // Обновляем запись в временном хранилище
    memoryStorage = memoryStorage.map(entry => 
      entry.id === id ? { ...entry, editedReading } : entry
    );
    
    // Для будущего использования с AsyncStorage:
    // await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(memoryStorage));
    
    console.log('Показания обновлены для записи:', id);
  } catch (error) {
    console.error('Ошибка при обновлении показаний:', error);
    throw error;
  }
};

export const clearHistory = async (): Promise<void> => {
  try {
    // Очищаем временное хранилище
    memoryStorage = [];
    
    // Для будущего использования с AsyncStorage:
    // await AsyncStorage.removeItem(STORAGE_KEY);
    
    console.log('История очищена');
  } catch (error) {
    console.error('Ошибка при очистке истории:', error);
    throw error;
  }
};

export const generateHistoryEntry = (
  originalImage: string,
  processedImage: string,
  recognitionResult: string,
  editedReading: string = ''
): HistoryEntry => {
  const timestamp = Date.now();
  const date = new Date(timestamp).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return {
    id: `entry_${timestamp}_${Math.random().toString(36).substring(2, 15)}`,
    date,
    originalImage,
    processedImage,
    recognitionResult,
    editedReading,
    timestamp,
  };
}; 