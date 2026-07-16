# Planejamento Estratégico de Eventos — v1.2 (Secure + CRM + Budget + PDF)

SaaS de planeamento de eventos com login, banco de dados MySQL, dashboard, alertas, Gantt, orçamento previsto vs real, mini CRM de fornecedores, gestão de convidados com RSVP público e relatórios em PDF com marca.

## Variáveis de ambiente (Railway → Variables)

Obrigatórias:
- `DATABASE_URL` — referência ao MySQL (ex: `${{ MySQL.MYSQL_URL }}`)
- `JWT_SECRET` — string aleatória com **mínimo 32 caracteres** (o app falha ao iniciar se for menor)

Recomendadas em produção:
- `NODE_ENV` = `production`
- `PUBLIC_URL` = URL pública do teu app (ex: `https://planejador.up.railway.app`) — necessária para os links de recuperação de senha e verificação de e-mail funcionarem
- `EMAIL_FROM` = `noreply@teudominio.com`

SMTP (para enviar e-mails de recuperação/verificação):
- `SMTP_HOST` — ex: `smtp.resend.com` ou `smtp.gmail.com`
- `SMTP_PORT` — ex: `587`
- `SMTP_SECURE` — `true` ou `false`
- `SMTP_USER` — utilizador SMTP
- `SMTP_PASS` — senha/API key SMTP

Sem SMTP configurado o app continua a funcionar, mas os e-mails são apenas logados na consola.

## Melhorias de segurança da v1.1

- ✅ Rate limiting no login (10/15min), registo (5/h), recuperação (5/h), API geral (120/min)
- ✅ Bloqueio automático da conta após 5 falhas de login (15 min)
- ✅ Senhas fortes obrigatórias (mín. 8, letras+números)
- ✅ bcrypt com 12 rounds
- ✅ JWT_SECRET validado (32+ chars obrigatório)
- ✅ Cookies com `Secure` + `SameSite=Strict` em produção
- ✅ CSRF protection (double-submit token)
- ✅ Content Security Policy + Helmet (headers de segurança)
- ✅ Verificação de e-mail com token expirável
- ✅ Recuperação de senha por e-mail
- ✅ Logs de auditoria (registo, login, falhas, alterações sensíveis)
- ✅ Limites de recursos (50 projetos/utilizador, 500 tarefas/projeto)
- ✅ Endpoint de exportação de dados (direito à portabilidade — LGPD Angola)
- ✅ Endpoint de eliminação de conta (direito ao esquecimento)
- ✅ Validação estrita de inputs com truncagem
- ✅ Endpoint `/health` para monitorização de uptime

## Novidades da v1.2

- 💰 **Orçamento previsto vs real** — categorias, itens com fornecedor vinculado, cálculo automático de diferenças, ponto de equilíbrio
- 🤝 **Fornecedores (mini CRM)** — funil (novo → contactado → cotado → contratado → pago), avaliação, contactos, notas
- 👥 **Convidados e RSVP** — lista com estados, acompanhantes, mesas + **link público** que permite a convidados confirmarem sem terem conta
- 📄 **Relatórios PDF** — versão executiva para o cliente com a marca da empresa + versão completa "backup do gestor" com todos os detalhes
- 🎨 **Identidade da empresa** — nome, cor da marca, contactos aparecem no cabeçalho dos PDFs

## Estrutura

```
package.json          # dependências
server.js             # API + segurança + auth
public/
  index.html          # UI
  styles.css          # tema
  app.js              # cliente
```
