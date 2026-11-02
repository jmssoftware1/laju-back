# LajuStore V8 — Crediário / Contas em aberto da Julia

## Objetivo
Atender clientes que retiram roupas e pagam depois, inclusive em dois Pix ou em
até seis parcelas. **Diferente dos pedidos pendentes V7**: o crediário entrega
as peças e baixa o estoque imediatamente, sem lançar dinheiro não recebido no caixa.

### Antes de publicar — ORDEM OBRIGATÓRIA
1. Fazer backup das tabelas LajuStore; preservar vendas e clientes existentes.
2. No **Supabase SQL Editor**, executar uma única vez:
   `sql/004_crediario_clientes_v8.sql` — este é o **único SQL novo**.
   É incremental e não contém TRUNCATE/DELETE; adiciona três tabelas.
3. Conferir a existência de `loja_crediario`,
   `loja_crediario_parcelas` e `loja_crediario_pagamentos`.
4. Revisar e integrar PR do **backend** e aguardar publicação no Render.
5. Testar API com sessão de gestora, sem compartilhar token nem senhas.
6. Testar **Deploy Preview do frontend** no celular e desktop; integrar o PR
   do frontend somente após a API V8 estar operando.
7. Se o SQL ainda não foi aplicado, **não faça merge do backend/frontend**:
   a exportação comercial passará a incluir as novas tabelas.

### Para a Julia — como vender no crediário
- Abrir **Vendas / PDV → Nova venda**, adicionar as roupas e escolher
  **Conta do cliente / Crediário** na forma de pagamento.
- **Cliente cadastrada é obrigatória**; sem cliente, o sistema bloqueia.
- Definir 1 a 6 parcelas, data do primeiro vencimento e intervalo de
  7, 15 ou 30 dias. Duas parcelas de R$ 100,29 aparecem separadas.
- Confirmar somente quando a cliente **já levou** as roupas.
  O estoque baixa agora, mas o dinheiro só entrará no caixa ao receber.
- A venda aparece em **Em aberto** (PDV) e no cadastro da própria cliente.
- Ao receber o primeiro Pix, abrir a conta, digitar o valor efetivamente
  recebido, selecionar Pix e confirmar. O saldo diminui.
- Registrar o segundo Pix quando for recebido. Se quitar tudo, o estado
  muda para **Quitada**, e os recebimentos ficam no histórico.
- Há resumo da loja com saldo total a receber, contas e clientes devedoras,
  filtro por cliente, vencimentos e identificação de atrasos.

### Proteções e limitações
- Somente conta **gestora** abre e administra crediário V8. Funcionária
  não pode acessar recebimentos/saldos de devedoras.
- O backend usa transações e bloqueio de linha para não vender mais peças do
  que o estoque permite, não receber acima do saldo e não duplicar Pix
  repetidos pela mesma operação.
- **Não existe integração automática com Pix**: a Julia deve conferir
  que o dinheiro chegou ao banco antes de registrar.
- Não há juros, multa, cobrança automática nem integração com Serasa.
- Pedidos pendentes continuam sem reserva de estoque e não representam dívida.
- Não é permitido cancelar automaticamente venda a prazo **depois** de haver
  algum pagamento; a operação exige conciliação manual antes de uma devolução.
- Venda no crediário aparece no faturamento quando a roupa é entregue, mas o
  dinheiro no caixa somente no dia do Pix: relatório de vendas ≠ caixa.
- Exportação comercial JSON e Excel passam a incluir as três novas tabelas.
  Elas ainda **não substituem backup restaurável de PostgreSQL**.

### Homologação obrigatória no ambiente real (sem receber Pix verdadeiro)
1. Cadastrar uma cliente e uma peça fictícia com saldo 4 e preço R$ 100,00.
2. Abrir venda de **2 peças** na Conta da cliente, em **2 parcelas**
   de R$ 100,00 cada.
3. Conferir estoque de **4 → 2** e ausência de entrada de R$ 200,00 no caixa.
4. Abrir **PDV → Em aberto**: conferir R$ 200,00 a receber, cliente, datas.
5. Registrar Pix **fictício** de R$ 100,00: saldo deve cair para R$ 100,00,
   financeiro registra entrada R$ 100,00.
6. Registrar segundo Pix **fictício** de R$ 100,00: saldo vai a zero, conta
   fica Quitada, histórico tem dois pagamentos distintos.
7. Verificar no cadastro da cliente o botão **Em aberto** e o histórico.
8. Testar acesso com funcionária: não deve mostrar a área de contas a receber.
9. Repetir tentativas de valor maior que o saldo: API deve recusar.
10. Testar venda comum em Pix e pedido V7 pendente: sem regressões.
11. Conferir exportação Excel (abas Crediario, Parcelas, Pagamentos)
    e JSON, e se o PDF mensal separa faturamento de caixa.
12. Somente remover dados fictícios de maneira segura após backup, sem
    apagar registros verdadeiros.

### Reversão
- Se os testes falharem, **não fazer merge**.
- A migração SQL não apaga dados; as três tabelas podem permanecer sem uso
  se o recurso for revertido.
- Reverter PRs do frontend/backend não desfaz vendas já registradas.
- Não apagar tabelas de crediário que já tenham contas ou pagamentos reais.
- Antes de qualquer reversão em produção, consulte o histórico e preserve
  os valores do caixa. Nunca executar TRUNCATE no banco real.
