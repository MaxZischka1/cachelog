import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Write text to a cache file and open the share sheet (AirDrop, Files, Mail...). */
export async function shareTextFile(fileName: string, content: string, opts: { mimeType: string; UTI?: string; dialogTitle?: string }): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  await file.write(content);
  await Sharing.shareAsync(file.uri, { mimeType: opts.mimeType, UTI: opts.UTI, dialogTitle: opts.dialogTitle ?? fileName });
}

export interface PickedFile {
  uri: string;
  name: string;
}

/** Opens the document picker; resolves null when the user cancels. */
export async function pickFile(): Promise<PickedFile | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets || res.assets.length === 0) return null;
  const a = res.assets[0];
  return { uri: a.uri, name: a.name };
}

export async function readTextFile(uri: string): Promise<string> {
  return new File(uri).text();
}
