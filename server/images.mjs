import sharp from 'sharp';
import { AppError } from './errors.mjs';
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export async function validateImage(input) {
  if (!input || !['image/jpeg', 'image/png'].includes(input.type) || typeof input.data !== 'string') {
    throw new AppError('IMAGE_TYPE', 'Choose a JPEG or PNG image.');
  }
  if (input.data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.data)) {
    throw new AppError('IMAGE_SIZE', 'Images must be smaller than 8 MB.');
  }
  const bytes = Buffer.from(input.data, 'base64');
  if (!bytes.length || bytes.length >= MAX_FILE_BYTES) throw new AppError('IMAGE_SIZE', 'Images must be smaller than 8 MB.');
  try {
    const image = sharp(bytes, { limitInputPixels: 4096 * 4096, failOn: 'warning' });
    const info = await image.metadata();
    if (!['jpeg', 'png'].includes(info.format) || (info.pages || 1) !== 1) throw new Error('unsupported');
    if (info.width > 4096 || info.height > 4096 || info.width < 640 || info.height < 640) {
      throw new AppError('IMAGE_DIMENSIONS', 'Use an image from 640 to 4096 pixels on each side.');
    }
    if ((input.type === 'image/png') !== (info.format === 'png')) throw new Error('mismatch');
    // Re-encode rather than forwarding EXIF, hidden metadata, or original filenames.
    const buffer = await image.rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer();
    if (buffer.length >= MAX_FILE_BYTES) throw new AppError('IMAGE_SIZE', 'Re-encoded image is too large.');
    return { buffer, type: 'image/jpeg', width: info.width, height: info.height };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('IMAGE_INVALID', 'This file could not be decoded as a safe, single-frame JPEG or PNG.');
  }
}
