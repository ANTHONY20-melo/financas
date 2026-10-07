# ADR 0001 — Transações: filtros, ordenação, deep-link e ações em massa

- **Data:** 2026-10-07
- **Status:** Aceito
- **Contexto:** Tela de transações com busca, paginação (50/pág) e totais
  separados já entregues. Rodada de melhorias de usabilidade pedida pelo
  usuário: ordenar por coluna, filtrar por período, compartilhar/restaurar
  filtros via URL, highlight da busca, ações em massa e undo na exclusão.
- **Hash do commit:** `8bea3c4`

## Decisões

1. **Ordenação default = data decrescente** (comportamento histórico
   preservado). Primeiro clique numa coluna nova usa ordem natural
   (texto A→Z, valor menor→maior); exceto Data, que nasce decrescente.
   Segundo clique no mesmo th inverte. Indicador visual: `aria-sort` +
   ícone Font Awesome (sort/sort-up/sort-down).
2. **Filtro de período comparado lexicograficamente** (`YYYY-MM-DD`); o
   formato canonical evita parsing de data para a comparação. Valores fora
   do formato são ignorados (não quebram a consulta).
3. **Sort defensivo**: dados incompletos/corrompidos (ex.: registro sem
   `description`) não podem derrubar o render da lista; `String(x ?? '')`
   em todos os comparadores de texto.
4. **Seleção em massa limita-se ao resultado visível.** Ids selecionados
   que saem do resultado filtrado são descartados a cada render; o
   checkbox "selecionar todos" marca só a página visível (nunca o conjunto
   inteiro do filtro) — excluir às cegas é proibido por design.
5. **Undo de exclusão** via `DB.restoreTransaction(s)` preservando `id`
   e `createdAt` (semântica de restauração, não de recriação). Toast
   "Desfazer" com 6s de janela (`.toast-action`).
6. **Deep-link de filtros via `location.hash`**: `#transacoes?q=...&ty=...&df=...&sb=...`.
   `history.replaceState` não dispara `hashchange` → sincronizar a URL
   nunca gera loop. No evento `hashchange` (voltar/avançar), hash com
   query aplica filtros; hash puro limpa. Valores impossíveis (option
   inexistente, data malformada) são ignorados — URL adulterada não
   quebra.
7. **Debounce de 250ms** na busca (mantido da rodada anterior) — render
   integral da tabela a cada tecla travava bases grandes.
8. **Mobile <640px**: tabela vira cards via `data-label` em cada `td`
   (rótulo como `::before`); thead escondido; elimina scroll horizontal.

## Consequências

- `getTransactionsByFilters` ganhou `dateFrom/dateTo/sortBy/sortDir`
  (compatível com a assinatura anterior — padrão de opções).
- Estado vazio ganhou ações (Limpar filtros / Nova transação) — a tela
  nunca mais fica sem saída quando o filtro não casa nada.
- Testes: 178 unitários (`node --test`), 71 checagens de fluxo em jsdom
  (`flow.js`+`flow2`+`flow3`+`flow4` no harness local) — tudo verde.