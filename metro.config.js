const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Добавляем поддержку .tflite файлов
config.resolver.assetExts.push('tflite');

module.exports = config; 