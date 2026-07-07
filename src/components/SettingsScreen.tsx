import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle,
  Download,
  FolderOpen,
  KeyRound,
  Moon,
  Pin,
  Power,
  RefreshCw,
  ShieldOff,
  Sun,
  Trash2,
  UserRound,
  Volume2,
  X
} from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { exit, relaunch } from "@tauri-apps/plugin-process";
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
  onOpenDiagnostics: () => void;
};

export function SettingsScreen({
  settings,
  currentPeerName,
  currentTrustedPeer,
  onChange,
  onClose,
  onPickSaveFolder,
  onClearHistory,
  onForgetPeer,
  onOpenDiagnostics
}: SettingsScreenProps) {
  const isDark = settings.theme === "dark";
  const [currentVersion, setCurrentVersion] = useState("不明");
  const [platform, setPlatform] = useState<PlatformInfo>();
  const [updateState, setUpdateState] = useState<UpdateState>({ type: "idle" });
  const [downgradeState, setDowngradeState] = useState<DowngradeState>({ type: "idle" });
  const [selectedTag, setSelectedTag] = useState("");
  const trustedPeer = currentTrustedPeer ?? settings.trustedPeer;
  const peerName = currentPeerName ?? settings.peerDisplayName;

  const downgradeReleases = useMemo(() => {
    if (downgradeState.type !== "ready") return [];
    return downgradeState.releases.filter(
      (release) => (currentVersion === "不明" || compareVersions(release.tag_name, currentVersion) < 0) && chooseInstallerAsset(release, platform)
    );
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
      setUpdateState({ type: "error", message: userFacingError(error, "アップデートを確認できませんでした。") });
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
      setUpdateState({ type: "error", message: userFacingError(error, "インストールを開始できませんでした。") });
    }
  }

  async function handleLoadDowngradeReleases() {
    setDowngradeState({ type: "loading" });
    try {
      const response = await fetch("https://api.github.com/repos/hira1001/KunoChat/releases?per_page=50", {
        headers: { Accept: "application/vnd.github+json" }
      });
      if (!response.ok) {
        throw new Error(`GitHub Releases request failed (${response.status})`);
      }
      const releases = (await response.json()) as GitHubRelease[];
      setDowngradeState({ type: "ready", releases: releases.filter((release) => !release.draft) });
    } catch (error: any) {
      setDowngradeState({ type: "error", message: userFacingError(error, "過去バージョンを取得できませんでした。") });
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
      setDowngradeState({ type: "error", message: userFacingError(error, "インストーラを開けませんでした。") });
    }
  }

  async function handleChangeShortcut() {
    const nextShortcut = window.prompt(
      "新しいショートカットを入力してください。例: CommandOrControl+Shift+Space",
      settings.shortcut.replace(/\s+/g, "")
    );
    if (!nextShortcut) return;
    try {
      await platformAdapter.setAppShortcut(nextShortcut);
      onChange({ shortcut: nextShortcut });
    } catch (error: any) {
      window.alert(userFacingError(error, "ショートカットを登録できませんでした。"));
    }
  }

  return (
    <div className="flex h-full w-full min-w-0 max-w-full flex-col overflow-hidden bg-bg">
      <header className="flex h-[52px] min-w-0 shrink-0 items-center gap-2 border-b border-border bg-bg-glass px-4 backdrop-blur-[20px]">
        <BrandMark className="h-6 w-6" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-text">設定</div>
          <div className="truncate text-[10px] text-faint">KunoChat v{currentVersion}</div>
        </div>
        <button
          type="button"
          id="dark-mode-toggle"
          aria-label={isDark ? "ライトモードに切り替え" : "ダークモードに切り替え"}
          onClick={() => onChange({ theme: isDark ? "light" : "dark" })}
          className="kuno-focus-ring grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <button
          type="button"
          id="settings-close-btn"
          aria-label="設定を閉じる"
          onClick={onClose}
          className="kuno-focus-ring grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="kuno-scrollbar min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3">
        <Panel title="基本">
          <div className="px-3 py-3">
            <label className="mb-1.5 block text-[11px] font-medium text-muted" htmlFor="display-name">
              表示名
            </label>
            <input
              id="display-name"
              value={settings.displayName}
              maxLength={32}
              onChange={(event) => onChange({ displayName: event.target.value })}
              className="kuno-focus-ring h-10 w-full rounded-input border border-border bg-bg px-3 text-[13px] text-text outline-none transition-colors placeholder:text-faint focus:border-accent"
            />
          </div>
          <SettingActionRow
            icon={<FolderOpen className="h-4 w-4" />}
            title="保存先"
            description={settings.saveFolder}
            action="変更"
            onClick={onPickSaveFolder}
            id="pick-save-folder-btn"
          />
          <SettingActionRow
            icon={<KeyRound className="h-4 w-4" />}
            title="ショートカット"
            description={settings.shortcut.replace("CommandOrControl", "Cmd/Ctrl")}
            action="変更"
            onClick={handleChangeShortcut}
            id="change-shortcut-btn"
          />
        </Panel>

        <Panel title="動作">
          <Toggle id="toggle-always-on-top" icon={<Pin className="h-4 w-4" />} label="常に前面" description="他のウィンドウより前に表示します" checked={settings.alwaysOnTop} onChange={(value) => onChange({ alwaysOnTop: value })} />
          <Toggle id="toggle-launch-at-login" icon={<Power className="h-4 w-4" />} label="ログイン時に起動" description="PC起動後すぐ使えるようにします" checked={settings.launchAtLogin} onChange={(value) => onChange({ launchAtLogin: value })} />
          <Toggle id="toggle-notifications" icon={<Bell className="h-4 w-4" />} label="通知" description="新着メッセージをOS通知で知らせます" checked={settings.notifications} onChange={(value) => onChange({ notifications: value })} />
          <Toggle id="toggle-sound" icon={<Volume2 className="h-4 w-4" />} label="サウンド" description="送受信時に通知音を鳴らします" checked={settings.sound} onChange={(value) => onChange({ sound: value })} />
        </Panel>

        <Panel title="接続">
          <SettingActionRow
            icon={<Activity className="h-4 w-4" />}
            title="ネットワーク診断"
            description="待受ポート・ファイアウォール・Tailscale・相手への到達性を確認します"
            action="開く"
            onClick={onOpenDiagnostics}
            id="open-diagnostics-btn"
          />
        </Panel>

        <Panel title="ペアリング">
          <div className="flex min-w-0 items-center gap-3 px-3 py-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-hover text-muted">
              {trustedPeer ? <UserRound className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold text-text">{trustedPeer ? peerName || "ペア済みの相手" : "ペア済みの相手なし"}</div>
              <div className="mt-0.5 text-[11px] leading-4 text-muted">
                {trustedPeer ? "次回から相手を選ぶだけで送信できます。" : "一度接続した相手はここに保存されます。"}
              </div>
            </div>
          </div>
          <div className="px-3 pb-3">
            <button
              type="button"
              id="forget-peer-btn"
              onClick={onForgetPeer}
              disabled={!trustedPeer && !peerName}
              className="kuno-focus-ring flex h-9 w-full items-center justify-center gap-2 rounded-input border border-border bg-bg text-[12px] font-semibold text-text transition-colors enabled:hover:border-danger/40 enabled:hover:bg-red-50 enabled:hover:text-danger disabled:cursor-not-allowed disabled:text-faint dark:enabled:hover:bg-red-950/30"
            >
              <ShieldOff className="h-3.5 w-3.5" />
              ペア済み相手を忘れる
            </button>
          </div>
        </Panel>

        <Panel title="バージョン管理">
          <div className="px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-text">KunoChat</div>
                <div className="mt-0.5 text-[11px] text-muted">現在のバージョン v{currentVersion}</div>
              </div>
              {updateState.type === "idle" ? (
                <button
                  type="button"
                  id="check-updates-btn"
                  onClick={handleCheckForUpdates}
                  className="kuno-focus-ring flex h-9 shrink-0 items-center gap-1.5 rounded-input bg-accent px-3 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-accent-hover"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  更新確認
                </button>
              ) : null}
            </div>
            <UpdatePanel updateState={updateState} onRetry={handleCheckForUpdates} onInstall={handleDownloadAndInstall} />
          </div>

          <div className="border-t border-border px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-text">ダウングレード</div>
                <div className="mt-0.5 text-[11px] leading-4 text-muted">戻したいバージョンを選んでインストーラを開きます。</div>
              </div>
              {downgradeState.type === "idle" || downgradeState.type === "error" ? (
                <button
                  type="button"
                  id="load-downgrade-releases-btn"
                  onClick={handleLoadDowngradeReleases}
                  className="kuno-focus-ring h-9 shrink-0 whitespace-nowrap rounded-input border border-border bg-bg px-3 text-[12px] font-semibold text-accent transition-colors hover:bg-accent-soft"
                >
                  Ver一覧
                </button>
              ) : null}
            </div>
            <DowngradePanel
              state={downgradeState}
              releases={downgradeReleases}
              selectedRelease={selectedRelease}
              selectedAsset={selectedAsset}
              selectedTag={selectedTag}
              onSelectTag={setSelectedTag}
              onInstall={handleInstallSelectedRelease}
            />
          </div>
        </Panel>

        <button
          type="button"
          id="clear-history-btn"
          onClick={() => {
            if (window.confirm("チャット履歴を削除しますか？この操作は元に戻せません。")) {
              onClearHistory();
            }
          }}
          className="kuno-focus-ring mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-card border border-danger/25 bg-surface text-[12px] font-semibold text-danger transition-colors hover:bg-red-50 dark:hover:bg-red-950/30"
        >
          <Trash2 className="h-4 w-4" />
          履歴を消去
        </button>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-3 overflow-hidden rounded-card border border-border bg-surface shadow-card">
      <div className="border-b border-border/70 px-3 py-2 text-[11px] font-semibold text-muted">{title}</div>
      <div className="divide-y divide-border/70">{children}</div>
    </section>
  );
}

function SettingActionRow({
  icon,
  title,
  description,
  action,
  id,
  onClick
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action: string;
  id: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      id={id}
      onClick={onClick}
      className="kuno-focus-ring flex min-h-14 w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-hover"
    >
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-hover text-accent">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-text">{title}</div>
        <div className="mt-0.5 truncate text-[11px] text-muted">{description}</div>
      </div>
      <span className="shrink-0 whitespace-nowrap text-[12px] font-semibold text-accent">{action}</span>
    </button>
  );
}

function UpdatePanel({ updateState, onRetry, onInstall }: { updateState: UpdateState; onRetry: () => void; onInstall: (updateObj: any) => void }) {
  if (updateState.type === "checking") return <StatusRow icon={<RefreshCw className="h-3.5 w-3.5 animate-spin" />} text="アップデートを確認中..." />;
  if (updateState.type === "upToDate") return <StatusRow icon={<CheckCircle className="h-3.5 w-3.5" />} text="最新版です。" tone="success" />;
  if (updateState.type === "error") {
    return (
      <div className="mt-3">
        <StatusRow icon={<AlertTriangle className="h-3.5 w-3.5" />} text={updateState.message} tone="danger" />
        <button type="button" onClick={onRetry} className="mt-2 text-[11px] font-semibold text-accent hover:underline">
          再試行
        </button>
      </div>
    );
  }
  if (updateState.type === "available") {
    return (
      <div className="mt-3 rounded-input border border-accent/20 bg-accent-soft p-3">
        <div className="text-[13px] font-semibold text-accent">v{updateState.version} を利用できます</div>
        {updateState.date ? <div className="mt-0.5 text-[10px] text-faint">リリース日: {updateState.date}</div> : null}
        {updateState.body ? <div className="kuno-scrollbar mt-2 max-h-[80px] overflow-y-auto rounded bg-surface/50 p-2 text-[11px] leading-relaxed text-muted">{updateState.body}</div> : null}
        <button type="button" id="install-update-btn" onClick={() => onInstall(updateState.updateObj)} className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-input bg-accent text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-accent-hover">
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

function DowngradePanel({
  state,
  releases,
  selectedRelease,
  selectedAsset,
  selectedTag,
  onSelectTag,
  onInstall
}: {
  state: DowngradeState;
  releases: GitHubRelease[];
  selectedRelease?: GitHubRelease;
  selectedAsset?: ReleaseAsset;
  selectedTag: string;
  onSelectTag: (tag: string) => void;
  onInstall: () => void;
}) {
  if (state.type === "loading") return <StatusRow icon={<RefreshCw className="h-3.5 w-3.5 animate-spin" />} text="過去バージョンを取得中..." />;
  if (state.type === "error") return <StatusRow icon={<AlertTriangle className="h-3.5 w-3.5" />} text={state.message} tone="danger" />;
  if (state.type === "downloading") return <StatusRow icon={<Download className="h-3.5 w-3.5 animate-pulse" />} text="インストーラを取得中..." />;
  if (state.type === "opened") {
    return (
      <div className="mt-3 rounded-input border border-success/20 bg-green-50 p-3 text-[12px] text-success dark:bg-green-950/20">
        インストーラを開きました。必要に応じてKunoChatを終了してインストールを続けてください。
        <button type="button" onClick={() => void exit(0)} className="mt-2 block h-8 rounded-input bg-success px-3 text-[11px] font-semibold text-white">
          KunoChatを終了
        </button>
      </div>
    );
  }
  if (state.type !== "ready") return null;
  if (releases.length === 0) {
    return <div className="mt-3 rounded-input border border-dashed border-border px-3 py-3 text-[11px] text-muted">現在より古いインストーラが見つかりませんでした。</div>;
  }
  return (
    <div className="mt-3 space-y-2">
      <select
        id="downgrade-version-select"
        value={selectedRelease?.tag_name ?? selectedTag}
        onChange={(event) => onSelectTag(event.target.value)}
        className="kuno-focus-ring h-10 w-full rounded-input border border-border bg-bg px-3 text-[13px] text-text outline-none focus:border-accent"
      >
        {releases.map((release) => (
          <option key={release.tag_name} value={release.tag_name}>
            {release.tag_name} {release.published_at ? `(${formatReleaseDate(release.published_at)})` : ""}
          </option>
        ))}
      </select>
      {selectedRelease?.body ? <div className="kuno-scrollbar max-h-20 overflow-y-auto rounded-input bg-bg px-3 py-2 text-[11px] leading-5 text-muted">{selectedRelease.body}</div> : null}
      <button
        type="button"
        id="install-downgrade-btn"
        disabled={!selectedAsset}
        onClick={onInstall}
        className="kuno-focus-ring flex h-9 w-full items-center justify-center gap-1.5 rounded-input bg-accent text-[12px] font-semibold text-white shadow-sm transition-colors enabled:hover:bg-accent-hover disabled:bg-surface-active disabled:text-faint"
      >
        <Download className="h-4 w-4" />
        選択したVerを開く
      </button>
    </div>
  );
}

function StatusRow({ icon, text, tone = "muted" }: { icon: ReactNode; text: string; tone?: "muted" | "success" | "danger" }) {
  return (
    <div className={clsx("mt-3 flex items-center gap-2 text-[12px]", tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-muted")}>
      {icon}
      <span className="min-w-0 break-words">{text}</span>
    </div>
  );
}

type ToggleProps = {
  id: string;
  icon: ReactNode;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

function Toggle({ id, icon, label, description, checked, onChange }: ToggleProps) {
  return (
    <label htmlFor={id} className="flex min-h-14 min-w-0 cursor-default items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-hover">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-hover text-muted">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-text">{label}</div>
        {description ? <div className="mt-0.5 truncate text-[11px] text-muted">{description}</div> : null}
      </div>
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="peer sr-only" />
      <span className={clsx("relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors", checked ? "bg-accent" : "bg-surface-active shadow-[0_0_0_1px_var(--border)]")}>
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

function formatReleaseDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

function userFacingError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/Cannot reach|ECONN|ENOTFOUND|timed out|NetworkError|Failed to fetch|GitHub Releases request failed/i.test(message)) {
    return fallback;
  }
  return message || fallback;
}
