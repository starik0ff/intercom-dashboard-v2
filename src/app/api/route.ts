// Swagger UI shell. Loads spec from /api/openapi.json.
// Public — no auth required (whitelisted in proxy.ts).

export const dynamic = 'force-static';

const HTML = `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Intercom Dashboard API — Swagger UI</title>
    <link
      rel="stylesheet"
      href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css"
    />
    <style>
      body { margin: 0; background: #fafafa; }
      .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
    <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-standalone-preset.js"></script>
    <script>
      window.addEventListener('load', function () {
        window.ui = SwaggerUIBundle({
          url: '/api/openapi.json',
          dom_id: '#swagger-ui',
          deepLinking: true,
          presets: [
            SwaggerUIBundle.presets.apis,
            SwaggerUIStandalonePreset.slice(1),
          ],
          plugins: [SwaggerUIBundle.plugins.DownloadUrl],
          layout: 'BaseLayout',
          withCredentials: true,
          requestInterceptor: function (req) {
            req.credentials = 'include';
            return req;
          },
        });
      });
    </script>
  </body>
</html>`;

export async function GET() {
  return new Response(HTML, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
}
