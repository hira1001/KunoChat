import { FolderOpen, Moon, Sun, Trash2, X } from "lucide-react";
import type { KunoSettings } from "../features/chat/messageTypes";
import clsx from "clsx";
import { useEffect, useState } from "react";

type SettingsScreenProps = {
  settings: KunoSettings;
  onChange: (settings: Partial<KunoSettings>) => void;
  onClose: () => void;
  onPickSaveFolder: () => void;
  onClearHistory: () => void;
};

export function SettingsScreen({ settings, onChange, onClose, onPickSaveFolder, onClearHistory }: SettingsScreenProps) {
  const [isDark, setIsDark] = useState(() => document.body.classList.contains("dark"));

  function toggleDarkMode() {
    const next = !isDark;
    setIsDark(next);
    document.body.classList.toggle("dark", next);
  }

  return (
    <div className="kuno-screen-enter flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden bg-bg">
      {/* Header */}
      <header className="flex h-[48px] min-w-0 shrink-0 items-center gap-2 overflow-hidden border-b border-border bg-bg-glass px-4 backdrop-blur-[20px]">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-accent">
          <span className="h-1.5 w-1.5 rounded-sm bg-white" />
        </span>
        <div className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-[-0.01em] text-text">
          KunoChat
        </div>
        {/* Dark mode toggle */}
        <button
          type="button"
          id="dark-mode-toggle"
          aria-label={isDark ? "ライトモードに切り替え" : "ダークモードに切り替え"}
          onClick={toggleDarkMode}
          className="kuno-focus-ring grid h-8 w-8 place-items-center rounded-pill text-muted transition-all duration-150 hover:bg-surface-hover hover:text-text active:scale-90"
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <button
          type="button"
          id="settings-close-btn"
          aria-label="設定を閉じる"
          onClick={onClose}
          className="kuno-focus-ring grid h-8 w-8 place-items-center rounded-pill text-muted transition-all duration-150 hover:bg-surface-hover hover:text-text active:scale-90"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {/* Body */}
      <div className="kuno-scrollbar min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4">
        <div className="text-[20px] font-semibold tracking-[-0.03em] text-text">設定</div>

        {/* Profile section */}
        <SectionTitle className="mt-5">プロフィール</SectionTitle>
        <div className="mt-2 overflow-hidden rounded-[13px] border border-border bg-surface p-3 shadow-card">
          <label className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-faint" htmlFor="display-name">
            表示名
          </label>
          <input
            id="display-name"
            value={settings.displayName}
            onChange={(event) => onChange({ displayName: event.target.value })}
            className="kuno-focus-ring mt-2 h-9 w-full rounded-[10px] border border-border bg-bg px-3 text-[13px] text-text outline-none transition-all duration-200 placeholder:text-faint focus:border-accent/40 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
        </div>

        {/* Save folder section */}
        <SectionTitle className="mt-5">保存先フォルダ</SectionTitle>
        <button
          type="button"
          id="pick-save-folder-btn"
          onClick={onPickSaveFolder}
          className="kuno-focus-ring mt-2 flex h-10 w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-[11px] border border-border bg-surface px-3 text-left shadow-card transition-all duration-150 hover:border-border-strong hover:shadow-window active:scale-[0.99]"
        >
          <FolderOpen className="h-4 w-4 shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-[12px] text-text">{settings.saveFolder}</span>
          <span className="shrink-0 text-[12px] font-semibold text-accent">変更</span>
        </button>

        {/* Toggles */}
        <SectionTitle className="mt-5">環境設定</SectionTitle>
        <div className="mt-2 overflow-hidden rounded-[13px] border border-border bg-surface shadow-card divide-y divide-border">
          <Toggle
            id="toggle-always-on-top"
            label="Always on top"
            description="他のウィンドウより常に前面に表示"
            checked={settings.alwaysOnTop}
            onChange={(value) => onChange({ alwaysOnTop: value })}
          />
          <Toggle
            id="toggle-launch-at-login"
            label="Launch at login"
            description="ログイン時に自動的に起動"
            checked={settings.launchAtLogin}
            onChange={(value) => onChange({ launchAtLogin: value })}
          />
          <Toggle
            id="toggle-notifications"
            label="Notifications"
            description="メッセージ受信時にOS通知を表示"
            checked={settings.notifications}
            onChange={(value) => onChange({ notifications: value })}
          />
          <Toggle
            id="toggle-sound"
            label="Sound"
            description="送受信時に通知音を再生"
            checked={settings.sound}
            onChange={(value) => onChange({ sound: value })}
          />
        </div>

        {/* Shortcut */}
        <SectionTitle className="mt-5">ショートカット</SectionTitle>
        <div className="mt-2 flex h-10 min-w-0 items-center overflow-hidden rounded-[11px] border border-border bg-surface text-[12px] shadow-card">
          <div className="min-w-0 flex-1 truncate px-3 font-mono text-text">
            {settings.shortcut.replace("CommandOrControl", "⌘/Ctrl")}
          </div>
          <button
            type="button"
            id="change-shortcut-btn"
            className="kuno-focus-ring h-full shrink-0 border-l border-border px-3 text-[12px] font-semibold text-accent transition-all duration-150 hover:bg-accent-soft active:scale-95"
          >
            変更
          </button>
        </div>

        {/* Danger zone */}
        <button
          type="button"
          id="clear-history-btn"
          onClick={onClearHistory}
          className="kuno-focus-ring mt-6 flex h-10 w-full items-center justify-center gap-2 rounded-[11px] border border-danger/30 bg-surface text-[12px] font-semibold text-danger shadow-card transition-all duration-200 hover:border-danger hover:bg-red-50 active:scale-[0.99] dark:hover:bg-red-950/30"
        >
          <Trash2 className="h-4 w-4" />
          履歴を消去
        </button>
      </div>
    </div>
  );
}

function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx("text-[11px] font-semibold uppercase tracking-[0.07em] text-faint", className)}>
      {children}
    </div>
  );
}

type ToggleProps = {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

function Toggle({ id, label, description, checked, onChange }: ToggleProps) {
  return (
    <label htmlFor={id} className="flex min-h-[48px] min-w-0 cursor-default items-center justify-between gap-3 px-3 py-2.5 transition-colors duration-150 hover:bg-surface-hover">
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-text">{label}</div>
        {description ? (
          <div className="mt-0.5 truncate text-[11px] text-faint">{description}</div>
        ) : null}
      </div>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        className={clsx(
          "relative h-[22px] w-[38px] shrink-0 rounded-full transition-all duration-200",
          checked ? "bg-accent shadow-[0_0_0_1px_var(--accent)]" : "bg-surface-active shadow-[0_0_0_1px_var(--border)]"
        )}
      >
        <span
          className={clsx(
            "absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-200",
            checked ? "left-[18px]" : "left-[3px]"
          )}
        />
      </span>
    </label>
  );
}
