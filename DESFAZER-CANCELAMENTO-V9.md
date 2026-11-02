# LajuStore V9 — Desfazer cancelamento de venda

A LajuStore passa a permitir que a **administradora** restaure uma venda
que foi cancelada por engano, com verificações de estoque, financeiro e
histórico, sem apagar transações anteriores.

## Quando usar

Use **somente quando a cliente NÃO recebeu devolução real do pagamento**.

- Exemplo permitido: a Julia clicou em "Cancelar" por engano. O sistema
  registrou automaticamente um estorno contábil, mas o dinheiro não foi
  realmente devolvido para a cliente. A reversão restaura a venda.
- Exemplo **não permitido**: houve Pix de devolução ou estorno real do
  cartão. Desfazer o cancelamento criaria uma receita contábil indevida.
  Nesse caso, concilie o reembolso e, se a cliente comprar novamente,
  registre uma NOVA venda e o novo pagamento.
- Pedidos **pendentes** cancelados antes de pagamento não são vendas
  concluídas. Esta ação não se aplica a eles.
- Contas de **crediário** só podem ser reabertas se nenhuma parcela/Pix
  tiver sido registrada.

## Como a Julia usa

1. Abra **Vendas → Histórico**.
2. Localize a venda com status **Cancelado**.
3. Clique em **Desfazer cancelamento** (somente administradora).
4. Leia os alertas, informe o motivo (8 a 240 caracteres).
5. Confirme que **nenhum dinheiro foi realmente devolvido**.
6. Clique em **Confirmar restauração**.
7. Confira o status da venda, o estoque, os registros do Financeiro e,
   no caso de crediário, a área **Em aberto**.

O botão só aparece em vendas que tiveram baixa de estoque e posterior
devolução por cancelamento; não aparece para pedidos pendentes cancelados.

## O que a API faz

POST /api/v9/vendas/:id/desfazer-cancelamento

Requer sessão gestora e corpo:

    {
      "motivo": "Venda cancelada por engano",
      "confirmar_sem_devolucao": true
    }

Transação SQL única:
- Bloqueia o pedido para impedir dupla reversão.
- Confere se era uma venda realmente concluída, cancelada, com histórico
  consistente de movimentações.
- Confere o saldo financeiro dos estornos automáticos: se estiver
  inconsistente, bloqueia e não toca em nenhum registro.
- Para venda comum, baixa do estoque a mesma quantidade vendida e cria
  uma **entrada de compensação contábil** (categoria
  `reversao_estorno`); **NÃO representa novo Pix nem cobrança**.
- Se a venda for de crediário sem pagamento, reabre a conta e as
  parcelas **sem entrada de caixa**.
- Restaura o status `pago` e registra o motivo em `loja_auditoria_v7`,
  conservando os registros anteriores de estorno.
- Se faltar estoque, recusa e desfaz integralmente qualquer alteração.
- Se repetirem a solicitação, recusa (409): a venda já foi reativada.

Não exige migração de banco: usa as tabelas e o histórico já existentes.

## Homologação obrigatória antes de publicar

Em ambiente de testes, **nunca em dados reais sem backup**:

- [ ] Criar uma blusa fictícia, 5 unidades no estoque, R$ 49,90 cada.
- [ ] Registrar venda de 2 peças (Pix fictício), estoque 5 -> 3.
- [ ] Cancelar a venda, estoque 3 -> 5; conferir estorno no Financeiro.
- [ ] Clicar em Desfazer cancelamento, informar motivo e marcar
      confirmação de não devolução real.
- [ ] A venda volta a `pago`, estoque 5 -> 3 e Financeiro contém uma
      compensação do estorno; nenhuma entrada duplicada é criada.
- [ ] Tentar desfazer mais uma vez: deve estar indisponível/recusado.
- [ ] Se faltarem 2 peças no estoque, tentar reativar uma venda de 2
      peças: deve recusar SEM alterar qualquer dado.
- [ ] Cancelar um pedido pendente (sem baixa): não deve aparecer
      o botão de restaurar venda paga.
- [ ] Cancelar crediário sem Pix e restaurar: conta volta a `Em aberto`
      sem criar recebimento.
- [ ] Funcionária não vê o botão e a API recusa acesso (403).
- [ ] Testar celular e computador, inclusive motivo e confirmação.

## Ordem de publicação e como voltar

1. Aguarde aprovação de testes backend PostgreSQL + frontend TypeScript.
2. Integre e publique o **backend primeiro** (Render).
3. Confira a rota autenticada usando o ambiente de homologação.
4. Teste Deploy Preview e publique o **frontend** (Netlify).
5. Sem novos SQL e sem reinicializar o Supabase.

Para reverter código use Revert do PR no GitHub e verifique Render/Netlify.
Reverter código NÃO desfaz vendas e lançamentos já registrados. Preserve
histórico e backups antes de qualquer ação em produção.
