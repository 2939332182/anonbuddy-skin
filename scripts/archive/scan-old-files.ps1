$ErrorActionPreference = 'Continue'
$outDir = 'D:\anonbuddy-skin\cleanup-audit'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$cut = (Get-Date).AddMonths(-18)
Write-Host "Cutoff date (files not accessed since): $($cut.ToString('yyyy-MM-dd'))"

$dirs = @(
  'C:\Users\ZhuanZ\Desktop',
  'C:\Users\ZhuanZ\Downloads',
  'C:\Users\ZhuanZ\Documents',
  'C:\Users\ZhuanZ\Videos',
  'C:\Users\ZhuanZ\Pictures',
  'C:\Users\ZhuanZ\Music',
  'C:\Temp',
  'D:\123pan',
  'D:\360Downloads',
  'D:\BaiduNetdiskDownload',
  'D:\GameVideos',
  'D:\夸克',
  'D:\网盘',
  'D:\.temp',
  'D:\steam美化插件',
  'C:\图吧工具箱',
  'C:\新建文件夹',
  'D:\Ksoftware',
  'D:\pkg文件转换',
  'D:\网盘'
)

$results = New-Object System.Collections.ArrayList
foreach ($d in $dirs) {
  if (Test-Path -LiteralPath $d) {
    Write-Host "Scanning $d ..."
    Get-ChildItem -LiteralPath $d -Recurse -File -Force -ErrorAction SilentlyContinue |
      Where-Object { $_.LastAccessTime -lt $cut -and $_.Length -gt 5MB } |
      ForEach-Object {
        [void]$results.Add([PSCustomObject]@{
          SizeMB     = [math]::Round($_.Length / 1MB, 1)
          LastAccess = $_.LastAccessTime.ToString('yyyy-MM-dd')
          Path       = $_.FullName
        })
      }
  }
}

$csv = Join-Path $outDir 'old-files.csv'
$results | Sort-Object SizeMB -Descending | Export-Csv -Path $csv -NoTypeInformation -Encoding UTF8
Write-Host "MATCHED=$($results.Count)"
Write-Host "TOTAL_MB=$([math]::Round(($results | Measure-Object SizeMB -Sum).Sum,1))"
Write-Host "CSV=$csv"
