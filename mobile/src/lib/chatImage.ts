import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

// Phone photos are several MB; this keeps uploads around 0.5 MB, under
// the upload route's 4 MB cap, with plenty of detail for a chat bubble.
const MAX_WIDTH = 1600;
const JPEG_QUALITY = 0.7;

export type PhotoSource = 'library' | 'camera';

// Resolves with a local JPEG ready to upload, or null if the person
// canceled or didn't grant access.
export async function pickChatPhoto(source: PhotoSource): Promise<string | null> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return null;
  }
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  let context = ImageManipulator.manipulate(asset.uri);
  if (asset.width > MAX_WIDTH) context = context.resize({ width: MAX_WIDTH });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
  return saved.uri;
}
