# KunoChat ローカルビルド＆実機デプロイガイド

KunoChat (Tauri v2 + React) をローカル環境でビルドし、実機向けパッケージ（macOS: `.dmg` / `.app`, Windows: `.msi` / `.exe`）を作成するためのセットアップおよび実行手順です。

---

## 1. 共通の必須要件

どのプラットフォームでも、以下のツールが事前にインストールされている必要があります。

1. **Node.js** (v18以上、推奨 v20 LTS)
   - インストール確認: `node -v`
2. **Rust & Cargo** (最新の stable ツールチェーン)
   - 公式のインストーラー [rustup.rs](https://rustup.rs/) から導入します。
   - インストール確認: `cargo --version`

---

## 2. macOS でのビルド手順

### 必須の前提ツール
macOS では C++ コンパイラやシステム SDK が必要です。

```bash
# Xcode Command Line Tools のインストール
xcode-select --install
```

### ローカルビルドの実行
プロジェクトのルートディレクトリで以下のコマンドを実行します。

```bash
# 依存パッケージのインストール
npm install

# リリースビルドの実行
npm run tauri build
```

### ビルド生成物
ビルドが成功すると、以下のパスに実行ファイルおよびインストーラーが生成されます。

* **DMG インストーラー**: `src-tauri/target/release/bundle/dmg/KunoChat_<version>_universal.dmg`
* **RAW アプリケーション**: `src-tauri/target/release/bundle/macos/KunoChat.app`

> [!WARNING]
> **macOS での「開発元を検証できない」警告の回避方法**
> Apple Developerアカウントで署名（Code Signing）していないバイナリは、Gatekeeperによってブロックされます。実機で起動する際は、以下のいずれかを行ってください。
> 1. DMGを展開し、アプリを「アプリケーション」フォルダにコピーします。
> 2. アプリケーションフォルダ内の `KunoChat.app` を **右クリックして「開く」を選択** します。
> 3. 確認ダイアログが表示されるので、再度「開く」をクリックします。

---

## 3. Windows でのビルド手順

Windows上でインストーラーを生成するためのセットアップ手順です。

### 必須の前提ツール

1. **Build Tools for Visual Studio 2022**
   - [公式ページ](https://visualstudio.microsoft.com/downloads/) から 「Visual Studio のインストーラー」をダウンロードします。
   - ワークロード選択画面で **「C++ によるデスクトップ開発」** に必ずチェックを入れてインストールします（MSVC コンパイラと Windows SDK が必要です）。
2. **Wix Toolset (v3)** (MSI インストーラー作成用)
   - Tauriのパッケージングで `.msi` を作成する場合に必要です。
   - [WiX Toolset v3 Downloads](https://wixtoolset.org/releases/) からバイナリをダウンロードしてパスを通すか、パッケージマネージャーを使ってインストールします。
     ```powershell
     # winget を使ったインストール例
     winget install WiXToolset.WiXToolset
     ```
3. **NSIS** (EXE インストーラー作成用)
   - [NSIS 公式サイト](https://nsis.sourceforge.io/) からダウンロードしてインストールします。

### ローカルビルドの実行
Windows の PowerShell またはコマンドプロンプトで以下を実行します。

```powershell
# 依存パッケージのインストール
npm install

# リリースビルドの実行
npm run tauri build
```

### ビルド生成物
ビルドが成功すると、以下のパスに生成されます。

* **MSI インストーラー**: `src-tauri\target\release\bundle\msi\KunoChat_<version>_x64_en-US.msi`
* **EXE インストーラー**: `src-tauri\target\release\bundle\nsis\KunoChat_<version>_x64-setup.exe`

---

## 4. GitHub Actions (CI/CD) による自動ビルド

本プロジェクトには、GitHubにコードをプッシュした際、自動的に両プラットフォーム向けのインストーラーをクラウド上でビルドする構成が含まれています。

### 自動ビルドのトリガー手順
1. リポジトリの最新状態をGitHubにプッシュします。
2. `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` のバージョンを一致させ、同じバージョンタグ（例: `v0.3.0`）を作成してプッシュします。
   ```bash
   npm run release:preflight -- --tag v0.3.0
   git tag v0.3.0
   git push origin v0.3.0
   ```
3. GitHubリポジトリの **Actions** タブでビルドの進捗を確認できます。
4. リリースワークフローは先にドラフトを作成し、macOS/Windows双方の成果物と更新メタデータが揃った場合だけ自動公開します。どちらかが失敗した場合、ドラフトは公開されません。

### 無料配布モードとOS警告

通常のGitHub Actionsリリースは、Apple Developer ProgramやWindowsコード署名証明書を必須にしていません。必要な有料サービスなしで `.dmg` / `.app` / `.msi` / `.exe` を作れます。

ただし、OS側の信頼表示は別問題です。Apple Developer ID署名とWindows Authenticode署名を使わない配布物では、macOS GatekeeperやWindows SmartScreenの警告が出る可能性があります。これはKunoChat側の実装では完全には消せません。警告なしに近い一般配布をしたい場合だけ、任意でOSコード署名を追加してください。

Tauriアップデーター用の `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` は有料証明書ではありません。自動更新メタデータの改ざん検証に使うアプリ専用キーです。
