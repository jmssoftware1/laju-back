# LajuStore V7 — pedidos pendentes, estoque e CSV

## O que muda
- Pedidos criados pelo WhatsApp, Instagram ou loja física podem ficar aguardando pagamento.
- Enquanto o pedido está pendente **não há baixa nem reserva de estoque**.
- Ao confirmar o pagamento, a API desconta as quantidades dentro de uma transação no PostgreSQL, registra histórico e gera entrada financeira.
- Se o estoque ficar insuficiente, a confirmação falha sem gerar venda nem baixar quantidades.
- Uma segunda tentativa de concluir o mesmo pedido devolve conflito HTTP 409.
- A administradora pode cancelar um pedido pendente sem alterar o estoque.
- A administradora pode alterar SKU, tamanho, cor e estoque mínimo; quantidades continuam controladas por movimentações.
- Filtro por categoria e estoque baixo + exportação CSV no frontend.
- Exportação CSV dos relatórios por período.

## Banco de dados
A V7 usa exclusivamente tabelas e colunas criadas nas versões 001 e 002. **Não existe migração V7**.
Não execute novamente o SQL 001 e não apague tabelas. A versão V6 que você já usa continua intacta.

## Publicação na hospedagem atual
1. Faça backup recuperável do banco atual no Supabase. Confirme os limites do plano.
2. Revise e integre o PR do **backend** primeiro; verifique GitHub Actions e deploy no Render.
3. Quando o Render estiver Live, integre o PR do **frontend**; confira o build e deploy na Netlify.
4. A `VITE_API_URL` permanece apontando para `https://laju-back.onrender.com`. Não é preciso alterar variáveis.
5. Verifique `/health` e entre na LajuStore. **Não compartilhe senhas ou tokens**.

## Testes recomendados
1. Cadastrar pedido de Instagram com 2 peças e pagamento ainda não recebido.
2. Conferir que o estoque permaneceu igual e não houve receita registrada.
3. Confirmar pedido após receber Pix; conferir baixa de 2 peças, pedido pago e lançamento de entrada.
4. Repetir a confirmação: o backend deve bloquear e não lançar duas vezes.
5. Cadastrar outro pedido, efetuar uma venda que esgote o estoque, tentar concluir o pendente; deve informar estoque insuficiente.
6. Cancelar um pendente com a administradora; o saldo não deve mudar.
7. Editar SKU/cor/tamanho/mínimo e confirmar que a quantidade não muda.
8. Filtrar por categoria/estoque baixo e exportar estoque e relatórios CSV.

## Limitações e cuidados
- Pendentes são **pedidos ainda não pagos, não reservas**. Outras vendas podem consumir as peças antes da conclusão.
- Os pedidos não recebem pagamento automaticamente; uma pessoa deve confirmar o recebimento.
- Não há notificações automáticas via WhatsApp, Instagram nem integração com gateways de pagamento.
- Relatórios de vendas contabilizam a data da conclusão (quando houver), mas ajustes de fuso horário e fechamento financeiro ainda precisam de auditoria.
- CSV pode incluir nome de produto e informações comerciais. Guarde os arquivos com cuidado.
- Teste automatizado V7 usa PostgreSQL temporário via GitHub Actions, sem acessar Supabase.
- Segurança de produção ainda precisa de revisão abrangente (rate limiting, backup/restauração e demais operações).
