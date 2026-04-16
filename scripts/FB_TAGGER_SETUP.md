# Настройка Intercom Facebook Page Tagger

## Что делает

Webhook-сервер на TypeScript, который:
1. Слушает события `conversation.created` от Intercom
2. Определяет, с какой Facebook-страницы пришло сообщение
3. Проставляет **тег** (`fb-jggl`, `fb-atla`, `fb-arteki`) и **custom attribute** `Facebook Page` на разговор

---

## Перед запуском — 3 критических шага

### 1. Получите Intercom Access Token

1. Intercom → **Settings → Integrations → Developer Hub**
2. Откройте своё приложение (или создайте новое)
3. **Authentication** → скопируйте **Access Token**
4. Права, необходимые токену:
   - ✅ Read conversations
   - ✅ Write conversations
   - ✅ Read and write tags
   - ✅ Read contacts

> Если у вас уже есть `INTERCOM_TOKEN` в `.env.local` проекта — он подойдёт.

### 2. Узнайте Page ID каждой Facebook-страницы

#### Способ A — через Facebook
1. Откройте FB-страницу → **Информация** (About) → прокрутите вниз
2. Найдите **ID страницы** — число вроде `215473884780097`

#### Способ B — через Facebook Business Suite
**Settings → Page Info → Page ID**

#### Способ C — через отладочный эндпоинт (рекомендуется)
1. Запустите скрипт (даже без маппинга)
2. Отправьте тестовое сообщение с каждой FB-страницы в Intercom
3. Откройте в браузере: `http://localhost:5100/debug/conversation/ID_РАЗГОВОРА`
4. В JSON ищите поле `source.url` — оно содержит `https://www.facebook.com/{PAGE_ID}`
   - Это **основной способ** определения страницы (подтверждено на реальных данных)
   - Также дублируется в `first_contact_reply.url`

### 3. Впишите Page ID в маппинг

Откройте `scripts/fb-page-tagger.ts`, найдите блок `PAGE_ID_TO_TAG`:

```typescript
const PAGE_ID_TO_TAG: Record<string, string> = {
  '900992606431564': 'fb-jggl',    // JGGL (2421 разговор)
  '990413554162384': 'fb-atla',    // Atla (195 разговоров)
  '555314024322717': 'fb-arteki',  // Arteki Studio (4 разговора)
};
```

И `PAGE_NAME_TO_TAG` (запасной маппинг по имени):

```typescript
const PAGE_NAME_TO_TAG: Record<string, string> = {
  JGGL: 'fb-jggl',
  Atla: 'fb-atla',
  'Arteki Studio': 'fb-arteki',
};
```

---

## Шаг 1: Первый запуск и отладка

> ⚠️ **Критически важно при первом запуске!**

1. **Раскомментируйте строку `FULL DATA`** в скрипте (строка ~270):
   ```typescript
   // log('info', `FULL DATA: ${JSON.stringify(conv, null, 2)}`);
   ```
   →
   ```typescript
   log('info', `FULL DATA: ${JSON.stringify(conv, null, 2)}`);
   ```

2. Запустите скрипт локально:
   ```bash
   cd /opt/intercom/intercom-dashboard-v2
   npx tsx scripts/fb-page-tagger.ts
   ```

3. Отправьте тестовое сообщение с **каждой** Facebook-страницы

4. В логах появится полная структура JSON разговора — найдите, где Intercom хранит информацию о странице. Возможные места:
   - `conversation_parts[].metadata.page_id`
   - `custom_attributes.facebook_page`
   - `contacts[].social_profiles[].id`
   - `source.url` (может содержать имя страницы)

5. После отладки **закомментируйте строку обратно**

> Если в логах Page ID **нигде не обнаружится** — скрипт использует
> запасную стратегию по имени страницы в `source.body` / `source.subject` / `source.url`.
> Если и это не работает — напишите разработчику для доработки.

---

## Шаг 2: Разверните на сервере

```bash
ssh intercom-dev

cd /opt/intercom/intercom-dashboard-v2

# Тестовый запуск (проверить что работает)
npx tsx scripts/fb-page-tagger.ts
```

### Автозапуск через pm2

```bash
# Добавить в pm2
pm2 start node_modules/.bin/tsx \
  --name "fb-page-tagger" \
  -- scripts/fb-page-tagger.ts

pm2 save
```

Или добавить в `ecosystem.config.js`:

```javascript
{
  name: 'fb-page-tagger',
  script: 'node_modules/.bin/tsx',
  args: 'scripts/fb-page-tagger.ts',
  cwd: '/opt/intercom/intercom-dashboard-v2',
  env: {
    FB_TAGGER_PORT: '5100',
  },
}
```

---

## Шаг 3: Настройте nginx (HTTPS)

Добавьте в конфиг nginx:

```nginx
# В существующий server-блок dashboard-intercom.atomgroup.dev
location /webhook/intercom {
    proxy_pass http://127.0.0.1:5100;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Webhook URL будет: `https://dashboard-intercom.atomgroup.dev/webhook/intercom`

---

## Шаг 4: Настройте webhook в Intercom

1. Intercom → **Settings → Integrations → Webhooks**
   (или Developer Hub → Webhooks)
2. Добавьте новый webhook:
   - **URL**: `https://dashboard-intercom.atomgroup.dev/webhook/intercom`
   - **Topics**: выберите:
     - ✅ `conversation.created`
     - ✅ `conversation.user.created`
3. (Опционально) Задайте **Webhook Secret** и добавьте его в `.env.local`:
   ```
   WEBHOOK_SECRET=ваш_секрет
   ```
4. Сохраните

---

## Проверка работы

```bash
# Health check + статистика
curl http://localhost:5100/health

# Отладка конкретного разговора
curl http://localhost:5100/debug/conversation/123456789

# Логи (если pm2)
pm2 logs fb-page-tagger --lines 50
```

### Ожидаемый вывод health:

```json
{
  "status": "healthy",
  "uptime": 3600,
  "stats": {
    "processed": 42,
    "tagged": 38,
    "unknown": 4,
    "ignored": 120
  }
}
```

---

## Порт

По умолчанию `5100`. Изменить через переменную `FB_TAGGER_PORT`:

```bash
FB_TAGGER_PORT=5200 npx tsx scripts/fb-page-tagger.ts
```

---

## Если Page ID не определяется

Если ни один из методов не работает для вашей интеграции:

1. Проверьте отладочный вывод (`FULL DATA`) — возможно, Intercom хранит Page ID в нестандартном поле
2. Проверьте `/debug/conversation/:id` — покажет полную структуру
3. Попробуйте через [Intercom API Explorer](https://developers.intercom.com/docs/references/rest-api/api.intercom.io/Conversations/conversation/) — введите ID разговора и изучите ответ
4. Напишите разработчику — скрипт будет доработан под альтернативный подход
