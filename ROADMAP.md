# Eveni — Roadmap

Documento de trabalho. Registo do que está feito e do que vem a seguir.

## v1.0 — Base (concluído)

- Autenticação (registo, login, JWT em cookie httpOnly, bcrypt 12 rounds)
- 3 planos: Singular, Empresarial, Grandes Empresas
- 4 templates de projecto (T01 Conferência, T02 Casamento, T03 Congresso, T04 Festival) com 284 tarefas
- Offsets D-n resolvidos automaticamente para a data do evento
- Fornecedores, convidados, RSVP público
- Exportação PDF do projecto
- UI neutra moderna com dark/light automático
- Localização pt-PT

## v1.1 — Segurança e endurecimento (concluído)

- Rate limiting em `/api/auth/*` (10 tentativas / 15 min por IP) e em `/api/*` global (120 req/min)
- Fail-fast se `JWT_SECRET` < 32 caracteres
- Palavra-passe mínima de 10 caracteres com letras + números
- Bloqueio de 100 palavras-passe comuns
- Bloqueio de brute-force por e-mail (10 falhas/1h → conta bloqueada 1h)
- Timing-safe login (dummy bcrypt quando e-mail não existe, para não revelar existência)
- Cabeçalhos de segurança reforçados: HSTS, CSP com form-action/base-uri/object-src, COOP, CORP, Permissions-Policy
- Trust proxy configurado para Railway (IP real no rate limit)
- Handler global de erros — nunca expõe stack traces / detalhes de BD
- T02 (Casamento) disponível em todos os planos

## v1.2 — Próximo (a implementar)

### Autenticação avançada
- [ ] Confirmação de e-mail no registo (SendGrid/Resend/Postmark — decisão de fornecedor)
- [ ] Recuperação de palavra-passe por e-mail
- [ ] 2FA TOTP (app autenticadora tipo Authy/Google Authenticator)
- [ ] Sessões auditadas (tabela `sessions` com IP, user-agent, last_seen)

### Melhorias UI
- [ ] Logo definitivo e paleta refinada
- [ ] Mobile — navegação inferior em vez de sidebar, tarefas como cartões
- [ ] Landing page pública (autónoma, fora do app)

### Colaboração
- [ ] Tabela `project_members(project_id, user_id, role)` com owner/editor/viewer
- [ ] Autorização por projecto (middleware `requireMember`)
- [ ] Convite de colaboradores por e-mail
- [ ] Disponível apenas nos planos Empresarial (10 users) e Grandes (ilimitado)

### Regras de negócio — limite anual cumulativo
- [ ] Contagem de projectos é **cumulativa desde `plan_started_at`**, não simultânea
- [ ] Botão "Eliminar projecto" substituído por "Arquivar"
- [ ] Projectos arquivados continuam a contar para o limite anual
- [ ] Contador reseta apenas na renovação do plano
- [ ] "Eventos extra" avulsos — decisão de produto pendente:
  - Precisa pagamento efectivo (Stripe / Cashfree / EMIS)
  - Colunas novas em `users`: `extra_events_purchased`, `extra_events_used`
  - Preço por evento extra a definir

### Notificações WhatsApp
- [ ] Fornecedor: Twilio WhatsApp API ou Meta Cloud API (decisão pendente)
- [ ] Cron diário: verifica tarefas críticas em atraso e envia alertas ao responsável
- [ ] Campo `phone` em `users` (novo) e opção opt-in

### Relatórios
- [ ] Layouts adicionais no PDF (Gantt, timeline, resumo executivo)
- [ ] White-label: logo + cor + rodapé do cliente da agência, por projecto
- [ ] Modelos: "Relatório para cliente", "Relatório interno", "Cronograma completo"
- [ ] Exportar planner (cronograma completo) em PDF

### Orçamento (módulo dedicado)
- [ ] Tabela `budget_items(project_id, category, description, planned, actual, vendor_id?)`
- [ ] Reconciliação: `planned_total`, `contracted_total`, `paid_total`, `variance`
- [ ] Widget de saúde financeira no painel
- [ ] Alertas de estouro de orçamento

### Convidados
- [ ] Campo `seat_area` (mesa/camarote/banca) em `guests`
- [ ] Campo `seat_number` opcional
- [ ] Vista simplificada de mapa de lugares (grelha editável)

## v2.0 — Escala

- [ ] Domínio próprio + HTTPS custom
- [ ] Ambiente de staging separado
- [ ] Testes automatizados (Jest / Playwright)
- [ ] Métricas + observabilidade (Sentry para erros, uptime monitoring)
- [ ] Integração de pagamento efectiva (Stripe / Cashfree / EMIS)
- [ ] i18n — suporte a EN além de pt-PT

## Regras de compatibilidade de dados

Todas as futuras alterações de esquema seguem estas regras:
1. **Nunca `DROP TABLE`** em produção
2. **Sempre `ADD COLUMN IF NOT EXISTS`** com valor default seguro
3. **Sempre `CREATE TABLE IF NOT EXISTS`** para novas tabelas
4. Backup automático diário do MySQL (Railway)
5. Ambiente de staging para testar migrações críticas antes de produção

## Notas operacionais

- Deploy: push para `main` no GitHub → Railway redeploya automaticamente
- Migrações: função `migrate()` no `server.js` corre a cada arranque, idempotente
- Rate limits ajustáveis nas constantes no topo do `server.js`
- Logs no Railway (`View logs` no deployment)
