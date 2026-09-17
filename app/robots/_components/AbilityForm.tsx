"use client";

import { useMemo, useState } from "react";
import type { AbilityCard, JsonSchema } from "../_lib/types.ts";

/**
 * The run form is generated from the ability's own input schema — the same
 * object the kernel validates against and hands to Claude as a tool definition.
 * Writing the form by hand would be a third copy of the same truth, and the one
 * most likely to drift.
 */
export function AbilityForm({
  ability,
  disabled,
  onRun,
}: {
  ability: AbilityCard;
  disabled: boolean;
  onRun: (input: Record<string, unknown>) => void;
}) {
  const fields = useMemo(() => describeFields(ability.inputSchema), [ability.inputSchema]);
  const [values, setValues] = useState<Record<string, string>>(() => initial(fields));
  const [raw, setRaw] = useState("{}");
  const [error, setError] = useState<string | null>(null);

  // Rebuild the defaults whenever a different ability is selected.
  const key = ability.id;
  const [lastKey, setLastKey] = useState(key);
  if (lastKey !== key) {
    setLastKey(key);
    setValues(initial(fields));
    setRaw("{}");
    setError(null);
  }

  const complex = fields.some((f) => f.kind === "complex");

  const submit = () => {
    setError(null);
    if (complex) {
      try {
        onRun(JSON.parse(raw) as Record<string, unknown>);
      } catch (parseError) {
        setError((parseError as Error).message);
      }
      return;
    }

    const input: Record<string, unknown> = {};
    for (const field of fields) {
      const value = values[field.name];
      if (value === undefined || value === "") continue;
      if (field.kind === "number") {
        const parsed = Number(value);
        if (Number.isNaN(parsed)) {
          setError(`${field.name} لازم يكون رقم`);
          return;
        }
        input[field.name] = parsed;
      } else if (field.kind === "boolean") {
        input[field.name] = value === "true";
      } else {
        input[field.name] = value;
      }
    }

    const missing = fields.filter((f) => f.required && input[f.name] === undefined);
    if (missing.length > 0) {
      setError(`ناقص: ${missing.map((f) => f.name).join("، ")}`);
      return;
    }
    onRun(input);
  };

  return (
    <div className="space-y-3">
      {complex ? (
        <label className="block">
          <span className="mb-1 block text-xs text-slate-500">
            المدخلات (JSON) — هالقدرة بتاخد بيانات مركّبة
          </span>
          <textarea
            dir="ltr"
            rows={5}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
        </label>
      ) : fields.length === 0 ? (
        <p className="text-xs text-slate-500">ما بتحتاج أي مدخلات.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {fields.map((field) => (
            <label key={field.name} className="block">
              <span className="mb-1 flex items-baseline gap-1 text-xs text-slate-600">
                <code dir="ltr" className="text-[11px] text-slate-700">
                  {field.name}
                </code>
                {field.required && <span className="text-rose-500">*</span>}
              </span>

              {field.kind === "boolean" ? (
                <select
                  value={values[field.name] ?? "false"}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [field.name]: e.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                >
                  <option value="false">لا</option>
                  <option value="true">نعم</option>
                </select>
              ) : field.options ? (
                <select
                  value={values[field.name] ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [field.name]: e.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                >
                  <option value="">—</option>
                  {field.options.map((option) => (
                    <option key={String(option)} value={String(option)}>
                      {String(option)}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  dir="ltr"
                  inputMode={field.kind === "number" ? "decimal" : "text"}
                  value={values[field.name] ?? ""}
                  placeholder={field.placeholder}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [field.name]: e.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                />
              )}

              {field.description && (
                <span className="mt-1 block text-[10px] leading-snug text-slate-400" dir="ltr">
                  {field.description}
                </span>
              )}
            </label>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-rose-600">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={disabled}
        className="w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {disabled ? "في مهمة شغالة…" : "شغّل القدرة"}
      </button>
    </div>
  );
}

type Field = {
  name: string;
  kind: "number" | "string" | "boolean" | "complex";
  required: boolean;
  description?: string;
  placeholder?: string;
  options?: Array<string | number>;
};

function describeFields(schema: JsonSchema | undefined): Field[] {
  if (!schema?.properties) return [];
  return Object.entries(schema.properties).map(([name, property]) => ({
    name,
    kind:
      property.type === "number"
        ? "number"
        : property.type === "boolean"
          ? "boolean"
          : property.type === "string"
            ? "string"
            : "complex",
    required: schema.required?.includes(name) ?? false,
    description: property.description,
    placeholder: property.default !== undefined ? String(property.default) : undefined,
    options: property.enum,
  }));
}

function initial(fields: Field[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    if (field.placeholder !== undefined) out[field.name] = field.placeholder;
    if (field.kind === "boolean" && out[field.name] === undefined) {
      out[field.name] = "false";
    }
  }
  return out;
}
