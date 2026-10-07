// The app's entry point: background tasks have to be defined before the
// app loads (a background launch runs only them), then Expo Router starts.
import './src/lib/backgroundTasks';
import 'expo-router/entry';
