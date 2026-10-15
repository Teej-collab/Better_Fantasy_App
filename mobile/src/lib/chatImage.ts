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

// Videos: up to the backend's 3 minutes (app/domain/chat_video.py).
// From the library, iOS exports H.264 at 720p, which the backend can
// store as-is instead of converting; a fresh recording is converted
// there if it needs to be.
export const MAX_CHAT_VIDEO_SECONDS = 180;

export async function pickChatVideo(source: PhotoSource): Promise<string | null> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return null;
  }
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['videos'],
          videoMaxDuration: MAX_CHAT_VIDEO_SECONDS,
          videoQuality: ImagePicker.UIImagePickerControllerQualityType.High,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['videos'],
          videoMaxDuration: MAX_CHAT_VIDEO_SECONDS,
          videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
        });
  if (result.canceled || !result.assets[0]) return null;
  return result.assets[0].uri;
}
