# LajuStore — backup completo, executado LOCALMENTE em Windows PowerShell.
# Requer pg_dump da mesma versão major ou mais nova que o PostgreSQL do Supabase.
# Não informa a senha em saída de texto nem armazena credenciais no repositório.
param([string]$PastaDestino = ".\backups-lajustore")
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
  throw "Configure DATABASE_URL temporariamente no seu terminal (NUNCA no GitHub)."
}
if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) {
  throw "pg_dump não encontrado. Instale PostgreSQL Client Tools e adicione ao PATH."
}
if (-not (Get-Command pg_restore -ErrorAction SilentlyContinue)) {
  throw "pg_restore não encontrado. Instale PostgreSQL Client Tools e adicione ao PATH."
}

New-Item -ItemType Directory -Path $PastaDestino -Force | Out-Null
$destinoAbsoluto=(Resolve-Path $PastaDestino).Path
$arquivo=Join-Path $destinoAbsoluto ("lajustore-completo-{0}.dump" -f (Get-Date -Format "yyyy-MM-dd-HHmmss"))

# Libpq aceita connection string pela variável PGDATABASE; o segredo não
# precisa aparecer como argumento de linha de comando para o pg_dump.
$PGDATABASE_ANTERIOR=$env:PGDATABASE
$PGSSLMODE_ANTERIOR=$env:PGSSLMODE
try {
  $env:PGDATABASE=$env:DATABASE_URL
  $env:PGSSLMODE="require"
  & pg_dump --format=custom --no-owner --no-acl --file $arquivo
  if ($LASTEXITCODE -ne 0) { throw "pg_dump retornou código $LASTEXITCODE." }

  & pg_restore --list $arquivo | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Arquivo gerado não pôde ser listado por pg_restore." }

  Write-Host "Backup criado e estrutura verificada: $arquivo"
  Write-Host "Guarde este arquivo criptografado e teste uma restauração em banco SEPARADO."
}
catch {
  if (Test-Path $arquivo) { Remove-Item -LiteralPath $arquivo -Force }
  throw
}
finally {
  $env:PGDATABASE=$PGDATABASE_ANTERIOR
  $env:PGSSLMODE=$PGSSLMODE_ANTERIOR
}
