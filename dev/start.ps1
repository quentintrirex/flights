# Local preview: http://localhost:8782 (no PIN gate locally; demo prices unless data/config.php has a token)
$php = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\PHP.PHP.8.3_*\php.exe" | Select-Object -First 1
$env:OPENSSL_CONF = Join-Path $php.DirectoryName 'extras\ssl\openssl.cnf'
& $php.FullName -c "$PSScriptRoot\php.ini" -S localhost:8782 -t (Split-Path $PSScriptRoot)
