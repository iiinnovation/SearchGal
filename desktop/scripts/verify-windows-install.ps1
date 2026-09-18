# Run on a disposable Windows x64 test account with an interactive desktop.
# Node/npm are used by the test harness; clean-machine acceptance is a separate manual gate.
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Installer)

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem) {
    throw 'Windows x64 is required.'
}
$desktopRoot = Split-Path $PSScriptRoot -Parent
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$reportDirectory = Join-Path $desktopRoot 'verification/windows-install'
New-Item -ItemType Directory -Force -Path $reportDirectory | Out-Null
$registryRoots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$existing = Get-ItemProperty -Path $registryRoots -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like 'SearchGal*' }
if ($existing -or (Get-Process -Name SearchGal -ErrorAction SilentlyContinue)) {
    throw 'An existing SearchGal installation/process was found. Use a disposable test account or VM.'
}
$shortcuts = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'SearchGal.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Programs')) 'SearchGal.lnk')
)
foreach ($shortcut in $shortcuts) {
    if (Test-Path -LiteralPath $shortcut) { throw "Existing shortcut must be preserved: $shortcut" }
}
# NSIS /D= must be the final argument and must not be quoted, even with spaces.
$installDirectory = Join-Path $env:TEMP ('SearchGal 安装验收 ' + [Guid]::NewGuid().ToString('N'))
$executable = Join-Path $installDirectory 'SearchGal.exe'
$report = [ordered]@{
    timestamp = (Get-Date).ToUniversalTime().ToString('o')
    os = [Environment]::OSVersion.VersionString
    architecture = $env:PROCESSOR_ARCHITECTURE
    installer = $installerPath
    sha256 = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash
    installDirectory = $installDirectory
    scope = 'NSIS current-user install, shortcuts, installed Electron E2E, uninstall; not clean-machine or physical desktop acceptance'
    install = 'not-run'; shortcuts = 'not-run'; interaction = 'not-run'; uninstall = 'not-run'
    result = 'failed'
}
$previousExecutable = $env:SEARCHGAL_TEST_EXECUTABLE
Push-Location $desktopRoot
try {
    $process = Start-Process -FilePath $installerPath -ArgumentList "/S /currentuser /D=$installDirectory" -Wait -PassThru
    if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $executable)) {
        throw "Installer failed: exit $($process.ExitCode)"
    }
    $report.install = 'passed'
    $wsh = New-Object -ComObject WScript.Shell
    foreach ($shortcut in $shortcuts) {
        if (-not (Test-Path -LiteralPath $shortcut)) { throw "Missing shortcut: $shortcut" }
        if ($wsh.CreateShortcut($shortcut).TargetPath -ne $executable) { throw "Wrong shortcut target: $shortcut" }
    }
    $report.shortcuts = 'passed'
    $env:SEARCHGAL_TEST_EXECUTABLE = $executable
    & npm.cmd run test:e2e
    if ($LASTEXITCODE -ne 0) { throw "Installed application E2E failed: exit $LASTEXITCODE" }
    $report.interaction = 'passed'
    $report.result = 'passed'
} catch {
    $report.error = $_.Exception.Message
    throw
} finally {
    $env:SEARCHGAL_TEST_EXECUTABLE = $previousExecutable
    try {
        $uninstaller = Join-Path $installDirectory 'Uninstall SearchGal.exe'
        if (Test-Path -LiteralPath $uninstaller) {
            $process = Start-Process -FilePath $uninstaller -ArgumentList "/S /currentuser _?=$installDirectory" -Wait -PassThru
            if ($process.ExitCode -ne 0 -or (Test-Path -LiteralPath $executable)) {
                throw "Uninstall failed: exit $($process.ExitCode)"
            }
            foreach ($shortcut in $shortcuts) {
                if (Test-Path -LiteralPath $shortcut) { throw "Shortcut remains after uninstall: $shortcut" }
            }
            $report.uninstall = 'passed'
        } else {
            throw 'Uninstaller was not created.'
        }
    } catch {
        $report.result = 'failed'
        $report.uninstall = 'failed'
        $report.uninstallError = $_.Exception.Message
        Write-Warning $_.Exception.Message
    } finally {
        $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $reportDirectory 'result.json') -Encoding utf8
        Pop-Location
    }
}
if ($report.result -ne 'passed') { throw 'Windows installation verification failed; see verification/windows-install/result.json.' }
