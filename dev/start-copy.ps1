# Local preview on a COPY of a database (FLIGHTS_DB), port 8783: http://localhost:8783
param([string]$db = 'C:\Users\ADMINI~1\AppData\Local\Temp\fl\try.sqlite')
$php = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\PHP.PHP.8.3_*\php.exe" | Select-Object -First 1
$env:OPENSSL_CONF = Join-Path $php.DirectoryName 'extras\ssl\openssl.cnf'
$env:FLIGHTS_DB = $db
$env:FLIGHTS_NO_PUSH = '1'
& $php.FullName -c "$PSScriptRoot\php.ini" -S localhost:8783 -t (Split-Path $PSScriptRoot)
