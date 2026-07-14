import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { format } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CalendarIcon } from "lucide-react";

interface FormInput {
  id: number;
  name: string;
  label: string;
  field_type: string;
  placeholder: string;
  default_value: string;
  required: boolean;
  created_at: string;
}

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: "Text",
  date: "Date",
  number: "Number",
  email: "Email",
  textarea: "Textarea",
};

function FormPopup() {
  const [trigger, setTrigger] = useState("");
  const [fields, setFields] = useState<FormInput[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const win = getCurrentWindow();
    invoke<[string, string, FormInput[]] | null>("get_pending_form").then((data) => {
      if (!data) return;
      const [trig, _exp, flds] = data;
      setTrigger(trig);
      setFields(flds);
      const initial: Record<string, string> = {};
      for (const f of flds) {
        initial[f.name] = f.default_value;
      }
      setValues(initial);
    });
    win.onFocusChanged(({ payload: focused }) => {
      if (!focused) win.close();
    });
  }, []);

  function setValue(name: string, val: string) {
    setValues((prev) => ({ ...prev, [name]: val }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    for (const f of fields) {
      if (f.required && !values[f.name]?.trim()) {
        errs[f.name] = "This field is required";
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    const formValues: Record<string, string> = {};
    for (const f of fields) {
      formValues[f.name] = values[f.name]?.trim() ?? "";
    }
    await invoke("submit_form_injection", { values: formValues });
  }

  function handleCancel() {
    invoke("cancel_form_injection").catch(() => {});
    getCurrentWindow().close();
  }

  function handleKey(e: React.KeyboardEvent, idx: number) {
    if (e.key === "Escape") {
      handleCancel();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (idx === fields.length - 1) {
        handleSubmit();
      } else {
        const next = document.querySelector<HTMLElement>(`[data-form-idx="${idx + 1}"]`);
        next?.focus();
      }
    }
  }

  if (fields.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-popover text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-popover text-popover-foreground" style={{ fontFamily: "Architects Daughter, sans-serif", letterSpacing: "0.5px" }}>
      <div className="flex shrink-0 items-center gap-2 px-3 py-2.5">
        <img src="/quill-icon.png" alt="" className="size-4 shrink-0 opacity-50" />
        <span className="text-sm font-medium text-card-foreground">Form — {trigger}</span>
      </div>
      <div className="h-px shrink-0 bg-border/50" />
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="flex flex-col gap-3">
          {fields.map((f, i) => (
            <div key={f.name} className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">
                {f.label}
                {f.required && <span className="ml-0.5 text-destructive">*</span>}
                <span className="ml-1.5 text-[10px] text-muted-foreground/60">({FIELD_TYPE_LABELS[f.field_type] || f.field_type})</span>
              </label>
              {f.field_type === "date" ? (
                <Popover>
                  <PopoverTrigger
                    render={
                      <Button
                        variant="outline"
                        data-empty={!values[f.name]}
                        className="justify-start text-left font-normal data-[empty=true]:text-muted-foreground"
                      />
                    }
                  >
                    <CalendarIcon className="size-4" />
                    {values[f.name] ? format(new Date(values[f.name]), "PPP") : <span>{f.placeholder || "Pick a date"}</span>}
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={values[f.name] ? new Date(values[f.name]) : undefined}
                      onSelect={(date) => setValue(f.name, date ? format(date, "yyyy-MM-dd") : "")}
                    />
                  </PopoverContent>
                </Popover>
              ) : f.field_type === "textarea" ? (
                <textarea
                  data-form-idx={i}
                  autoFocus={i === 0}
                  value={values[f.name] ?? ""}
                  onChange={(e) => setValue(f.name, e.target.value)}
                  onKeyDown={(e) => handleKey(e, i)}
                  placeholder={f.placeholder || undefined}
                  rows={3}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground placeholder:text-muted-foreground outline-none ring-ring focus:ring-2 resize-none"
                />
              ) : (
                <input
                  data-form-idx={i}
                  autoFocus={i === 0}
                  type={f.field_type === "number" ? "number" : f.field_type === "email" ? "email" : "text"}
                  value={values[f.name] ?? ""}
                  onChange={(e) => setValue(f.name, e.target.value)}
                  onKeyDown={(e) => handleKey(e, i)}
                  placeholder={f.placeholder || undefined}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground placeholder:text-muted-foreground outline-none ring-ring focus:ring-2"
                />
              )}
              {errors[f.name] && (
                <span className="text-xs text-destructive">{errors[f.name]}</span>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border/50 px-4 py-3">
        <button
          onClick={handleCancel}
          className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent/30 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          className="rounded-lg bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Insert
        </button>
      </div>
    </div>
  );
}

export default FormPopup;
