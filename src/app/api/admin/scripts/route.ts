import { requireRole, authErrorResponse } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

export interface ScriptDef {
  id: string;
  name: string;
  description: string;
  args: ScriptArg[];
  dangerous?: boolean;
}

export interface ScriptArg {
  name: string;
  label: string;
  type: "string" | "boolean";
  required?: boolean;
  placeholder?: string;
}

const SCRIPTS: ScriptDef[] = [
  {
    id: "retag-conversations",
    name: "Retag Conversations",
    description:
      "Ретроспективное тегирование всех диалогов по source_bucket. Работает через Intercom API, rate-limited.",
    args: [],
    dangerous: true,
  },
  {
    id: "close-reopened",
    name: "Close Reopened",
    description:
      "Находит переоткрытые диалоги у менеджера и закрывает их обратно.",
    args: [
      {
        name: "--admin-id",
        label: "Admin ID",
        type: "string",
        required: true,
        placeholder: "например 10175875",
      },
      { name: "--dry-run", label: "Dry run (без изменений)", type: "boolean" },
    ],
    dangerous: true,
  },
  {
    id: "move-conversations-to-team",
    name: "Move to Team",
    description:
      "Перемещает диалоги менеджеров в командный инбокс на основе маппинга имён.",
    args: [
      {
        name: "--admin-id",
        label: "Admin ID (опционально)",
        type: "string",
        placeholder: "все менеджеры если пусто",
      },
      { name: "--dry-run", label: "Dry run (без изменений)", type: "boolean" },
    ],
    dangerous: true,
  },
  {
    id: "verify-assignees",
    name: "Verify Assignees",
    description:
      "Аудит: проверяет «осиротевшие» диалоги без назначенного менеджера в командных инбоксах.",
    args: [],
  },
  {
    id: "check-fb-status",
    name: "Check FB Status",
    description:
      "Отчёт: статус миграции Facebook-диалогов в командные инбоксы.",
    args: [],
  },
];

export async function GET() {
  try {
    await requireRole("admin");
  } catch (err) {
    return authErrorResponse(err) ?? Response.json({ error: "Server error" }, { status: 500 });
  }

  return Response.json({ scripts: SCRIPTS });
}
