# LajuStore — Entrega operacional para Julia

Esta etapa acrescenta alertas reais de estoque, resultado financeiro estimado
separado do caixa e exportação comercial. NÃO elimina testes reais nem exige
migração SQL.

## Sequência de publicação
1. Conferir testes automáticos dos dois Pull Requests.
2. Integrar backend primeiro e aguardar Render ficar Live.
3. Confirmar que /health responde e /api/operacao/estoque/alertas sem token
   retorna 401 (esperado).
4. Conferir Deploy Preview da Netlify e testar no celular e computador.
5. Integrar frontend somente após a API estar funcionando.

## Checklist antes de entregar o acesso
- [ ] Backup COMPLETO (pg_dump) salvo em local privado e criptografado.
- [ ] Restauração testada em um projeto de banco DIFERENTE da produção.
- [ ] Julia e funcionária conseguem entrar e têm apenas as permissões corretas.
- [ ] Roupa fictícia com saldo 2 e mínimo 3 aparece no dashboard.
- [ ] Venda fictícia baixa estoque e gera movimento e entrada financeira.
- [ ] Despesa fictícia altera o resultado operacional e as saídas de caixa.
- [ ] Compra de mercadoria altera caixa, mas não desconta duas vezes o custo das peças.
- [ ] Alerta quando há peças vendidas sem custo cadastrado.
- [ ] Exportação comercial funciona para gestora e é negada à funcionária.
- [ ] Pedido pendente do WhatsApp/Instagram não reserva peças.
- [ ] Teste visual aprovado em celular real e desktop.
- [ ] Dados fictícios removidos com procedimento seguro, sem apagar vendas reais.
- [ ] SESSION_SECRET, senha PostgreSQL e tokens expostos em prints antigos rotacionados.
- [ ] Responsável e frequência de backup definidos.

## Backup completo PostgreSQL no Windows
A exportação JSON do painel é SOMENTE PARA CONSULTA. Não inclui usuários nem
é um arquivo de restauração. Backup real exige pg_dump.

1. Instale PostgreSQL Client Tools, com pg_dump de versão major igual ou mais
   recente que a do servidor do Supabase.
2. Configure a variável de ambiente DATABASE_URL na sua sessão segura do
   PowerShell, sem armazenar credenciais em arquivos ou no GitHub.
3. Entre na pasta laju-back e execute scripts/backup-completo.ps1.
4. O arquivo .dump gerado contém tabelas comerciais E usuários (inclusive
   hashes de senha). Guarde-o cifrado, com acesso restrito e cópia externa.
5. O script verifica se pg_restore consegue ler o índice do arquivo;
   isso NÃO confirma que uma restauração integral funcionará.
6. Crie um projeto PostgreSQL de teste SEPARADO, vazio, e restaure nele:
   pg_restore --no-owner --no-acl --dbname=CONEXAO_DE_TESTE arquivo.dump
7. Compare dados, usuários, saldos e relatórios com a fonte. Nunca teste
   restauração no banco de produção.
8. Faça backup diário quando fechar a loja e antes de atualizações, com
   restauração de teste periódica e registro das datas.

Backups Supabase variam por plano. Não presuma que o plano gratuito possui
backups automáticos. Documentação:
https://supabase.com/docs/guides/platform/backups

## Como voltar
Não faça merge se os testes falharem. Após uma publicação problemática,
reverta os Pull Requests no GitHub e aguarde os deploys do Render e Netlify.
Reverter código NÃO restaura transações do banco.

## Limites explícitos
- Registra Pix e cartão informados, mas NÃO verifica pagamentos bancários.
- Faturamento não é lucro. Custos, impostos, taxas e despesas não informadas
  podem alterar o resultado estimado.
- Pedidos pendentes não reservam estoque.
- Exportação comercial do painel contém dados de clientes e deve ser protegida.
- Não há emissão de nota fiscal, conciliação bancária, backup automático
  programado pelo aplicativo ou restauração automática do banco.

## Primeira utilização da Julia
Começar com uma peça fictícia e uma venda fictícia de baixo volume, conferir
saldo e financeiro, depois cadastrar as peças reais e seus custos. Conferir
alertas e manter um procedimento de backup ao fim de cada dia.
