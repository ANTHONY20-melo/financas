<#
.SYNOPSIS
    Financas Pessoais - Site Portatil
.DESCRIPTION
    CLI para o site de financias pessoais. Funciona 100% offline.
    Use de qualquer lugar apos instalar com: .\financas.ps1 perfil
.PARAMETER Comando
    Comando: servir (padrao), perfil, ajuda
.PARAMETER Porta
    Porta do servidor HTTP (padrao: 3333)
.EXAMPLE
    .\financas.ps1
    .\financas.ps1 servir -Porta 8080
    .\financas.ps1 perfil
#>

param(
    [Parameter(Position = 0)]
    [string]$Comando = 'servir',

    [Parameter(Position = 1)]
    [int]$Porta = 3333
)

$ScriptDir = Split-Path -Path $MyInvocation.MyCommand.Path -Parent

function Write-Banner {
    Clear-Host
    Write-Host '    ===================================' -ForegroundColor DarkGray
    Write-Host '       FINANCAS PESSOAIS v1.0' -ForegroundColor Cyan
    Write-Host '    Site portatil - use de qualquer lugar' -ForegroundColor Cyan
    Write-Host '    ===================================' -ForegroundColor DarkGray
    Write-Host ''
}

function Start-Server {
    Write-Banner
    Write-Host "  Servidor rodando em:" -ForegroundColor White
    Write-Host "  http://localhost:$Porta" -ForegroundColor Green
    Write-Host ''
    Write-Host "  Pressione Ctrl+C para parar" -ForegroundColor Yellow
    Write-Host ''

    try {
        $listener = New-Object System.Net.HttpListener
        $listener.Prefixes.Add("http://localhost:$Porta/")
        $listener.Start()

        $mimeTypes = @{
            '.html' = 'text/html; charset=utf-8'
            '.css'  = 'text/css; charset=utf-8'
            '.js'   = 'application/javascript; charset=utf-8'
            '.json' = 'application/json; charset=utf-8'
            '.png'  = 'image/png'
            '.jpg'  = 'image/jpeg'
            '.jpeg' = 'image/jpeg'
            '.gif'  = 'image/gif'
            '.svg'  = 'image/svg+xml'
            '.ico'  = 'image/x-icon'
            '.woff' = 'font/woff'
            '.woff2' = 'font/woff2'
            '.map'  = 'application/json'
        }

        while ($listener.IsListening) {
            $context = $listener.GetContext()
            $request = $context.Request
            $response = $context.Response

            $caminhoArquivo = Join-Path $ScriptDir $request.Url.AbsolutePath
            if ($caminhoArquivo.EndsWith('/') -or $caminhoArquivo -eq $ScriptDir) {
                $caminhoArquivo = Join-Path $ScriptDir 'index.html'
            }

            if (Test-Path $caminhoArquivo) {
                $extensao = [System.IO.Path]::GetExtension($caminhoArquivo)
                $contentType = if ($mimeTypes.ContainsKey($extensao)) { $mimeTypes[$extensao] } else { 'application/octet-stream' }
                $response.ContentType = $contentType

                $buffer = [System.IO.File]::ReadAllBytes($caminhoArquivo)
                $response.ContentLength64 = $buffer.Length
                $response.OutputStream.Write($buffer, 0, $buffer.Length)
            } else {
                $response.StatusCode = 404
                $buffer = [System.Text.Encoding]::UTF8.GetBytes('Arquivo nao encontrado')
                $response.ContentLength64 = $buffer.Length
                $response.OutputStream.Write($buffer, 0, $buffer.Length)
            }

            $response.OutputStream.Close()

            $metodo = $request.HttpMethod
            $url = $request.Url.AbsolutePath
            $status = $response.StatusCode
            Write-Host "  [$status] $metodo $url" -ForegroundColor $(if ($status -eq 200) { 'Green' } else { 'Red' })
        }
    } catch {
        if ($_.Exception.Message -match 'acesso negado') {
            Write-Host "  ERRO: Execute o PowerShell como Administrador." -ForegroundColor Red
        } elseif ($_.Exception.Message -match 'ja esta sendo usado') {
            Write-Host "  ERRO: A porta $Porta ja esta em uso." -ForegroundColor Red
            Write-Host "  Use: .\financas.ps1 servir -Porta <outra_porta>" -ForegroundColor Yellow
        } else {
            Write-Host "  ERRO: $_" -ForegroundColor Red
        }
    } finally {
        if ($listener -and $listener.IsListening) {
            $listener.Stop()
        }
    }
}

function Install-Global {
    $profilePath = $PROFILE.CurrentUserAllHosts
    $profileDir = Split-Path $profilePath -Parent

    if (-not (Test-Path $profileDir -PathType Container)) {
        New-Item -ItemType Directory -Path $profileDir -Force -ErrorAction Stop | Out-Null
    }

    $scriptPath = Join-Path $ScriptDir "financas.ps1"

    if (Test-Path $profilePath -PathType Leaf) {
        $currentContent = Get-Content $profilePath -Raw -ErrorAction SilentlyContinue
        if ($currentContent -match "function financas") {
            Write-Host '  [!] Comando financas ja instalado!' -ForegroundColor Yellow
            Write-Host ''
            Write-Host '  Use agora: financas' -ForegroundColor Green
            return
        }
    }

    Add-Content -Path $profilePath -Value "`n# Financas Pessoais - Site Portatil" -ErrorAction Stop
    Add-Content -Path $profilePath -Value "function financas { & '$scriptPath' @args }" -ErrorAction Stop

    Write-Host '  [v] Comando financas instalado no PowerShell!' -ForegroundColor Green
    Write-Host ''
    Write-Host '  Reinicie o PowerShell ou execute:' -ForegroundColor Yellow
    Write-Host '    . $PROFILE.CurrentUserAllHosts' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '  Agora use de qualquer lugar:' -ForegroundColor White
    Write-Host '    financas' -ForegroundColor Gray
    Write-Host '    financas servir -Porta 8080' -ForegroundColor Gray
}

switch ($Comando.ToLower()) {
    'perfil' { Install-Global }
    'ajuda' {
        Write-Banner
        Write-Host '  USO:' -ForegroundColor Yellow
        Write-Host '    .\financas.ps1 [comando] [-Porta N]' -ForegroundColor White
        Write-Host ''
        Write-Host '  COMANDOS:' -ForegroundColor Yellow
        Write-Host '    servir (padrao)  Inicia servidor HTTP' -ForegroundColor White
        Write-Host '    perfil           Instala comando global' -ForegroundColor White
        Write-Host '    ajuda            Mostra esta ajuda' -ForegroundColor White
        Write-Host ''
        Write-Host '  EXEMPLOS:' -ForegroundColor Yellow
        Write-Host '    .\financas.ps1' -ForegroundColor Gray
        Write-Host '    .\financas.ps1 perfil' -ForegroundColor Gray
        Write-Host '    financas' -ForegroundColor Gray
        Write-Host '    financas -Porta 8080' -ForegroundColor Gray
    }
    default { Start-Server }
}
