param(
  [int]$Port = 8765,
  [string]$StartPage = "index.html"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$StartPage = $StartPage.TrimStart("/")
$Url = "http://localhost:$Port/$StartPage"

function Find-Python {
  $candidates = @(
    "$env:LOCALAPPDATA\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe",
    "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) {
      return $candidate
    }
  }

  foreach ($command in @("py.exe", "python.exe", "python3.exe")) {
    $found = Get-Command $command -ErrorAction SilentlyContinue
    if ($found) {
      return $found.Source
    }
  }

  return $null
}

function Get-ContentType($Path) {
  switch -Regex ([IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    "\.html?$" { "text/html; charset=utf-8"; break }
    "\.js$" { "text/javascript; charset=utf-8"; break }
    "\.css$" { "text/css; charset=utf-8"; break }
    "\.json$" { "application/json; charset=utf-8"; break }
    "\.csv$" { "text/csv; charset=utf-8"; break }
    "\.png$" { "image/png"; break }
    "\.jpe?g$" { "image/jpeg"; break }
    default { "application/octet-stream" }
  }
}

function Update-ProfileManifest {
  $folders = @(
    @{ Path = Join-Path $Root "profiles"; Source = "built-in" },
    @{ Path = Join-Path $Root "user-profiles"; Source = "user" }
  )
  $profiles = @()

  foreach ($folder in $folders) {
    if (-not (Test-Path $folder.Path -PathType Container)) {
      New-Item -ItemType Directory -Force $folder.Path | Out-Null
    }

    foreach ($file in Get-ChildItem -Path $folder.Path -Filter "*.json" -File | Sort-Object Name) {
      $name = [IO.Path]::GetFileNameWithoutExtension($file.Name)
      try {
        $json = Get-Content -Raw -Path $file.FullName | ConvertFrom-Json
        if ($json.name) {
          $name = [string]$json.name
        }
      } catch { }

      $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd("\") + "\"
      $filePath = [IO.Path]::GetFullPath($file.FullName)
      $relative = $filePath.Substring($rootPath.Length).Replace("\", "/")
      $profiles += [pscustomobject]@{
        name = $name
        path = $relative
        source = $folder.Source
      }
    }
  }

  $profiles | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $Root "profile-manifest.json") -Encoding UTF8
}

function Start-PowerShellServer {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
  $listener.Start()
  Write-Host ""
  Write-Host "Modbus Service Viewer is running at $Url"
  Write-Host "Close this window to stop the viewer."
  Write-Host ""
  Start-Process $Url

  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()
      if (-not $requestLine) {
        continue
      }

      while (($line = $reader.ReadLine()) -ne $null -and $line -ne "") { }

      $parts = $requestLine.Split(" ")
      $rawPath = if ($parts.Count -gt 1) { $parts[1] } else { "/" }
      $rawPath = $rawPath.Split("?")[0]
      $relative = [Uri]::UnescapeDataString($rawPath).TrimStart("/")
      if ([string]::IsNullOrWhiteSpace($relative)) {
        $relative = "index.html"
      }

      $fullPath = [IO.Path]::GetFullPath((Join-Path $Root $relative))
      $rootPath = [IO.Path]::GetFullPath($Root)
      if (-not $fullPath.StartsWith($rootPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Bad path"
      }

      if (Test-Path $fullPath -PathType Leaf) {
        $body = [IO.File]::ReadAllBytes($fullPath)
        $status = "200 OK"
        $type = Get-ContentType $fullPath
      } else {
        $body = [Text.Encoding]::UTF8.GetBytes("Not found")
        $status = "404 Not Found"
        $type = "text/plain; charset=utf-8"
      }

      $headers = @(
        "HTTP/1.1 $status",
        "Content-Type: $type",
        "Content-Length: $($body.Length)",
        "Cache-Control: no-store",
        "Connection: close",
        "",
        ""
      ) -join "`r`n"

      $headerBytes = [Text.Encoding]::ASCII.GetBytes($headers)
      $stream.Write($headerBytes, 0, $headerBytes.Length)
      $stream.Write($body, 0, $body.Length)
    } catch {
      try {
        $message = [Text.Encoding]::UTF8.GetBytes("Server error")
        $headers = "HTTP/1.1 500 Server Error`r`nContent-Length: $($message.Length)`r`nConnection: close`r`n`r`n"
        $headerBytes = [Text.Encoding]::ASCII.GetBytes($headers)
        $stream.Write($headerBytes, 0, $headerBytes.Length)
        $stream.Write($message, 0, $message.Length)
      } catch { }
    } finally {
      $client.Close()
    }
  }
}

Write-Host "Starting Modbus Service Viewer..."
Write-Host "Folder: $Root"
Update-ProfileManifest

$python = Find-Python
if ($python) {
  Write-Host "Using Python web server: $python"
  Start-Process $Url
  Set-Location $Root
  & $python -m http.server $Port --bind 127.0.0.1
} else {
  Write-Host "Python was not found, using built-in PowerShell web server."
  Start-PowerShellServer
}
