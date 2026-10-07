import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

// Picks a player-card photo: cropped to the card's portrait shape, sized
// down and saved as JPEG before it's uploaded to the private bucket.
const CARD_WIDTH = 900;

export async function pickCardPhoto(): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [3, 4], quality: 1 });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  let context = ImageManipulator.manipulate(asset.uri);
  if (asset.width > CARD_WIDTH) context = context.resize({ width: CARD_WIDTH });
  const rendered = await context.renderAsync();
  return (await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 })).uri;
}
