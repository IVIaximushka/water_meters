import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  Dimensions,
  Modal,
  RefreshControl,
} from 'react-native';
import { Trash2, Calendar, Image as ImageIcon } from 'lucide-react-native';
import { getHistory, deleteHistoryEntry, HistoryEntry, createTestEntry } from '../../utils/storageUtils';

const { width } = Dimensions.get('window');

export default function HistoryScreen() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Загрузка истории при монтировании
  useEffect(() => {
    console.log('Компонент History загружен, начинаем загрузку истории');
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      console.log('Загрузка истории...');
      const savedHistory = await getHistory();
      console.log('Получено записей:', savedHistory.length);
      setHistory(savedHistory);
    } catch (error) {
      console.error('Ошибка при загрузке истории:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadHistory();
    setRefreshing(false);
  };

  const deleteEntry = async (id: string) => {
    Alert.alert(
      'Удаление записи',
      'Вы уверены, что хотите удалить эту запись?',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteHistoryEntry(id);
              const updatedHistory = history.filter(entry => entry.id !== id);
              setHistory(updatedHistory);
            } catch (error) {
              console.error('Ошибка при удалении записи:', error);
            }
          },
        },
      ]
    );
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const openModal = (entry: HistoryEntry) => {
    setSelectedEntry(entry);
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setSelectedEntry(null);
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Загрузка истории...</Text>
      </View>
    );
  }

  if (history.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <ImageIcon size={80} color="#666" />
        <Text style={styles.emptyTitle}>История пуста</Text>
        <Text style={styles.emptySubtitle}>
          Сделайте фотографию счетчика и нажмите кнопку "Сохранить" для добавления записи в историю
        </Text>
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={styles.refreshButton}
            onPress={() => {
              console.log('Обновление истории из пустого состояния');
              loadHistory();
            }}
          >
            <Text style={styles.refreshButtonText}>Проверить историю</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.refreshButton, { backgroundColor: '#4CAF50' }]}
            onPress={() => {
              console.log('Создание тестовой записи');
              createTestEntry();
              loadHistory();
            }}
          >
            <Text style={styles.refreshButtonText}>Создать тестовую запись</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>История показаний</Text>
          <Text style={styles.headerSubtitle}>
            Всего записей: {history.length}
          </Text>
          <TouchableOpacity
            style={styles.refreshButton}
            onPress={() => {
              console.log('Обновление истории вручную');
              loadHistory();
            }}
          >
            <Text style={styles.refreshButtonText}>Обновить</Text>
          </TouchableOpacity>
        </View>

        {history.map((entry) => (
          <TouchableOpacity
            key={entry.id}
            style={styles.historyItem}
            onPress={() => openModal(entry)}
          >
            <View style={styles.itemContent}>
              <Image
                source={{ uri: entry.processedImage }}
                style={styles.thumbnail}
                resizeMode="cover"
              />
              <View style={styles.itemInfo}>
                <Text style={styles.itemDate}>
                  {formatDate(entry.timestamp)}
                </Text>
                <Text style={styles.itemReading}>
                  Показания: {entry.editedReading || 'Не указано'}
                </Text>
                <Text style={styles.itemResult} numberOfLines={2}>
                  {entry.recognitionResult}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => deleteEntry(entry.id)}
              >
                <Trash2 size={24} color="#ff4444" />
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Модальное окно для просмотра полной записи */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={closeModal}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={closeModal}
            >
              <Text style={styles.closeButtonText}>×</Text>
            </TouchableOpacity>

            {selectedEntry && (
              <ScrollView style={styles.modalScrollView}>
                <Text style={styles.modalTitle}>
                  {formatDate(selectedEntry.timestamp)}
                </Text>

                <View style={styles.imageContainer}>
                  <Text style={styles.imageTitle}>Обработанное изображение:</Text>
                  <Image
                    source={{ uri: selectedEntry.processedImage }}
                    style={styles.modalImage}
                    resizeMode="contain"
                  />
                </View>

                <View style={styles.resultContainer}>
                  <Text style={styles.resultTitle}>Результат распознавания:</Text>
                  <Text style={styles.resultText}>
                    {selectedEntry.recognitionResult}
                  </Text>
                </View>

                <View style={styles.readingContainer}>
                  <Text style={styles.readingTitle}>Показания счетчика:</Text>
                  <Text style={styles.readingText}>
                    {selectedEntry.editedReading || 'Не указано'}
                  </Text>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    padding: 20,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 20,
    marginBottom: 10,
  },
  emptySubtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 24,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    padding: 20,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 5,
  },
  headerSubtitle: {
    fontSize: 16,
    color: '#666',
  },
  historyItem: {
    backgroundColor: '#fff',
    marginHorizontal: 15,
    marginVertical: 8,
    borderRadius: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  itemContent: {
    flexDirection: 'row',
    padding: 15,
    alignItems: 'center',
  },
  thumbnail: {
    width: 80,
    height: 80,
    borderRadius: 10,
    backgroundColor: '#f0f0f0',
  },
  itemInfo: {
    flex: 1,
    marginLeft: 15,
  },
  itemDate: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 5,
  },
  itemReading: {
    fontSize: 14,
    color: '#007AFF',
    marginBottom: 5,
    fontWeight: '500',
  },
  itemResult: {
    fontSize: 12,
    color: '#666',
    lineHeight: 16,
  },
  deleteButton: {
    padding: 10,
    marginLeft: 10,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    width: width - 40,
    maxHeight: '80%',
  },
  closeButton: {
    alignSelf: 'flex-end',
    width: 40,
    height: 40,
    backgroundColor: '#f0f0f0',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  closeButtonText: {
    fontSize: 24,
    color: '#666',
    fontWeight: 'bold',
  },
  modalScrollView: {
    maxHeight: '100%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    marginBottom: 20,
  },
  imageContainer: {
    marginBottom: 20,
  },
  imageTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  modalImage: {
    width: '100%',
    height: 200,
    borderRadius: 10,
    backgroundColor: '#f0f0f0',
  },
  resultContainer: {
    marginBottom: 20,
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  resultText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  readingContainer: {
    marginBottom: 20,
  },
  readingTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  readingText: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '500',
  },
  refreshButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 15,
    marginTop: 10,
    alignSelf: 'center',
  },
  refreshButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  buttonContainer: {
    marginTop: 20,
    gap: 10,
  },
}); 