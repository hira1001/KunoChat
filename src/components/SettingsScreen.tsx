import { FolderOpen, Moon, Sun, Trash2, X, RefreshCw, Download, CheckCircle, AlertTriangle, ShieldOff } from "lucide-react";
import type { KunoSettings, TrustedPeer } from "../features/chat/messageTypes";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { BrandMark } from "./BrandMark";

type UpdateState =
  | { type: "idle" }
  | { type: "checking" }
  | { type: "available"; version: string; body?: string; date?: string; updateObj: any }
  | { type: "downloading"; progress: number }
  | { type: "installing" }
  | { type: "upToDate" }
  | { type: "error"; message: string };

type SettingsScreenProps = {
  settings: KunoSettings;
  currentPeerName?: string;
  currentTrustedPeer?: TrustedPeer;
  onChange: (settings: Partial<KunoSettings>) => void;
  onClose: () => void;
  onPickSaveFolder: () => void;
  onClearHistory: () => void;
  onForgetPeer: () => void;
};

export function SettingsScreen({ settings, currentPeerName, currentTrustedPeer, onChange, onClose, onPickSaveFolder, onClearHistory, onForgetPeer }: SettingsScreenProps) {
  const isDark = settings.theme === "dark";
  const [currentVersion, setCurrentVersion] = useState<string>("0.2.0");
  const [updateState, setUpdateState] = useState<UpdateState>({ type: "idle" });
  const trustedPeer = currentTrustedPeer ?? settings.trustedPeer;
  const peerName = currentPeerName ?? settings.peerDisplayName;

  useEffect(() => {
    getVersion().then(setCurrentVersion).catch((err) => console.error(err));
  }, []);

  async function handleCheckForUpdates() {
    setUpdateState({ type: "checking" });
    try {
      const update = await check();
      if (update) {
        setUpdateState({
          type: "available",
          version: update.version,
          body: update.body,
          date: update.date,
          updateObj: update
        });
      } else {
        setUpdateState({ type: "upToDate" });
        setTimeout(() => setUpdateState({ type: "idle" }), 4000);
      }
    } catch (error: any) {
      console.error(error);
      setUpdateState({ type: "error", message: error.message || String(error) });
    }
  }

  async function handleDownloadAndInstall(updateObj: any) {
    setUpdateState({ type: "downloading", progress: 0 });
    try {
      let downloaded = 0;
      let contentLength = 0;
      await updateObj.downloadAndInstall((event: any) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength || 0;
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              const progress = Math.round((downloaded / contentLength) * 100);
              setUpdateState({ type: "downloading", progress });
            } else {
              setUpdateState({ type: "downloading", progress: -1 });
            }
            break;
          case 'Finished':
            setUpdateState({ type: "installing" });
            break;
        }
      });
      await relaunch();
    } catch (error: any) {
      console.error(error);
      setUpdateState({ type: "error", message: error.message || String(error) });
    }
  }

  function toggleDarkMode() {
    onChange({ theme: isDark ? "light" : "dark" });
  }

  return (
    <div className="kuno-screen-enter flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden bg-bg">
      {/* Header */}
      <header className="flex h-[48px] min-w-0 shrink-0 items-center gap-2 overflow-hidden border-b border-border bg-bg-glass px-4 backdrop-blur-[20px]">
        <BrandMark className="h-5 w-5" />
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
        <div className="mt-2 overflow-hidden rounded-card border border-border bg-surface p-3 shadow-card">
          <label className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-faint" htmlFor="display-name">
            表示名
          </label>
          <input
            id="display-name"
            value={settings.displayName}
            onChange={(event) => onChange({ displayName: event.target.value })}
            className="kuno-focus-ring mt-2 h-9 w-full rounded-input border border-border bg-bg px-3 text-[13px] text-text outline-none transition-all duration-200 placeholder:text-faint focus:border-accent/40 focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
        </div>

        {/* Save folder section */}
        <SectionTitle className="mt-5">保存先フォルダ</SectionTitle>
        <button
          type="button"
          id="pick-save-folder-btn"
          onClick={onPickSaveFolder}
          className="kuno-focus-ring mt-2 flex h-10 w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-card border border-border bg-surface px-3 text-left shadow-card transition-all duration-150 hover:border-border-strong hover:shadow-window active:scale-[0.99]"
        >
          <FolderOpen className="h-4 w-4 shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-[12px] text-text">{settings.saveFolder}</span>
          <span className="shrink-0 text-[12px] font-semibold text-accent">変更</span>
        </button>

        {/* Toggles */}
        <SectionTitle className="mt-5">環境設定</SectionTitle>
        <div className="mt-2 overflow-hidden rounded-card border border-border bg-surface shadow-card divide-y divide-border">
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
        <div className="mt-2 flex h-10 min-w-0 items-center overflow-hidden rounded-card border border-border bg-surface text-[12px] shadow-card">
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

        {/* Pairing */}
        <SectionTitle className="mt-5">ペアリング</SectionTitle>
        <div className="mt-2 overflow-hidden rounded-card border border-border bg-surface p-3 shadow-card">
          <div className="flex min-w-0 items-start gap-2.5">
            <ShieldOff className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-text">
                {trustedPeer ? peerName || "ペア済みデバイス" : "ペア済みデバイスなし"}
              </div>
              <div className="mt-0.5 break-words text-[11px] leading-4 text-faint">
                {trustedPeer
                  ? `Fingerprint: ${trustedPeer.fingerprint}`
                  : "相手PCと接続すると、このPCに相手デバイスの鍵を保存します。"}
              </div>
            </div>
          </div>
          <button
            type="button"
            id="forget-peer-btn"
            onClick={onForgetPeer}
            disabled={!trustedPeer && !peerName}
            className="kuno-focus-ring mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-input border border-border bg-bg px-3 text-[12px] font-semibold text-text transition-all duration-150 enabled:hover:border-danger/40 enabled:hover:bg-red-50 enabled:hover:text-danger enabled:active:scale-[0.99] disabled:cursor-not-allowed disabled:text-faint dark:enabled:hover:bg-red-950/30"
          >
            <ShieldOff className="h-3.5 w-3.5" />
            ペア済み相手を忘れる
          </button>
        </div>

        {/* App Update Section */}
        <SectionTitle className="mt-5">アプリのアップデート</SectionTitle>
        <div className="mt-2 overflow-hidden rounded-card border border-border bg-surface p-4 shadow-card transition-all duration-300">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] font-semibold text-text">KunoChat</div>
              <div className="mt-0.5 text-[11px] text-faint">現在のバージョン: v{currentVersion}</div>
            </div>
            {updateState.type === "idle" && (
              <button
                type="button"
                id="check-updates-btn"
                onClick={handleCheckForUpdates}
                className="kuno-focus-ring flex h-8 items-center gap-1.5 rounded-input bg-accent px-3 text-[12px] font-semibold text-white shadow-sm transition-all duration-150 hover:bg-accent-hover active:scale-95"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                アップデートを確認
              </button>
            )}
          </div>

          {updateState.type === "checking" && (
            <div className="mt-3 flex items-center gap-2 text-[12px] text-muted">
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-accent" />
              <span>アップデートを確認中...</span>
            </div>
          )}

          {updateState.type === "upToDate" && (
            <div className="mt-3 flex items-center gap-2 text-[12px] text-success">
              <CheckCircle className="h-3.5 w-3.5 shrink-0" />
              <span>アプリは最新のバージョンです。</span>
            </div>
          )}

          {updateState.type === "error" && (
            <div className="mt-3">
              <div className="flex items-center gap-2 text-[12px] text-danger">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="font-semibold">アップデートを確認できません</span>
              </div>
              <div className="mt-1 text-[11px] leading-4 text-faint">ネットワーク接続を確認して、しばらくしてから再試行してください。</div>
              <button
                type="button"
                onClick={handleCheckForUpdates}
                className="mt-2 text-[11px] font-semibold text-accent hover:underline"
              >
                再試行
              </button>
            </div>
          )}

          {updateState.type === "available" && (
            <div className="mt-3 rounded-card border border-accent/20 bg-accent-soft p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[13px] font-semibold text-accent">新バージョン v{updateState.version} が利用可能です</div>
                  {updateState.date && (
                    <div className="mt-0.5 text-[10px] text-faint">リリース日: {updateState.date}</div>
                  )}
                  {updateState.body && (
                    <div className="mt-2 max-h-[80px] overflow-y-auto rounded bg-surface/50 p-2 font-sans text-[11px] leading-relaxed text-muted kuno-scrollbar">
                      {updateState.body}
                    </div>
                  )}
                </div>
              </div>
              <button
                type="button"
                id="install-update-btn"
                onClick={() => handleDownloadAndInstall(updateState.updateObj)}
                className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-input bg-accent text-[12px] font-semibold text-white shadow-sm transition-all duration-150 hover:bg-accent-hover active:scale-95"
              >
                <Download className="h-4 w-4" />
                ダウンロードしてインストール
              </button>
            </div>
          )}

          {(updateState.type === "downloading" || updateState.type === "installing") && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-[11px] text-muted">
                <span>
                  {updateState.type === "downloading" ? "ファイルをダウンロード中..." : "インストール中..."}
                </span>
                {updateState.type === "downloading" && updateState.progress >= 0 && (
                  <span className="font-semibold text-text">{updateState.progress}%</span>
                )}
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-active">
                <div
                  className={clsx(
                    "h-full bg-accent rounded-full transition-all duration-300",
                    updateState.type === "installing" || (updateState.type === "downloading" && updateState.progress === -1)
                      ? "w-2/3 animate-pulse"
                      : ""
                  )}
                  style={{
                    width: updateState.type === "downloading" && updateState.progress >= 0 ? `${updateState.progress}%` : undefined
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Danger zone */}
        <button
          type="button"
          id="clear-history-btn"
          onClick={() => {
            if (window.confirm("チャット履歴を消去しますか？この操作は元に戻せません。")) {
              onClearHistory();
            }
          }}
          className="kuno-focus-ring mt-6 flex h-10 w-full items-center justify-center gap-2 rounded-card border border-danger/30 bg-surface text-[12px] font-semibold text-danger shadow-card transition-all duration-200 hover:border-danger hover:bg-red-50 active:scale-[0.99] dark:hover:bg-red-950/30"
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
