"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  ArrowLeft,
  Play,
  Square,
  Terminal,
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from "lucide-react";

interface ScriptArg {
  name: string;
  label: string;
  type: "string" | "boolean";
  required?: boolean;
  placeholder?: string;
}

interface ScriptDef {
  id: string;
  name: string;
  description: string;
  args: ScriptArg[];
  dangerous?: boolean;
}

type RunStatus = "idle" | "running" | "done" | "error";

interface RunState {
  scriptId: string;
  status: RunStatus;
  output: string;
  startedAt: Date;
}

export default function ScriptsPage() {
  const [scripts, setScripts] = useState<ScriptDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [argValues, setArgValues] = useState<Record<string, Record<string, string>>>({});
  const [run, setRun] = useState<RunState | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    fetch("/api/admin/scripts")
      .then((res) => {
        if (res.status === 403) throw new Error("Доступ запрещён.");
        return res.json();
      })
      .then((data) => setScripts(data.scripts || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const setArg = useCallback(
    (scriptId: string, argName: string, value: string) => {
      setArgValues((prev) => ({
        ...prev,
        [scriptId]: { ...prev[scriptId], [argName]: value },
      }));
    },
    [],
  );

  async function runScript(script: ScriptDef) {
    if (run?.status === "running") return;

    // Build args payload
    const argsPayload: { flag: string; value?: string }[] = [];
    const vals = argValues[script.id] || {};
    for (const arg of script.args) {
      if (arg.type === "boolean" && vals[arg.name] === "true") {
        argsPayload.push({ flag: arg.name });
      } else if (arg.type === "string" && vals[arg.name]) {
        argsPayload.push({ flag: arg.name, value: vals[arg.name] });
      }
    }

    // Validate required
    for (const arg of script.args) {
      if (arg.required && arg.type === "string" && !vals[arg.name]) {
        setRun({
          scriptId: script.id,
          status: "error",
          output: `Ошибка: обязательный параметр "${arg.label}" не заполнен.`,
          startedAt: new Date(),
        });
        return;
      }
    }

    const abort = new AbortController();
    abortRef.current = abort;

    setRun({
      scriptId: script.id,
      status: "running",
      output: "",
      startedAt: new Date(),
    });

    try {
      const res = await fetch("/api/admin/scripts/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: script.id, args: argsPayload }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        setRun((prev) =>
          prev ? { ...prev, status: "error", output: text || "Ошибка запуска" } : null,
        );
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        const snapshot = accumulated;
        setRun((prev) => (prev ? { ...prev, output: snapshot } : null));
        if (outputRef.current) {
          outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
      }

      const exitMatch = accumulated.match(/--- exit code: (\d+|unknown) ---/);
      const code = exitMatch?.[1];
      setRun((prev) =>
        prev
          ? { ...prev, status: code === "0" ? "done" : "error" }
          : null,
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        setRun((prev) =>
          prev ? { ...prev, status: "error", output: prev.output + "\n--- aborted ---\n" } : null,
        );
      } else {
        setRun((prev) =>
          prev
            ? { ...prev, status: "error", output: (err as Error).message }
            : null,
        );
      }
    } finally {
      abortRef.current = null;
    }
  }

  function stopScript() {
    abortRef.current?.abort();
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              На главную
            </a>
            <span className="text-gray-300">|</span>
            <h1 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
              <Terminal className="w-4 h-4" />
              Скрипты
            </h1>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {loading && (
          <div className="text-center py-16">
            <div className="inline-block w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-500 mt-3">Загрузка...</p>
          </div>
        )}

        {error && (
          <div className="text-center py-16">
            <p className="text-red-600 font-medium">{error}</p>
          </div>
        )}

        {!loading && !error && (
          <div className="grid grid-cols-1 gap-4">
            {scripts.map((s) => {
              const isRunning = run?.scriptId === s.id && run.status === "running";
              const vals = argValues[s.id] || {};

              return (
                <div
                  key={s.id}
                  className="bg-white rounded-xl border border-gray-200 overflow-hidden"
                >
                  <div className="px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h2 className="text-sm font-semibold text-gray-900">
                            {s.name}
                          </h2>
                          {s.dangerous && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                              <AlertTriangle className="w-3 h-3" />
                              modifies data
                            </span>
                          )}
                          <span className="text-xs text-gray-400 font-mono">
                            {s.id}.ts
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 mt-1">
                          {s.description}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isRunning ? (
                          <button
                            onClick={stopScript}
                            className="inline-flex items-center gap-1.5 text-sm text-red-600 hover:text-red-700 px-4 py-2 border border-red-300 rounded-lg hover:bg-red-50 transition-colors"
                          >
                            <Square className="w-4 h-4" />
                            Остановить
                          </button>
                        ) : (
                          <button
                            onClick={() => runScript(s)}
                            disabled={run?.status === "running"}
                            className="inline-flex items-center gap-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed px-4 py-2 rounded-lg transition-colors"
                          >
                            <Play className="w-4 h-4" />
                            Запустить
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Arguments */}
                    {s.args.length > 0 && (
                      <div className="mt-3 flex items-end gap-3 flex-wrap">
                        {s.args.map((arg) =>
                          arg.type === "boolean" ? (
                            <label
                              key={arg.name}
                              className="inline-flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none"
                            >
                              <input
                                type="checkbox"
                                checked={vals[arg.name] === "true"}
                                onChange={(e) =>
                                  setArg(
                                    s.id,
                                    arg.name,
                                    e.target.checked ? "true" : "",
                                  )
                                }
                                disabled={isRunning}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              {arg.label}
                            </label>
                          ) : (
                            <div key={arg.name} className="flex flex-col gap-1">
                              <label className="text-xs text-gray-500">
                                {arg.label}
                                {arg.required && (
                                  <span className="text-red-500 ml-0.5">*</span>
                                )}
                              </label>
                              <input
                                type="text"
                                value={vals[arg.name] || ""}
                                onChange={(e) =>
                                  setArg(s.id, arg.name, e.target.value)
                                }
                                disabled={isRunning}
                                placeholder={arg.placeholder}
                                className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 w-52 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-100"
                              />
                            </div>
                          ),
                        )}
                      </div>
                    )}
                  </div>

                  {/* Output panel */}
                  {run?.scriptId === s.id && run.output && (
                    <div className="border-t border-gray-200">
                      <div className="px-5 py-2 bg-gray-50 flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          {run.status === "running" && (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                              Выполняется...
                            </>
                          )}
                          {run.status === "done" && (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                              Завершено
                            </>
                          )}
                          {run.status === "error" && (
                            <>
                              <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                              Ошибка
                            </>
                          )}
                        </div>
                        <span className="text-xs text-gray-400">
                          {run.startedAt.toLocaleTimeString("ru-RU")}
                        </span>
                      </div>
                      <pre
                        ref={run.scriptId === s.id ? outputRef : undefined}
                        className="px-5 py-3 text-xs font-mono text-gray-800 bg-gray-900 text-gray-200 overflow-auto max-h-96 whitespace-pre-wrap"
                      >
                        {run.output}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
