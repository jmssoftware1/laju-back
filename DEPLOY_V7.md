# LajuStore V7 — implantação segura (Render + Netlify + Supabase)

Esta atualização corrige a integração entre o frontend V7 que já usa `/api/v7`
e o backend, preservando o funcionamento da V6.

## Alterações
- Pedido aguardando pagamento: cria pedido sem reservar ou diminuir estoque.
- Conclusão: verifica estoque disponível, registra venda/receita e baixa peças
  numa única transação; repetição da mesma confirmação não baixa duas vezes.
- Cancelamento de pendente: apenas administradora; não altera estoque.
- Edição de tamanho, cor, SKU e mínimo: apenas administradora; sem alterar saldo;
  histórico de alteração no banco.
- Listagem de pendentes retorna o estoque disponível para sinalizar falta no PDV.
- Compatibilidade: rota antiga de conclusão recusa pedidos pendentes V7.
- Validação automática com PostgreSQL temporário no GitHub Actions.

## Passo 1 — backup
Garanta backup recuperável da base Supabase. Confira as opções reais do seu
plano; não presuma que exista backup automático. Para publicar, não envie
senhas nem connection strings ao GitHub.

## Passo 2 — migração Supabase
No SQL Editor do projeto já existente, execute *somente*
`sql/003_pedidos_pendentes_v7.sql`.
Não execute `sql/001_schema_limpo.sql` novamente.
O SQL não apaga tabelas nem registros e adiciona `origem_fluxo` e auditoria.

## Passo 3 — backend (Render)
Confira os testes do PR `laju-back`, integre-o em `main` e aguarde o
deploy automático do Render. Confira:
`https://laju-back.onrender.com/health`
Teste também o menu PDV no site, que chama `/api/v7/pendentes`.
A rota exige token válido; retornar 401 sem autenticação é esperado.

## Passo 4 — frontend (Netlify)
Depois de confirmar a API, integre o PR do `laju-front`.
A Netlify usa `VITE_API_URL=https://laju-back.onrender.com`.

## Passo 5 — homologação
1. Criar pedido WhatsApp de 2 peças (Pix ainda NÃO recebido).
2. Confirmar que ele aparece em "aguardando pagamento" e NÃO reduz o saldo.
3. Confirmar pagamento Pix; estoque deve cair em 2 e receita aparecer no financeiro.
4. Repetir solicitação de confirmação: não deve lançar novamente.
5. Criar outro pedido pendente, vender as mesmas peças no caixa até faltar estoque.
6. Ver alerta de falta; servidor deve recusar conclusão, sem baixa parcial.
7. Cancelar pedido pendente pela administradora; estoque fica igual.
8. Editar SKU, tamanho ou cor da variação: saldo não pode mudar.
9. Confirmar que funcionária não pode editar variação ou cancelar pendente.
10. Conferir dados e pedidos da V6, relatórios e histórico.

## Limitações
- Não reserva produtos; se vender no caixa antes de receber o pagamento,
  a conclusão do pedido pendente pode ser bloqueada.
- A aplicação apenas registra o pagamento recebido, sem integração financeira.
- Ainda faltam testes manuais no Render/Supabase e política de backups.
- Nenhuma mudança no plano de hospedagem é necessária.
