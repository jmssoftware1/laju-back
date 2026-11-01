# LajuStore V6 — publicar sem perder a versão atual

**Não integre o PR do frontend antes de preparar o banco e publicar o backend.**
A LajuStore atual continua atendendo normalmente enquanto esta branch está separada.

## 1. Backup antes da migração
Confirme que há uma cópia recuperável do banco. Em projetos Supabase Free, não presuma backups automáticos; verifique as opções do seu plano ou exporte os dados antes de alterações. Não apague nem recrie tabelas.

## 2. Atualizar o Supabase
No SQL Editor do projeto já conectado ao Render, execute apenas:

`sql/002_modulos_v6.sql`

Esse arquivo faz apenas `ALTER TABLE` e `CREATE TABLE IF NOT EXISTS`. Não execute `001_schema_limpo.sql` nem `CREATE DATABASE`, porque o banco já existe.

## 3. Publicar backend no Render
Integre o PR do repositório `laju-back` na branch main. O Render com Auto-Deploy atualizará a API. Confirme o `https://laju-back.onrender.com/health` e verifique os Logs. Nenhuma variável nova de ambiente é necessária além das já usadas para a LajuStore.

## 4. Publicar frontend na Netlify
Somente depois de a API V6 e a migração estarem operacionais, integre o PR `laju-front`. A variável `VITE_API_URL` continua apontando para `https://laju-back.onrender.com`.
Confira o build e abra a LajuStore no site existente.

## 5. Teste obrigatório em ambiente de testes
1. Entrar com a conta administradora.
2. Cadastrar uma peça tamanho M, cor preta, saldo 10.
3. Cadastrar uma variação G, saldo 5.
4. Efetuar uma venda de 2 peças M com Pix, verificar saldo 8.
5. Conferir pedido em Vendas e lançamento em Financeiro.
6. Cadastrar fornecedor e receber 3 peças G; verificar saldo 8 nessa variação.
7. Conferir histórico de movimentos e relatórios por período.
8. Cadastrar uma conta de funcionária e confirmar que Financeiro, Fornecedores, Relatórios e Configurações não aparecem para ela.
9. Testar cancelamento de venda com a conta administradora: devolução ao estoque e registro de estorno.
10. Conferir dados antigos e testar recuperação de backup.

## Escopo desta V6
- Dashboard: estoque, vendas de hoje, faturamento do dia, alerta e mais vendidos.
- Estoque: produtos sem imagens, tamanho/cor, SKU, entrada/saída/ajuste e histórico.
- PDV: carrinho com diversas roupas, descontos, Pix, dinheiro, débito, crédito, canais presencial/WhatsApp/Instagram, cancelamento e estorno.
- Clientes: cadastro, edição e histórico.
- Financeiro: entradas, saídas, lançamentos e saldos.
- Fornecedores: cadastro e entrada de compras.
- Relatórios: vendas por canal, produtos mais vendidos e margem bruta estimada.
- Configurações: funcionários, permissões e troca de senha.

## Limitações conscientes
- O sistema **não processa pagamentos**, apenas registra vendas já pagas.
- Não há NF-e, integração automática com WhatsApp/Instagram, emissão de nota, conciliação bancária nem backup automatizado pela aplicação.
- Compras são registradas como pagas no financeiro.
- O lucro é estimado com o custo de mercadorias; despesas gerais devem ser analisadas separadamente.
- É necessária validação de ponta a ponta com Supabase, Render e Netlify antes de utilização comercial.
- Troque quaisquer segredos expostos em imagens ou mensagens, incluindo `SESSION_SECRET` e senha de PostgreSQL.
