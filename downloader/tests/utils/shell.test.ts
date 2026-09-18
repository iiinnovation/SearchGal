import { spawnSync } from 'node:child_process';
import { extractionCommand } from '../../src/utils/shell.js';

describe('extraction command quoting', () => {
  (process.platform === 'win32' ? it.skip : it)('passes hostile filenames and passwords as literal POSIX arguments', () => {
    const path = '/tmp/game "$(printf INJECTED)"\' archive.zip';
    const password = '$(printf INJECTED)`printf INJECTED`\'";$HOME\\secret';
    const command = extractionCommand(path, password, 'darwin').replace(/^7z /, 'capture ');
    const result = spawnSync('/bin/sh', ['-c', 'capture() { printf "%s\\000" "$@"; }; ' + command], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout.split('\0')).toEqual(['x', path, '-p' + password, '']);
  });

  it('uses PowerShell literal strings on Windows', () => {
    expect(extractionCommand("C:\\game's.zip", "a'$(Get-Date)", 'win32'))
      .toBe("7z x 'C:\\game''s.zip' '-pa''$(Get-Date)'");
  });
});
