# Checksum verification for eh-viewer / eh-runall single exes.
#
# Verifies every "<name>.sha256" sidecar found next to the given folder
# (default: the folder containing this script). Sidecar format is the
# shasum/certutil-compatible line: "<sha256> *<filename>".
#
# Usage:
#   powershell -NoProfile -File verify_checksums.ps1 [folder]
#
# Exit code 0 = all files verified OK / nothing to verify,
#              1 = any mismatch or missing file.
param(
    [string]$Folder = $PSScriptRoot
)

$ErrorActionPreference = "Stop"
$Folder = (Resolve-Path $Folder).Path

$sidecars = Get-ChildItem -Path $Folder -Filter "*.sha256" -File | Sort-Object Name
if ($sidecars.Count -eq 0) {
    Write-Host "No .sha256 files found in $Folder"
    exit 0
}

$failed = 0
foreach ($sc in $sidecars) {
    $line = (Get-Content $sc.FullName -TotalCount 1).Trim()
    # "<hex> *<file>" or "<hex>  <file>" (2 chars separator)
    if ($line -notmatch '^([0-9a-fA-F]{64})\s+\*?(.+)$') {
        Write-Host ("SKIP (unparsable): {0}" -f $sc.Name) -ForegroundColor Yellow
        continue
    }
    $expected = $Matches[1].ToLower()
    $target = Join-Path $Folder $Matches[2].Trim()

    if (-not (Test-Path $target)) {
        Write-Host ("MISSING:  {0} (listed in {1})" -f $Matches[2], $sc.Name) -ForegroundColor Red
        $failed++
        continue
    }

    $actual = (Get-FileHash -Path $target -Algorithm SHA256).Hash.ToLower()
    if ($actual -eq $expected) {
        Write-Host ("OK:       {0}" -f $Matches[2]) -ForegroundColor Green
    } else {
        Write-Host ("MISMATCH: {0}" -f $Matches[2]) -ForegroundColor Red
        Write-Host ("          expected: {0}" -f $expected) -ForegroundColor Red
        Write-Host ("          actual:   {0}" -f $actual) -ForegroundColor Red
        $failed++
    }
}

if ($failed -gt 0) {
    Write-Host ("`n{0} file(s) FAILED verification. Do not run them." -f $failed) -ForegroundColor Red
    exit 1
}
Write-Host "`nAll files verified OK."
exit 0
