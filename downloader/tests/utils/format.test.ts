import { filenameFromUrl, formatBytes, looksLikeArchive } from '../../src/utils/format.js';

describe('format utils', () => {
  describe('filenameFromUrl', () => {
    it('应该从 URL 提取文件名', () => {
      expect(filenameFromUrl('https://example.com/test.7z')).toBe('test.7z');
      expect(filenameFromUrl('https://example.com/path/to/game.zip')).toBe('game.zip');
    });

    it('应该处理编码的文件名', () => {
      const url = 'https://example.com/%E5%8D%83%E6%81%8B%E4%B8%87%E8%8A%B1.7z';
      expect(filenameFromUrl(url)).toBe('千恋万花.7z');
    });

    it('应该处理无文件名的 URL', () => {
      expect(filenameFromUrl('https://example.com/')).toBeUndefined();
      expect(filenameFromUrl('https://example.com')).toBeUndefined();
    });
  });

  describe('formatBytes', () => {
    it('应该格式化字节大小', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(1024)).toBe('1.00 KB');
      expect(formatBytes(1024 * 1024)).toBe('1.00 MB');
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB');
      expect(formatBytes(1536 * 1024 * 1024)).toBe('1.50 GB');
    });

    it('应该处理 undefined', () => {
      expect(formatBytes(undefined)).toBe('大小未知');
    });
  });

  describe('looksLikeArchive', () => {
    it('应该识别压缩包扩展名', () => {
      expect(looksLikeArchive('/path/to/file.7z')).toBe(true);
      expect(looksLikeArchive('/path/to/file.zip')).toBe(true);
      expect(looksLikeArchive('/path/to/file.rar')).toBe(true);
      expect(looksLikeArchive('/path/to/file.tar.gz')).toBe(true);
    });

    it('应该拒绝非压缩包文件', () => {
      expect(looksLikeArchive('/path/to/file.txt')).toBe(false);
      expect(looksLikeArchive('/path/to/file')).toBe(false);
    });

    it('应该接受 .exe 文件（自解压）', () => {
      expect(looksLikeArchive('/path/to/file.exe')).toBe(true);
    });

    it('应该处理大小写', () => {
      expect(looksLikeArchive('/path/to/FILE.7Z')).toBe(true);
      expect(looksLikeArchive('/path/to/FILE.ZIP')).toBe(true);
    });
  });
});
