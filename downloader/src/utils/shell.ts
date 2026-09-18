/** Windows examples target PowerShell; other platforms target POSIX shells. */
export function extractionCommand(path: string, password: string, platform = process.platform): string {
  const quote = (value: string) => platform === 'win32'
    ? `'${value.replace(/'/g, "''")}'`
    : `'${value.replace(/'/g, "'\\''")}'`;
  return `7z x ${quote(path)} ${quote('-p' + password)}`;
}
