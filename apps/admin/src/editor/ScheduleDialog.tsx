import type { Lang } from "@blog/shared";
import { type FormEvent, useState } from "react";
import { Dialog } from "../components/Dialog";
import { scheduleLabel, utcToZonedInput, ZONES, type ZoneKey, zonedInputToUtc } from "../lib/zones";

export const SCHEDULE_MIN_LEAD_MS = 2 * 60_000;

const tryUtc = (local: string, zone: ZoneKey): string | null => {
  try {
    return zonedInputToUtc(local, zone);
  } catch {
    return null;
  }
};

export function ScheduleDialog({
  lang,
  initialIso,
  zone,
  onZoneChange,
  onSubmit,
  onCancel,
  now = Date.now,
}: {
  lang: Lang;
  initialIso: string | null;
  zone: ZoneKey;
  onZoneChange: (zone: ZoneKey) => void;
  onSubmit: (iso: string) => void;
  onCancel: () => void;
  now?: () => number;
}) {
  const [local, setLocal] = useState(() =>
    utcToZonedInput(initialIso ?? new Date(now() + 60 * 60_000).toISOString(), zone),
  );
  const iso = tryUtc(local, zone);
  const tooSoon = iso !== null && Date.parse(iso) < now() + SCHEDULE_MIN_LEAD_MS;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (iso && !tooSoon) onSubmit(iso);
  }

  return (
    <Dialog title={`Hẹn giờ đăng bản ${lang}`} onClose={onCancel}>
      <form onSubmit={submit}>
        <label>
          Thời điểm
          <input
            type="datetime-local"
            value={local}
            required
            onChange={(e) => setLocal(e.target.value)}
          />
        </label>
        <label>
          Múi giờ
          <select value={zone} onChange={(e) => onZoneChange(e.target.value as ZoneKey)}>
            {(Object.keys(ZONES) as ZoneKey[]).map((key) => (
              <option key={key} value={key}>
                {ZONES[key].label}
              </option>
            ))}
          </select>
        </label>
        <p className="muted" aria-live="polite">
          {iso ? scheduleLabel(iso, zone) : "—"}
        </p>
        {tooSoon ? (
          <p role="alert" className="error">
            Thời điểm phải sau hiện tại ít nhất 2 phút
          </p>
        ) : null}
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Huỷ
          </button>
          <button type="submit" className="btn-primary" disabled={iso === null || tooSoon}>
            Hẹn giờ
          </button>
        </div>
      </form>
    </Dialog>
  );
}
