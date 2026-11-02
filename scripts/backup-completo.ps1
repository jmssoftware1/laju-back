# LajuStore — backup completo das tabelas da aplicação (schema public).
# Não inclui schemas gerenciados pelo Supabase (auth, storage, etc.).
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
$arquivo=Join-Path $destinoAbsoluto ("lajustore-public-{0}.dump" -f (Get-Date -Format "yyyy-MM-dd-HHmmss"))

# Libpq aceita connection string pela variável PGDATABASE; o segredo não
# precisa aparecer como argumento de linha de comando para o pg_dump.
$PGDATABASE_ANTERIOR=$env:PGDATABASE
$PGSSLMODE_ANTERIOR=$env:PGSSLMODE
try {
  $env:PGDATABASE=$env:DATABASE_URL
  $env:PGSSLMODE="require"
  & pg_dump --format=custom --schema=public --no-owner --no-acl --file $arquivo
  if ($LASTEXITCODE -ne 0) { throw "pg_dump retornou código $LASTEXITCODE." }

  $indice = & pg_restore --list $arquivo
  if ($LASTEXITCODE -ne 0) { throw "Arquivo gerado não pôde ser listado por pg_restore." }
  $indiceTexto = $indice -join "`n"
  if ($indiceTexto -notmatch "loja_usuarios" -or $indiceTexto -notmatch "loja_produtos") {
    throw "A cópia não contém todas as tabelas essenciais da LajuStore."
  }

  Write-Host "Cópia das tabelas public criada: $arquivo"
  Write-Host "Inclui usuários e hashes de senha da LajuStore; guarde criptografado."
  Write-Host "Obrigatório testar uma RESTAURAÇÃO em banco PostgreSQL SEPARADO."
  Write-Host "Isso não inclui schemas internos do Supabase nem arquivos do Storage."
}
catch {
  if (Test-Path $arquivo) { Remove-Item -LiteralPath $arquivo -Force }
  throw
}
finally {
  $env:PGDATABASE=$PGDATABASE_ANTERIOR
  $env:PGSSLMODE=$PGSSLMODE_ANTERIOR
}
