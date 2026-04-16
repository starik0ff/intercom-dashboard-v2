// OpenAPI 3.1 spec for the dashboard API. Hand-maintained.
// Served at /api/openapi.json and rendered by Swagger UI at /api.

export const openapiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Intercom Dashboard API',
    version: '2.0.0',
    description:
      'Внутренний API дашборда Intercom: трафик, команда, синхронизация. Все эндпоинты (кроме /api/auth/login, /api/openapi.json) требуют cookie-сессию `session`.',
  },
  servers: [
    { url: '/', description: 'Текущий хост' },
  ],
  tags: [
    { name: 'auth', description: 'Аутентификация' },
    { name: 'traffic', description: 'Раздел Трафик — агрегаты по диалогам' },
    { name: 'team', description: 'Раздел Команда — метрики менеджеров' },
    { name: 'search', description: 'Полнотекстовый поиск (FTS5) и детали диалогов' },
    { name: 'deals', description: 'Closed Deal: список сделок + ручные переопределения статуса' },
    { name: 'export', description: 'Выгрузки в CSV/JSON' },
    { name: 'sync', description: 'Состояние фоновых синхронизаций' },
    { name: 'health', description: 'Health checks и liveness probes' },
  ],
  components: {
    securitySchemes: {
      sessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: 'session',
        description: 'HMAC-подписанная сессия, выдаётся /api/auth/login',
      },
    },
    parameters: {
      Period: {
        name: 'period',
        in: 'query',
        schema: {
          type: 'string',
          enum: ['today', 'yesterday', '7d', '30d', 'this_month', 'last_month', 'all', 'custom'],
        },
        description: 'Пресет периода. Для `custom` нужны from/to.',
      },
      From: {
        name: 'from',
        in: 'query',
        schema: { type: 'string', format: 'date' },
        description: 'YYYY-MM-DD (Europe/Moscow). Используется при period=custom.',
      },
      To: {
        name: 'to',
        in: 'query',
        schema: { type: 'string', format: 'date' },
        description: 'YYYY-MM-DD (Europe/Moscow). Используется при period=custom.',
      },
      Sources: {
        name: 'sources',
        in: 'query',
        schema: { type: 'string' },
        description:
          'Список источников через запятую: telegram_boostyfi, telegram_iamlimitless, facebook, website, email, other, unknown',
      },
      Statuses: {
        name: 'statuses',
        in: 'query',
        schema: { type: 'string' },
        description:
          'Список статусов через запятую: new, in_progress, negotiation, tech_q, no_reply, closed_deal, closed, unknown',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: { error: { type: 'string' } },
      },
      SourceBucket: {
        type: 'string',
        enum: ['telegram_boostyfi', 'telegram_iamlimitless', 'facebook', 'website', 'email', 'other', 'unknown'],
      },
      StatusBucket: {
        type: 'string',
        enum: ['new', 'in_progress', 'negotiation', 'tech_q', 'no_reply', 'closed_deal', 'closed', 'unknown'],
      },
      LoginRequest: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string' },
          password: { type: 'string', format: 'password' },
        },
      },
      LoginResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          user: {
            type: 'object',
            properties: {
              username: { type: 'string' },
              role: { type: 'string', enum: ['admin', 'auditor'] },
              displayName: { type: 'string' },
            },
          },
        },
      },
      BySourceResponse: {
        type: 'object',
        properties: {
          total: { type: 'integer' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                source_bucket: { $ref: '#/components/schemas/SourceBucket' },
                n: { type: 'integer' },
              },
            },
          },
        },
      },
      DailyResponse: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                day: { type: 'string', format: 'date' },
                total: { type: 'integer' },
              },
              additionalProperties: { type: 'integer' },
            },
          },
        },
      },
      FunnelResponse: {
        type: 'object',
        properties: {
          stages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                label: { type: 'string' },
                value: { type: 'integer' },
              },
            },
          },
          no_reply: { type: 'integer' },
        },
      },
      TopPagesResponse: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                url: { type: 'string' },
                n: { type: 'integer' },
              },
            },
          },
        },
      },
      TeamListItem: {
        type: 'object',
        properties: {
          admin_id: { type: 'string' },
          name: { type: 'string', nullable: true },
          email: { type: 'string', nullable: true },
          total: { type: 'integer' },
          open_count: { type: 'integer' },
          closed_count: { type: 'integer' },
          no_reply_count: { type: 'integer' },
          avg_frt: { type: 'integer', nullable: true, description: 'Среднее first response time, секунды' },
          median_frt: { type: 'integer', nullable: true, description: 'Медиана first response time, секунды' },
        },
      },
      TeamListResponse: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/TeamListItem' } },
          unassigned: { type: 'integer' },
        },
      },
      SearchHit: {
        type: 'object',
        properties: {
          conversation_id: { type: 'string' },
          created_at: { type: 'integer', description: 'unix seconds' },
          updated_at: { type: 'integer' },
          contact_name: { type: 'string', nullable: true },
          contact_email: { type: 'string', nullable: true },
          source_bucket: { $ref: '#/components/schemas/SourceBucket' },
          status_bucket: { $ref: '#/components/schemas/StatusBucket' },
          admin_assignee_id: { type: 'string', nullable: true },
          admin_name: { type: 'string', nullable: true },
          snippet: {
            type: 'string',
            description: 'HTML-фрагмент с тегами <mark> вокруг совпадений',
          },
          match_count: { type: 'integer' },
        },
      },
      SearchResponse: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/SearchHit' } },
          total: { type: 'integer' },
          page: { type: 'integer' },
          page_size: { type: 'integer' },
          query: { type: 'string' },
          match: { type: 'string', nullable: true, description: 'Скомпилированный FTS5 MATCH' },
          truncated: { type: 'boolean' },
        },
      },
      ConversationMessage: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          created_at: { type: 'integer' },
          part_type: { type: 'string', nullable: true },
          author_type: { type: 'string', nullable: true },
          author_id: { type: 'string', nullable: true },
          body: { type: 'string', nullable: true },
          author_name: { type: 'string', nullable: true },
        },
      },
      ConversationDetail: {
        type: 'object',
        properties: {
          conversation: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              created_at: { type: 'integer' },
              updated_at: { type: 'integer' },
              state: { type: 'string', nullable: true },
              open: { type: 'integer' },
              contact_id: { type: 'string', nullable: true },
              contact_name: { type: 'string', nullable: true },
              contact_email: { type: 'string', nullable: true },
              contact_external_id: { type: 'string', nullable: true },
              team_assignee_id: { type: 'string', nullable: true },
              team_name: { type: 'string', nullable: true },
              admin_assignee_id: { type: 'string', nullable: true },
              admin_name: { type: 'string', nullable: true },
              admin_email: { type: 'string', nullable: true },
              source_type: { type: 'string', nullable: true },
              source_url: { type: 'string', nullable: true },
              source_subject: { type: 'string', nullable: true },
              source_bucket: { $ref: '#/components/schemas/SourceBucket' },
              status_bucket: { $ref: '#/components/schemas/StatusBucket' },
              status_source: { type: 'string', enum: ['heuristic', 'manual'] },
              parts_count: { type: 'integer' },
              user_messages_count: { type: 'integer' },
              admin_messages_count: { type: 'integer' },
              first_admin_reply_at: { type: 'integer', nullable: true },
              first_response_seconds: { type: 'integer', nullable: true },
            },
          },
          messages: { type: 'array', items: { $ref: '#/components/schemas/ConversationMessage' } },
          override: {
            type: 'object',
            nullable: true,
            properties: {
              status_bucket: { $ref: '#/components/schemas/StatusBucket' },
              set_by: { type: 'string' },
              set_at: { type: 'integer' },
              note: { type: 'string', nullable: true },
            },
          },
          intercom_url: { type: 'string', format: 'uri' },
        },
      },
      StatusOverrideRequest: {
        type: 'object',
        required: ['status_bucket'],
        properties: {
          status_bucket: { $ref: '#/components/schemas/StatusBucket' },
          note: { type: 'string', nullable: true, maxLength: 500 },
        },
      },
      StatusOverrideResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          conversation_id: { type: 'string' },
          status_bucket: { $ref: '#/components/schemas/StatusBucket' },
          status_source: { type: 'string', enum: ['heuristic', 'manual'] },
          set_by: { type: 'string' },
          set_at: { type: 'integer' },
          note: { type: 'string', nullable: true },
          reason: { type: 'string', description: 'Для DELETE — причина из классификатора' },
        },
      },
      ClosedDealItem: {
        type: 'object',
        properties: {
          conversation_id: { type: 'string' },
          created_at: { type: 'integer' },
          updated_at: { type: 'integer' },
          contact_name: { type: 'string', nullable: true },
          contact_email: { type: 'string', nullable: true },
          source_bucket: { $ref: '#/components/schemas/SourceBucket' },
          status_source: { type: 'string', enum: ['heuristic', 'manual'] },
          admin_assignee_id: { type: 'string', nullable: true },
          admin_name: { type: 'string', nullable: true },
          override: {
            type: 'object',
            nullable: true,
            properties: {
              set_by: { type: 'string' },
              set_at: { type: 'integer' },
              note: { type: 'string', nullable: true },
            },
          },
        },
      },
      ClosedDealsResponse: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/ClosedDealItem' } },
          total: { type: 'integer' },
          page: { type: 'integer' },
          page_size: { type: 'integer' },
        },
      },
      HealthCheck: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Идентификатор проверки (database, tables, fts, bootstrap, worker_process, incremental, sync_errors_24h, env, users_file, intercom_api)',
          },
          status: { type: 'string', enum: ['ok', 'warn', 'fail'] },
          latency_ms: { type: 'integer' },
          message: { type: 'string' },
          details: { type: 'object', additionalProperties: true, nullable: true },
        },
      },
      HealthResponse: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['ok', 'warn', 'fail'],
            description: 'Сводный статус = худший из всех checks',
          },
          now: { type: 'integer', description: 'unix seconds' },
          checks: { type: 'array', items: { $ref: '#/components/schemas/HealthCheck' } },
        },
      },
      AdminDetailResponse: {
        type: 'object',
        properties: {
          admin: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string', nullable: true },
              email: { type: 'string', nullable: true },
            },
          },
          totals: {
            type: 'object',
            properties: {
              total: { type: 'integer' },
              open_count: { type: 'integer' },
              closed_count: { type: 'integer' },
              avg_frt: { type: 'integer', nullable: true },
              median_frt: { type: 'integer', nullable: true },
            },
          },
          daily: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                day: { type: 'string', format: 'date' },
                n: { type: 'integer' },
                avg_frt: { type: 'integer', nullable: true },
              },
            },
          },
          by_status: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                status_bucket: { $ref: '#/components/schemas/StatusBucket' },
                n: { type: 'integer' },
              },
            },
          },
          by_source: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                source_bucket: { $ref: '#/components/schemas/SourceBucket' },
                n: { type: 'integer' },
              },
            },
          },
          frt_distribution: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                n: { type: 'integer' },
              },
            },
          },
        },
      },
    },
  },
  security: [{ sessionCookie: [] }],
  paths: {
    '/api/auth/login': {
      post: {
        tags: ['auth'],
        summary: 'Логин по логину/паролю',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LoginRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'OK — устанавливает cookie session',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginResponse' } } },
          },
          '401': {
            description: 'Неверные креды',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '429': { description: 'Rate limit (10 req/min на IP)' },
        },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['auth'],
        summary: 'Выход — очищает cookie',
        responses: { '200': { description: 'OK' } },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['auth'],
        summary: 'Текущий пользователь',
        responses: {
          '200': { description: 'OK' },
          '401': { description: 'Не авторизован' },
        },
      },
    },
    '/api/traffic/by-source': {
      get: {
        tags: ['traffic'],
        summary: 'Распределение диалогов по источникам',
        parameters: [
          { $ref: '#/components/parameters/Period' },
          { $ref: '#/components/parameters/From' },
          { $ref: '#/components/parameters/To' },
          { $ref: '#/components/parameters/Sources' },
          { $ref: '#/components/parameters/Statuses' },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/BySourceResponse' } } },
          },
          '401': { description: 'Не авторизован' },
        },
      },
    },
    '/api/traffic/daily': {
      get: {
        tags: ['traffic'],
        summary: 'Дневной разрез с пивотом по источникам',
        parameters: [
          { $ref: '#/components/parameters/Period' },
          { $ref: '#/components/parameters/From' },
          { $ref: '#/components/parameters/To' },
          { $ref: '#/components/parameters/Sources' },
          { $ref: '#/components/parameters/Statuses' },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/DailyResponse' } } },
          },
          '401': { description: 'Не авторизован' },
        },
      },
    },
    '/api/traffic/funnel': {
      get: {
        tags: ['traffic'],
        summary: 'Воронка диалогов: всего → первый ответ → закрыто → closed_deal',
        parameters: [
          { $ref: '#/components/parameters/Period' },
          { $ref: '#/components/parameters/From' },
          { $ref: '#/components/parameters/To' },
          { $ref: '#/components/parameters/Sources' },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/FunnelResponse' } } },
          },
          '401': { description: 'Не авторизован' },
        },
      },
    },
    '/api/traffic/top-pages': {
      get: {
        tags: ['traffic'],
        summary: 'Топ URL источника website',
        parameters: [
          { $ref: '#/components/parameters/Period' },
          { $ref: '#/components/parameters/From' },
          { $ref: '#/components/parameters/To' },
        ],
        responses: {
          '200': {
            description: 'OK (макс. 20 URL, нормализованные)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/TopPagesResponse' } } },
          },
          '401': { description: 'Не авторизован' },
        },
      },
    },
    '/api/team/list': {
      get: {
        tags: ['team'],
        summary: 'Список менеджеров с метриками за период',
        parameters: [
          { $ref: '#/components/parameters/Period' },
          { $ref: '#/components/parameters/From' },
          { $ref: '#/components/parameters/To' },
          { $ref: '#/components/parameters/Sources' },
          { $ref: '#/components/parameters/Statuses' },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/TeamListResponse' } } },
          },
          '401': { description: 'Не авторизован' },
        },
      },
    },
    '/api/team/admin/{id}': {
      get: {
        tags: ['team'],
        summary: 'Детали по менеджеру: daily, FRT, статусы, источники',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Intercom admin id',
          },
          { $ref: '#/components/parameters/Period' },
          { $ref: '#/components/parameters/From' },
          { $ref: '#/components/parameters/To' },
          { $ref: '#/components/parameters/Sources' },
          { $ref: '#/components/parameters/Statuses' },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/AdminDetailResponse' } } },
          },
          '400': { description: 'missing id' },
          '401': { description: 'Не авторизован' },
        },
      },
    },
    '/api/search': {
      get: {
        tags: ['search'],
        summary: 'Полнотекстовый поиск по сообщениям (FTS5)',
        description:
          'Двухфазный запрос: (1) FTS5 bm25 по messages_fts, (2) свёртка до одного хита на диалог и фильтрация глобальными фильтрами. Запросы короче 2 символов игнорируются; токены склеиваются как префиксы `"token"*`.',
        parameters: [
          {
            name: 'q',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            description: 'Поисковый запрос пользователя',
          },
          {
            name: 'admin_id',
            in: 'query',
            schema: { type: 'string' },
            description: 'Фильтр по назначенному менеджеру',
          },
          {
            name: 'page',
            in: 'query',
            schema: { type: 'integer', minimum: 1, default: 1 },
          },
          {
            name: 'page_size',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          },
          { $ref: '#/components/parameters/Period' },
          { $ref: '#/components/parameters/From' },
          { $ref: '#/components/parameters/To' },
          { $ref: '#/components/parameters/Sources' },
          { $ref: '#/components/parameters/Statuses' },
        ],
        responses: {
          '200': {
            description: 'OK. Если запрос пуст/слишком короткий — возвращается `items: [], total: 0, match: null`.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SearchResponse' } } },
          },
          '401': { description: 'Не авторизован' },
        },
      },
    },
    '/api/conversation/{id}': {
      get: {
        tags: ['search'],
        summary: 'Полные данные диалога + все сообщения + manual override',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Intercom conversation id',
          },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ConversationDetail' } } },
          },
          '400': { description: 'missing id' },
          '401': { description: 'Не авторизован' },
          '404': { description: 'Диалог не найден' },
        },
      },
    },
    '/api/conversation/{id}/status': {
      post: {
        tags: ['deals'],
        summary: 'Установить ручной статус диалога (admin-only)',
        description:
          'Апсёртит запись в conversation_status_overrides и выставляет conversations.status_bucket + status_source=manual.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/StatusOverrideRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/StatusOverrideResponse' } },
            },
          },
          '400': { description: 'Неверный status_bucket / тело запроса' },
          '401': { description: 'Не авторизован' },
          '403': { description: 'Требуется роль admin' },
          '404': { description: 'Диалог не найден' },
        },
      },
      delete: {
        tags: ['deals'],
        summary: 'Снять ручной статус и пересчитать эвристику (admin-only)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/StatusOverrideResponse' } },
            },
          },
          '401': { description: 'Не авторизован' },
          '403': { description: 'Требуется роль admin' },
          '404': { description: 'Диалог не найден' },
        },
      },
    },
    '/api/closed-deals': {
      get: {
        tags: ['deals'],
        summary: 'Список диалогов со статусом closed_deal',
        description:
          'Фильтр по статусу игнорируется — всегда выдаёт closed_deal. Сортировка: сначала ручные (по set_at), потом остальные по updated_at.',
        parameters: [
          {
            name: 'admin_id',
            in: 'query',
            schema: { type: 'string' },
            description: 'Фильтр по назначенному менеджеру',
          },
          {
            name: 'page',
            in: 'query',
            schema: { type: 'integer', minimum: 1, default: 1 },
          },
          {
            name: 'page_size',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
          },
          { $ref: '#/components/parameters/Period' },
          { $ref: '#/components/parameters/From' },
          { $ref: '#/components/parameters/To' },
          { $ref: '#/components/parameters/Sources' },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ClosedDealsResponse' } },
            },
          },
          '401': { description: 'Не авторизован' },
        },
      },
    },
    '/api/export': {
      get: {
        tags: ['export'],
        summary: 'Выгрузка диалогов в CSV/JSON с учётом глобальных фильтров',
        description:
          'Стримит одну строку на диалог. Поддерживает FTS-фильтр `q` (двухфазно как /api/search), `admin_id`, period/sources/statuses. Потолок — 100000 строк. Логируется в activity log как action=export.',
        parameters: [
          {
            name: 'format',
            in: 'query',
            schema: { type: 'string', enum: ['csv', 'json'], default: 'csv' },
          },
          {
            name: 'q',
            in: 'query',
            schema: { type: 'string' },
            description: 'FTS-запрос по сообщениям (как в /api/search)',
          },
          {
            name: 'admin_id',
            in: 'query',
            schema: { type: 'string' },
          },
          { $ref: '#/components/parameters/Period' },
          { $ref: '#/components/parameters/From' },
          { $ref: '#/components/parameters/To' },
          { $ref: '#/components/parameters/Sources' },
          { $ref: '#/components/parameters/Statuses' },
        ],
        responses: {
          '200': {
            description: 'Файл CSV или JSON (Content-Disposition: attachment)',
            content: {
              'text/csv': { schema: { type: 'string' } },
              'application/json': { schema: { type: 'array', items: { type: 'object' } } },
            },
          },
          '400': { description: 'format must be csv or json' },
          '401': { description: 'Не авторизован' },
        },
      },
    },
    '/api/health': {
      get: {
        tags: ['health'],
        summary: 'Liveness probe (без авторизации)',
        description:
          'Минимальная проверка: DB открывается + env vars выставлены. Подходит для nginx/systemd/лоад-балансера. HTTP 200 когда status=ok|warn, 503 когда fail.',
        security: [],
        responses: {
          '200': {
            description: 'ok или warn',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } },
          },
          '503': {
            description: 'fail — база недоступна или критичный env отсутствует',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } },
          },
        },
      },
    },
    '/api/health/full': {
      get: {
        tags: ['health'],
        summary: 'Полный health check (требует сессию)',
        description:
          'Запускает все проверки: database, tables, fts, bootstrap, worker_process, incremental, sync_errors_24h, env, users_file и опционально Intercom API. Сводный статус = худший из всех. HTTP 503 при fail.',
        parameters: [
          {
            name: 'probe',
            in: 'query',
            schema: { type: 'integer', enum: [0, 1], default: 1 },
            description: 'Передай `probe=0` чтобы пропустить реальный запрос к Intercom API',
          },
        ],
        responses: {
          '200': {
            description: 'ok или warn',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } },
          },
          '401': { description: 'Не авторизован' },
          '503': {
            description: 'fail',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } },
          },
        },
      },
    },
    '/api/sync-status': {
      get: {
        tags: ['sync'],
        summary: 'Состояние bootstrap + incremental + последние ошибки',
        responses: {
          '200': { description: 'OK' },
          '401': { description: 'Не авторизован' },
        },
      },
    },
  },
} as const;
