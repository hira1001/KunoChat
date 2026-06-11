import { FolderOpen, Trash2, X } from "lucide-react";
import type { KunoSettings } from "../features/chat/messageTypes";
import { StatusDot } from "./StatusDot";

type SettingsScreenProps = {
  settings: KunoSettings;
  onChange: (settings: Partial<KunoSettings>) => void;
  onClose: () => void;
  onPickSaveFolder: () => void;
  onClearHistory: () => void;
};

export function SettingsScreen({ settings, onChange, onClose, onPickSaveFolder, onClearHistory }: SettingsScreenProps) {
  return (
    <div className="flex h-full w-full flex-col bg-white">
      <header className="flex h-[52px] items-center border-b border-border px-4">
        <div className="flex flex-1 items-center gap-2 text-[14px] font-semibold text-text">
          KunoChat
          <StatusDot status="connected" label="connected" />
        </div>
        <button
          type="button"
          aria-label="Close settings"
          onClick={onClose}
          className="grid h-8 w-8 place-items-center rounded-pill text-muted hover:bg-surface-hover hover:text-text"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div className="kuno-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="text-[18px] font-semibold text-text">設定</div>
        <div className="mt-5 text-[12px] font-semibold text-text">プロフィール</div>
        <div className="mt-2 rounded-[12px] border border-border bg-white p-3 shadow-card">
          <label className="block text-[11px] font-medium text-muted" htmlFor="display-name">
            表示名
          </label>
          <input
            id="display-name"
            value={settings.displayName}
            onChange={(event) => onChange({ displayName: event.target.value })}
            className="mt-2 h-9 w-full rounded-[9px] border border-border bg-white px-3 text-[13px] outline-none focus:border-border-strong"
          />
        </div>

        <div className="mt-4">
          <div className="text-[12px] font-semibold text-text">保存先</div>
          <button
            type="button"
            onClick={onPickSaveFolder}
            className="mt-2 flex h-10 w-full items-center gap-2 rounded-[10px] border border-border bg-white px-3 text-left text-[12px] text-text shadow-card hover:bg-surface-hover"
          >
            <FolderOpen className="h-4 w-4 text-muted" />
            <span className="min-w-0 flex-1 truncate">{settings.saveFolder}</span>
            <span className="text-[12px] text-text">変更</span>
          </button>
        </div>

        <div className="mt-5 space-y-3">
          <Toggle label="Always on top" checked={settings.alwaysOnTop} onChange={(value) => onChange({ alwaysOnTop: value })} />
          <Toggle label="Launch at login" checked={settings.launchAtLogin} onChange={(value) => onChange({ launchAtLogin: value })} />
          <Toggle label="Notifications" checked={settings.notifications} onChange={(value) => onChange({ notifications: value })} />
          <Toggle label="Sound" checked={settings.sound} onChange={(value) => onChange({ sound: value })} />
        </div>

        <div className="mt-5">
          <div className="text-[12px] font-semibold text-text">ショートカット</div>
          <div className="mt-2 flex h-10 items-center rounded-[10px] border border-border bg-white text-[12px] shadow-card">
            <div className="min-w-0 flex-1 truncate px-3 font-mono text-text">{settings.shortcut.replace("CommandOrControl", "Ctrl")}</div>
            <button type="button" className="h-full border-l border-border px-3 text-[12px] text-text">
              変更
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onClearHistory}
          className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-[10px] border border-border bg-white text-[12px] font-semibold text-danger shadow-card hover:bg-red-50"
        >
          <Trash2 className="h-4 w-4" />
          Clear history
        </button>
      </div>
    </div>
  );
}

type ToggleProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <label className="flex h-8 items-center justify-between">
      <span className="text-[13px] text-text">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span className={`relative h-5 w-9 rounded-full transition ${checked ? "bg-accent" : "bg-slate-300"}`}>
        <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${checked ? "translate-x-4" : ""}`} />
      </span>
    </label>
  );
}
