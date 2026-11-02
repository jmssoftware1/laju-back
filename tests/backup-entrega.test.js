import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("script de backup exporta somente esquema public da aplicação", async()=>{
 const s=await fs.readFile(new URL("../scripts/backup-completo.ps1",import.meta.url),"utf8");
 assert.match(s,/pg_dump --format=custom --schema=public --no-owner --no-acl/);
 assert.match(s,/pg_restore --list/);
 assert.match(s,/loja_usuarios/);
 assert.match(s,/loja_produtos/);
 assert.doesNotMatch(s,/pg_restore --clean/);
});

test("guia exige restaurar em banco separado e protege senhas",async()=>{
 const s=await fs.readFile(new URL("../ENTREGA-JULIA.md",import.meta.url),"utf8");
 assert.match(s,/laju_homologacao/);
 assert.match(s,/--single-transaction --exit-on-error/);
 assert.match(s,/NUNCA|nunca/);
 assert.match(s,/criptografado/);
});
