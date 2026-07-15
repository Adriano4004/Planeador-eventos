# Planejamento Estratégico de Eventos

Aplicação web completa para planejamento de eventos: multi-usuário com login, banco de dados MySQL, dashboard com KPIs, cronograma (Gantt), tarefas e alertas.

## Recursos

- Autenticação com e-mail/senha (bcrypt + JWT em cookie httpOnly)
- Múltiplos projetos por usuário, template padrão com 77 tarefas
- Dashboard com progresso por fase, gráficos (Chart.js), financeiro
- Tarefas com filtros, categorias, responsáveis, datas
- Cronograma Gantt semanal
- Alertas: atrasadas, próximos 7 dias, sem data, sem responsável

## Stack

- Node.js + Express
- MySQL / TiDB (via `mysql2/promise`)
- Frontend puro (HTML, CSS, JS + Chart.js CDN)

## Rodando localmente

```bash
npm install
export DATABASE_URL="mysql://user:pass@host:3306/dbname"
export JWT_SECRET="uma-string-longa-e-aleatoria"
node server.js
```

Abre em http://localhost:3000

O banco é migrado automaticamente na primeira execução (cria as tabelas `users`, `projects` e `tasks`).

## Publicar

Compatível com qualquer host que suporte Node.js + MySQL:
- Railway
- Render
- Fly.io
- VPS (Ubuntu + Node + MySQL/MariaDB)

Basta expor a variável `DATABASE_URL` e o app conecta.

## Estrutura

```
package.json          # deps: express, mysql2, bcryptjs, jsonwebtoken, cookie-parser
server.js             # API + migração + auth
public/
  index.html          # UI
  styles.css          # tema escuro
  app.js              # lógica cliente
```
