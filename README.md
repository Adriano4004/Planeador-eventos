# Eveni — Gestão de Eventos

Aplicação web para gestão de eventos (conferências, casamentos, congressos, festivais) com templates de tarefas baseados em offsets D-n em relação à data do evento.

## Funcionalidades

- **Autenticação** com registo/login, JWT em cookie httpOnly, bcrypt (12 rounds)
- **3 planos** de subscrição: Singular, Empresarial, Grandes Empresas
- **4 templates** de projecto (T01 Conferência de Imprensa, T02 Casamento, T03 Congresso, T04 Festival)
- **Tarefas** com fases, categorias, datas calculadas automaticamente a partir da data do evento
- **Fornecedores** com estados, orçamento, valores contratados/pagos
- **Convidados + RSVP público** através de link único por convidado
- **Exportação PDF** do relatório do projecto
- **UI Neutra moderna** com suporte automático dark/light via `prefers-color-scheme`
- **Localização pt-PT**

## Requisitos

- Node.js 18+
- MySQL 5.7+ ou compatível (Railway MySQL funciona)

## Instalação local

```bash
npm install
cp .env.example .env
# editar .env com DATABASE_URL e JWT_SECRET
npm start
```

Abrir http://localhost:3000

## Deploy em Railway

1. Fazer push do repositório para o GitHub
2. Em Railway: **New Project → Deploy from GitHub → seleccionar repo**
3. Adicionar **MySQL** como serviço no mesmo projecto
4. Nas variáveis do serviço da app:
   - `DATABASE_URL` → referenciar `${{ MySQL.MYSQL_URL }}`
   - `JWT_SECRET` → gerar 32+ caracteres aleatórios
   - `NODE_ENV` → `production`
5. Railway detecta `npm start` automaticamente

O `PORT` é definido pelo Railway.

## Estrutura

```
eveni/
├── server.js                # Express + rotas API
├── package.json
├── data/
│   ├── templates.json       # 4 templates extraídos do Excel (284 tarefas)
│   └── templates-meta.json  # Metadados dos templates
├── public/
│   ├── index.html           # SPA principal
│   ├── app.js               # Frontend (vanilla JS)
│   ├── styles.css           # CSS neutro moderno
│   ├── rsvp.html            # Página pública de RSVP
│   ├── rsvp.js
│   └── eveni-logo.png
└── scripts/
    └── extract-templates.py # Regenera templates.json a partir do Excel
```

## Modelo de dados

- **users** — utilizadores com `plan_code` (singular/empresarial/grandes)
- **projects** — projectos ligados a um `template_code`
- **tasks** — tarefas com `offset_start`/`offset_end` (D-n) e `start_date`/`end_date` resolvidas
- **vendors** — fornecedores com valores e estado
- **guests** — convidados com `rsvp_token` único para link público

## Planos

| Plano | Templates | Projectos | Utilizadores |
|-------|-----------|-----------|--------------|
| Singular / Wedding Planner | T02 (Casamento) | 2 | 1 |
| Empresarial | T01, T03, T04 | Ilimitado | 10 |
| Grandes Empresas | Todos | Ilimitado | Ilimitado |

## Pagamentos

Os planos são atribuídos manualmente/gratuitamente nesta versão. Integração de pagamento (Stripe/RevenueCat/Cashfree) fica para próxima iteração — os endpoints `POST /api/account/plan` e o campo `plan_expires_at` já estão preparados.

## API

- `POST /api/auth/register` `{ name, email, password, plan_code? }`
- `POST /api/auth/login` `{ email, password }`
- `GET  /api/auth/me`
- `GET  /api/plans` (público)
- `POST /api/account/plan` `{ plan_code }`
- `GET  /api/templates`
- `GET  /api/projects` · `POST /api/projects` · `GET|PUT|DELETE /api/projects/:id`
- `POST /api/projects/:pid/tasks` · `PUT|DELETE /api/tasks/:id`
- `GET|POST /api/projects/:pid/vendors` · `PUT|DELETE /api/vendors/:id`
- `GET|POST /api/projects/:pid/guests` · `PUT|DELETE /api/guests/:id`
- `GET  /api/rsvp/:token` · `POST /api/rsvp/:token` (públicos)
- `GET  /api/projects/:id/pdf`
- `GET  /api/health`

## Regenerar templates

Se o `Eveni-Templates-Projecto_v2.xlsx` for actualizado:

```bash
pip install openpyxl
python3 scripts/extract-templates.py
```
