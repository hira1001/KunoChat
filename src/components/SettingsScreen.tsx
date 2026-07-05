import { AlertTriangle, CheckCircle, Download, FolderOpen, Moon, RefreshCw, ShieldOff, Sun, Trash2, X } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { relaunch, exit } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import clsx from "clsx";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { KunoSettings, TrustedPeer } from "../features/chat/messageTypes";
import { platformAdapter, type PlatformInfo } from "../features/native/platformAdapter";
import { BrandMark } from "./BrandMark";

type UpdateState =
  | { type: "idle" }
  | { type: "checking" }
  | { type: "available"; version: string; body?: string; date?: string; updateObj: any }
  | { type: "downloading"; progress: number }
  | { type: "installing" }
  | { type: "upToDate" }
  | { type: "error"; message: string };

type ReleaseAsset = {
  name: string;
  browser_download_url: string;
};

type GitHubRelease = {
  tag_name: string;
  name?: string;
  body?: string;
  draft: boolean;
  prerelease: boolean;
  published_at?: string;
  assets: ReleaseAsset[];
};

type DowngradeState =
  | { type: "idle" }
  | { type: "loading" }
  | { type: "ready"; releases: GitHubRelease[] }
  | { type: "downloading" }
  | { type: "opened"; path?: string }
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
  const [currentVersion, setCurrentVersion] = useState<string>("不明");
  const [platform, setPlatform] = useState<PlatformInfo>();
  const [updateState, setUpdateState] = useState<UpdateState>({ type: "idle" });
  const [downgradeState, setDowngradeState] = useState<DowngradeState>({ type: "idle" });
  const [selectedTag, setSelectedTag] = useState("");
  const trustedPeer = currentTrustedPeer ?? settings.trustedPeer;
  const peerName = currentPeerName ?? settings.peerDisplayName;

  const downgradeReleases = useMemo(() => {
    if (downgradeState.type !== "ready") return [];
    return downgradeState.releases.filter((release) => (currentVersion === "不明" || compareVersions(release.tag_name, currentVersion) < 0) && chooseInstallerAsset(release, platform));
  }, [currentVersion, downgradeState, platform]);

  const selectedRelease = downgradeReleases.find((release) => release.tag_name === selectedTag) ?? downgradeReleases[0];
  const selectedAsset = selectedRelease ? chooseInstallerAsset(selectedRelease, platform) : undefined;

  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(() => setCurrentVersion("不明"));
    platformAdapter.getPlatform().then(setPlatform).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!selectedTag && downgradeReleases[0]) {
      setSelectedTag(downgradeReleases[0].tag_name);
    }
  }, [downgradeReleases, selectedTag]);

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
        window.setTimeout(() => setUpdateState({ type: "idle" }), 4000);
      }
    } catch (error: any) {
      setUpdateState({ type: "error", message: error.message || String(error) });
    }
  }

  async function handleDownloadAndInstall(updateObj: any) {
    setUpdateState({ type: "downloading", progress: 0 });
    try {
      let downloaded = 0;
      let contentLength = 0;
      await updateObj.downloadAndInstall((event: any) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength || 0;
        }
        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setUpdateState({ type: "downloading", progress: contentLength > 0 ? Math.round((downloaded / contentLength) * 100) : -1 });
        }
        if (event.event === "Finished") {
          setUpdateState({ type: "installing" });
        }
      });
      await relaunch();
    } catch (error: any) {
      setUpdateState({ type: "error", message: error.message || String(error) });
    }
  }

  async function handleLoadDowngradeReleases() {
    setDowngradeState({ type: "loading" });
    try {
      const response = await fetch("https://api.github.com/repos/hira1001/KunoChat/releases?per_page=50", {
        headers: { Accept: "application/vnd.github+json" }
      });
      if (!response.ok) {
        throw new Error(`GitHub Releasesを取得できませんでした (${response.status})`);
      }
      const releases = (await response.json()) as GitHubRelease[];
      setDowngradeState({ type: "ready", releases: releases.filter((release) => !release.draft) });
    } catch (error: any) {
      setDowngradeState({ type: "error", message: error.message || String(error) });
    }
  }

  async function handleInstallSelectedRelease() {
    if (!selectedRelease || !selectedAsset) return;
    setDowngradeState({ type: "downloading" });
    try {
      const result = await platformAdapter.downloadAndOpenInstaller({
        url: selectedAsset.browser_download_url,
        fileName: selectedAsset.name
      });
      setDowngradeState({ type: "opened", path: result?.path });
    } catch (error: any) {
      setDowngradeState({ type: "error", message: error.message || String(error) });
    }
  }

  async function handleChangeShortcut() {
    const nextShortcut = window.prompt("新しいショートカットを入力してください。例: CommandOrControl+Shift+Space", settings.shortcut.replace(/\s+/g, ""));
    if (!nextShortcut) return;
    try {
      await platformAdapter.setAppShortcut(nextShortcut);
      onChange({ shortcut: nextShortcut });
    } catch (error: any) {
      window.alert(`ショートカットを登録できませんでした: ${error.message || String(error)}`);
    }
  }

  return (
    <div className="kuno-screen-enter flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden bg-bg">
      <header className="flex h-[48px] min-w-0 shrink-0 items-center gap-2 overflow-hidden border-b border-border bg-bg-glass px-4 backdrop-blur-[20px]">
        <BrandMark className="h-5 w-5" />
        <div className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text">KunoChat</div>
        <button
          type="button"
          id="dark-mode-toggle"
          aria-label={isDark ? "ライトモードに切り替え" : "ダークモードに切り替え"}
          onClick={() => onChange({ theme: isDark ? "light" : "dark" })}
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

      <div className="kuno-scrollbar min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4">
        <div className="text-[20px] font-semibold text-text">設定</div>

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

        <SectionTitle className="mt-5">環境設定</SectionTitle>
        <div className="mt-2 divide-y divide-border overflow-hidden rounded-card border border-border bg-surface shadow-card">
          <Toggle id="toggle-always-on-top" label="常に前面に表示" description="他のウィンドウより前に表示します" checked={settings.alwaysOnTop} onChange={(value) => onChange({ alwaysOnTop: value })} />
          <Toggle id="toggle-launch-at-login" label="ログイン時に起動" description="Windows/Macログイン時に自動起動します" checked={settings.launchAtLogin} onChange={(value) => onChange({ launchAtLogin: value })} />
          <Toggle id="toggle-notifications" label="通知" description="メッセージ受信時にOS通知を表示します" checked={settings.notifications} onChange={(value) => onChange({ notifications: value })} />
          <Toggle id="toggle-sound" label="サウンド" description="送受信時に通知音を再生します" checked={settings.sound} onChange={(value) => onChange({ sound: value })} />
        </div>

        <SectionTitle className="mt-5">ショートカット</SectionTitle>
        <div className="mt-2 flex h-10 min-w-0 items-center overflow-hidden rounded-card border border-border bg-surface text-[12px] shadow-card">
          <div className="min-w-0 flex-1 truncate px-3 font-mono text-text">{settings.shortcut.replace("CommandOrControl", "Cmd/Ctrl")}</div>
          <button
            type="button"
            id="change-shortcut-btn"
            onClick={handleChangeShortcut}
            className="kuno-focus-ring h-full shrink-0 border-l border-border px-3 text-[12px] font-semibold text-accent transition-all duration-150 hover:bg-accent-soft active:scale-95"
          >
            変更
          </button>
        </div>

        <SectionTitle className="mt-5">ペアリング</SectionTitle>
        <div className="mt-2 overflow-hidden rounded-card border border-border bg-surface p-3 shadow-card">
          <div className="flex min-w-0 items-start gap-2.5">
            <ShieldOff className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-text">{trustedPeer ? peerName || "ペア済みデバイス" : "ペア済みデバイスなし"}</div>
              <div className="mt-0.5 break-words text-[11px] leading-4 text-faint">
                {trustedPeer ? "接続済みです。次回からこの相手を選ぶだけで送信できます。" : "一度接続した相手はチャット一覧に残り、次回から選ぶだけで送信できます。"}
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

        <SectionTitle className="mt-5">バージョン管理</SectionTitle>
        <div className="mt-2 overflow-hidden rounded-card border border-border bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[13px] font-semibold text-text">KunoChat</div>
              <div className="mt-0.5 text-[11px] text-faint">現在のバージョン: v{currentVersion}</div>
            </div>
            {updateState.type === "idle" ? (
              <button type="button" id="check-updates-btn" onClick={handleCheckForUpdates} className="kuno-focus-ring flex h-8 items-center gap-1.5 rounded-input bg-accent px-3 text-[12px] font-semibold text-white shadow-sm transition-all duration-150 hover:bg-accent-hover active:scale-95">
                <RefreshCw className="h-3.5 w-3.5" />
                更新確認
              </button>
            ) : null}
          </div>

          <UpdatePanel updateState={updateState} onRetry={handleCheckForUpdates} onInstall={handleDownloadAndInstall} />

          <div className="mt-4 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[13px] font-semibold text-text">ダウングレード</div>
                <div className="mt-0.5 text-[11px] text-faint">過去リリースを選んでインストーラを起動します</div>
              </div>
              {downgradeState.type === "idle" || downgradeState.type === "error" ? (
                <button type="button" id="load-downgrade-releases-btn" onClick={handleLoadDowngradeReleases} className="kuno-focus-ring h-8 rounded-input border border-border px-3 text-[12px] font-semibold text-accent transition-colors hover:bg-accent-soft">
                  Ver取得
                </button>
              ) : null}
            </div>

            {downgradeState.type === "loading" ? <StatusRow icon={<RefreshCw className="h-3.5 w-3.5 animate-spin text-accent" />} text="過去バージョンを取得中..." /> : null}
            {downgradeState.type === "error" ? <StatusRow icon={<AlertTriangle className="h-3.5 w-3.5 text-danger" />} text={downgradeState.message} tone="danger" /> : null}
            {downgradeState.type === "opened" ? (
              <div className="mt-3 rounded-card border border-success/20 bg-green-50 p-3 text-[12px] text-success dark:bg-green-950/20">
                インストーラを起動しました。必要ならKunoChatを終了してインストールを続行してください。
                <button type="button" onClick={() => void exit(0)} className="mt-2 block h-8 rounded-input bg-success px-3 text-[11px] font-semibold text-white">
                  KunoChatを終了
                </button>
              </div>
            ) : null}
            {downgradeState.type === "downloading" ? <StatusRow icon={<Download className="h-3.5 w-3.5 animate-pulse text-accent" />} text="選択したバージョンのインストーラを取得中..." /> : null}
            {downgradeState.type === "ready" ? (
              <div className="mt-3 space-y-2">
                {downgradeReleases.length > 0 ? (
                  <>
                    <select
                      id="downgrade-version-select"
                      value={selectedRelease?.tag_name ?? ""}
                      onChange={(event) => setSelectedTag(event.target.value)}
                      className="kuno-focus-ring h-10 w-full rounded-input border border-border bg-bg px-3 text-[13px] text-text outline-none focus:border-accent"
                    >
                      {downgradeReleases.map((release) => (
                        <option key={release.tag_name} value={release.tag_name}>
                          {release.tag_name} {release.published_at ? `(${new Date(release.published_at).toLocaleDateString()})` : ""}
                        </option>
                      ))}
                    </select>
                    {selectedRelease?.body ? <div className="kuno-scrollbar max-h-20 overflow-y-auto rounded-input bg-bg px-3 py-2 text-[11px] leading-5 text-muted">{selectedRelease.body}</div> : null}
                    <button type="button" id="install-downgrade-btn" disabled={!selectedAsset} onClick={handleInstallSelectedRelease} className="kuno-focus-ring flex h-9 w-full items-center justify-center gap-1.5 rounded-input bg-accent text-[12px] font-semibold text-white shadow-sm transition-all duration-150 enabled:hover:bg-accent-hover enabled:active:scale-95 disabled:bg-surface-active disabled:text-faint">
                      <Download className="h-4 w-4" />
                      選択Verをダウンロードして開く
                    </button>
                  </>
                ) : (
                  <div className="rounded-input border border-dashed border-border px-3 py-3 text-[11px] text-muted">現在より古いインストーラが見つかりませんでした。</div>
                )}
              </div>
            ) : null}
          </div>
        </div>

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

function UpdatePanel({ updateState, onRetry, onInstall }: { updateState: UpdateState; onRetry: () => void; onInstall: (updateObj: any) => void }) {
  if (updateState.type === "checking") return <StatusRow icon={<RefreshCw className="h-3.5 w-3.5 animate-spin text-accent" />} text="アップデートを確認中..." />;
  if (updateState.type === "upToDate") return <StatusRow icon={<CheckCircle className="h-3.5 w-3.5 text-success" />} text="最新バージョンです。" tone="success" />;
  if (updateState.type === "error") {
    return (
      <div className="mt-3">
        <StatusRow icon={<AlertTriangle className="h-3.5 w-3.5 text-danger" />} text={updateState.message || "アップデートを確認できませんでした。"} tone="danger" />
        <button type="button" onClick={onRetry} className="mt-2 text-[11px] font-semibold text-accent hover:underline">
          再試行
        </button>
      </div>
    );
  }
  if (updateState.type === "available") {
    return (
      <div className="mt-3 rounded-card border border-accent/20 bg-accent-soft p-3">
        <div className="text-[13px] font-semibold text-accent">新バージョン v{updateState.version} が利用可能です</div>
        {updateState.date ? <div className="mt-0.5 text-[10px] text-faint">リリース日: {updateState.date}</div> : null}
        {updateState.body ? <div className="kuno-scrollbar mt-2 max-h-[80px] overflow-y-auto rounded bg-surface/50 p-2 text-[11px] leading-relaxed text-muted">{updateState.body}</div> : null}
        <button type="button" id="install-update-btn" onClick={() => onInstall(updateState.updateObj)} className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-input bg-accent text-[12px] font-semibold text-white shadow-sm transition-all duration-150 hover:bg-accent-hover active:scale-95">
          <Download className="h-4 w-4" />
          ダウンロードしてインストール
        </button>
      </div>
    );
  }
  if (updateState.type === "downloading" || updateState.type === "installing") {
    return (
      <div className="mt-3">
        <div className="flex items-center justify-between text-[11px] text-muted">
          <span>{updateState.type === "downloading" ? "ファイルをダウンロード中..." : "インストール中..."}</span>
          {updateState.type === "downloading" && updateState.progress >= 0 ? <span className="font-semibold text-text">{updateState.progress}%</span> : null}
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-active">
          <div
            className={clsx("h-full rounded-full bg-accent transition-all duration-300", updateState.type === "installing" || (updateState.type === "downloading" && updateState.progress === -1) ? "w-2/3 animate-pulse" : "")}
            style={{ width: updateState.type === "downloading" && updateState.progress >= 0 ? `${updateState.progress}%` : undefined }}
          />
        </div>
      </div>
    );
  }
  return null;
}

function StatusRow({ icon, text, tone = "muted" }: { icon: ReactNode; text: string; tone?: "muted" | "success" | "danger" }) {
  return (
    <div className={clsx("mt-3 flex items-center gap-2 text-[12px]", tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-muted")}>
      {icon}
      <span className="min-w-0 break-words">{text}</span>
    </div>
  );
}

function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("text-[11px] font-semibold uppercase tracking-[0.07em] text-faint", className)}>{children}</div>;
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
        {description ? <div className="mt-0.5 truncate text-[11px] text-faint">{description}</div> : null}
      </div>
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="peer sr-only" />
      <span className={clsx("relative h-[22px] w-[38px] shrink-0 rounded-full transition-all duration-200", checked ? "bg-accent shadow-[0_0_0_1px_var(--accent)]" : "bg-surface-active shadow-[0_0_0_1px_var(--border)]")}>
        <span className={clsx("absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-200", checked ? "left-[18px]" : "left-[3px]")} />
      </span>
    </label>
  );
}

function chooseInstallerAsset(release: GitHubRelease, platform: PlatformInfo | undefined): ReleaseAsset | undefined {
  const assets = release.assets ?? [];
  const platformName = platform?.platform;
  if (platformName === "windows") {
    return assets.find((asset) => /\.(msi|exe)$/i.test(asset.name));
  }
  if (platformName === "macos") {
    return assets.find((asset) => /\.dmg$/i.test(asset.name));
  }
  if (platformName === "linux") {
    return assets.find((asset) => /\.(AppImage|deb)$/i.test(asset.name));
  }
  return assets.find((asset) => /\.(msi|exe|dmg|AppImage|deb)$/i.test(asset.name));
}

function compareVersions(left: string, right: string): number {
  const leftParts = normalizeVersion(left);
  const rightParts = normalizeVersion(right);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function normalizeVersion(version: string): number[] {
  return version.replace(/^v/i, "").split(/[.-]/).map((part) => Number.parseInt(part, 10)).filter((part) => Number.isFinite(part));
}
