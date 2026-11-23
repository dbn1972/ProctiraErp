/**
 * PRC-L200: compare a file's declared type (client MIME and file-name
 * extension) with its leading magic bytes. Types without a known signature
 * are not sniffed. This is early UX feedback; the server sniff and malware
 * scan stay authoritative (topic 18).
 */
type Kind = 'pdf' | 'png' | 'jpeg' | 'gif' | 'zip' | 'ole';

const MIME_KIND: Record<string, Kind> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/gif': 'gif',
  'application/zip': 'zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'zip',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'zip',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'zip',
  'application/msword': 'ole',
  'application/vnd.ms-excel': 'ole',
  'application/vnd.ms-powerpoint': 'ole',
};

const EXT_KIND: Record<string, Kind> = {
  '.pdf': 'pdf',
  '.png': 'png',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.gif': 'gif',
  '.zip': 'zip',
  '.docx': 'zip',
  '.xlsx': 'zip',
  '.pptx': 'zip',
  '.doc': 'ole',
  '.xls': 'ole',
  '.ppt': 'ole',
};

const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));

const SIGNATURES: Record<Kind, number[][]> = {
  pdf: [ascii('%PDF-')],
  png: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  jpeg: [[0xff, 0xd8, 0xff]],
  gif: [ascii('GIF87a'), ascii('GIF89a')],
  zip: [
    [0x50, 0x4b, 0x03, 0x04],
    [0x50, 0x4b, 0x05, 0x06],
    [0x50, 0x4b, 0x07, 0x08],
  ],
  ole: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]],
};

const HEADER_BYTES = 8;

function claimedKinds(file: File): Kind[] {
  const kinds = new Set<Kind>();
  const byMime = MIME_KIND[file.type.toLowerCase()];
  if (byMime) kinds.add(byMime);
  const dot = file.name.lastIndexOf('.');
  const byExt = dot >= 0 ? EXT_KIND[file.name.slice(dot).toLowerCase()] : undefined;
  if (byExt) kinds.add(byExt);
  return [...kinds];
}

function readHeader(file: File): Promise<Uint8Array> {
  const blob = file.slice(0, HEADER_BYTES);
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer().then((buf) => new Uint8Array(buf));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsArrayBuffer(blob);
  });
}

function startsWith(header: Uint8Array, signature: number[]): boolean {
  return header.length >= signature.length && signature.every((b, i) => header[i] === b);
}

/** True when the bytes match every type the file claims (or it claims none we know). */
export async function contentMatchesDeclaredType(file: File): Promise<boolean> {
  const kinds = claimedKinds(file);
  if (kinds.length === 0) return true;
  const header = await readHeader(file);
  return kinds.every((kind) => SIGNATURES[kind].some((sig) => startsWith(header, sig)));
}
