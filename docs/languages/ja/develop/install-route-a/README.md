# インストール方法A：署名付きZIP

English: [docs/develop/install-route-a/README.md](../../../../develop/install-route-a/README.md)

高保証オフラインインストールの完全な手順。アーカイブ内の `INSTALL.txt` は、オフラインデバイスに届く自己完結型のコピーである。独立検証のためには、認証済みソースコミットにあるこのドキュメントのコピーが正本となる。アーカイブの手順をこのドキュメントと照合し、要件が追加・省略・弱体化・その他変更されている場合は改竄の兆候として扱うこと。現行のリリースワークフローは `INSTALL.txt` をバージョン管理されたソースからではなくインラインのヒアドキュメントから生成しているため、当該メンバーはまだバイト単位で再現できない。このオープンな制限事項は §5 およびセキュリティレビューに記載されている。

## 1. 適用範囲

方法A は高保証用途に適した唯一の方法である。オフラインデバイスがライブアプリのオリジンに一切接触しないようにする。信頼できるコンピュータ上で署名済みの静的 ZIP を検証し、オフラインデバイスに持ち込み、予約済みポート上の `127.0.0.1` から配信する。

方法B は受信者が実行可能な完全性チェックを提供しない。オリジン、TLS、または CDN を制御する攻撃者は、特定のデバイスに対して改変されたバンドルを配信でき、Service Worker がそれを永続化する。その後オフラインにしても改変は元に戻らない。改竄されたビルドは RNG を弱体化させ、ロードされた公開鍵を差し替え、暗号文に見せかけたデータに平文を埋め込み、ユーザーに通常の `OCF2:` フレームとしてそれを持ち出させることができる。この隠密搬出シナリオは [docs/security/threat-model.md](../../../../security/threat-model.md) の **T21** である。**T19** はリレーの仕組み（OCF2 の外部ヘッダフィルタと OCM1 の構造的正規性チェック、オンラインホップでのアセンブリや AEAD の不在、フレーム由来または OCM1 由来のアプリ永続化の不在）のみを対象としており、インストールの完全性は対象外である。

## 2. 独立に認証された入力 — 必須

ZIP、その署名バンドル、`SHA256SUMS`、リリースページ、転送メディア、およびこのドキュメントは、検証が成功するまで信頼できないものとして扱うこと。以下のすべてを、ダウンロードとは独立したチャネルを通じて独立に入手・認証すること：

- 認証済みの Cosign バージョンおよびバイナリ
- 現行の Sigstore 信頼ルート（`trusted_root.json`）
- 証明書アイデンティティ（ワークフローアイデンティティ）
- OIDC 発行者
- リポジトリ
- ref
- ワークフロートリガー
- 意図されたリリースタグ
- 完全なソースコミット

期待されるポリシー値を検証対象のメディアからコピーしてはならない。同一メディア上のチェックサムや信頼ルートは独立したトラストアンカーではない。キーレス署名はアイデンティティとダイジェストを Sigstore の透明性ログに公開する。

## 3. リリースの検証 — 必須

信頼するコンピュータ上で、3つのリリースアセットを取得する：`qr-crypt-…-static-install.zip` アーカイブ、その `.sigstore.json` バンドル、および `SHA256SUMS`。これらが格納されたディレクトリから、独立に入手したポリシーに基づいてシェル変数を設定し（このドキュメントやダウンロード内のリテラルからではなく）、検証する：

```bash
cosign verify-blob "$QR_CRYPT_ARCHIVE" \
  --bundle "$QR_CRYPT_BUNDLE" \
  --trusted-root /independently/provisioned/trusted_root.json \
  --certificate-identity "$QR_CRYPT_TRUSTED_WORKFLOW_IDENTITY" \
  --certificate-oidc-issuer "$QR_CRYPT_TRUSTED_OIDC_ISSUER" \
  --certificate-github-workflow-repository "$QR_CRYPT_TRUSTED_REPOSITORY" \
  --certificate-github-workflow-ref "$QR_CRYPT_TRUSTED_REF" \
  --certificate-github-workflow-sha "$QR_CRYPT_EXPECTED_SOURCE_SHA" \
  --certificate-github-workflow-trigger "$QR_CRYPT_TRUSTED_TRIGGER"

sha256sum -c SHA256SUMS
```

検証が完了した後にのみ、アーカイブに表示されたソースコミットおよびタグを、独立に認証された意図された値と照合してよい。署名は ZIP を認証する。リムーバブルメディア、ファームウェア、オペレーティングシステム、ブラウザ、またはローカルサーバーの安全性を保証するものではない。

## 4. 展開前のアーカイブコンテナの検証 — 必須

有効な署名はバイト列の公開者を証明するが、敵対的な ZIP の解析や展開を安全にするものではない。この手順が検出対象とする CI 侵害攻撃者は、正しく署名された悪意あるコンテナを公開できる。

展開前に、リリースとは独立に取得・認証されたアーカイブリーダーを使って、セントラルディレクトリおよびローカルエントリヘッダを検査すること。以下のチェックがすべて通過しない限り ZIP を拒否すること：

- すべてのメンバーが、独立に認証されたリリースタグから導出される名前を持つ、ただ1つの期待されるルートディレクトリの配下にあること。絶対パス、ドライブ修飾パス、UNC、空のパスコンポーネント、`.`、`..` パスコンポーネント、およびバックスラッシュその他の代替セパレータを拒否すること。
- メンバー名がセパレータ正規化、Unicode 正規化、および大文字小文字の折りたたみの後に一意かつ曖昧性がないこと。ローカル／セントラルヘッダ間の重複名、大文字小文字のみが異なるエイリアス、末尾のドット／スペースによるエイリアス、およびヘッダ間の不一致を拒否すること。
- すべてのペイロードエントリが通常ファイルまたは期待されるディレクトリであること。シンボリックリンク、ハードリンク、デバイス、FIFO、ソケット、スパース／特殊ファイル、および外部属性やモードが宣言された型と一致しないエントリを拒否すること。
- エントリ数、各宣言サイズおよび展開後ファイルサイズ、ならびに合計展開サイズが、独立に認証された期待ビルドレイアウトからアーカイブを読み取る前に選定した保守的な制限値以内であること。整数オーバーフロー、重複エントリ、暗号化エントリ、サポートされていない圧縮方式、および不審な圧縮率を拒否すること。
- ルートレイアウトが、期待されるアプリケーションツリーに `INSTALL.txt` と `SHA256SUMS.files` を加えたもののみを含むこと。ルートの横や外にメンバーが存在してはならない。

すべてのチェックに合格した後にのみ、リンク不使用・トラバーサル安全な仕組みで展開すること。展開先は新しい空のルートの配下であることを再検証し、展開中も同一の件数・サイズ制限を適用すること。これは秘密情報、クレデンシャル、機密マウント、ネットワークアクセスのない使い捨ての隔離環境で行うこと。展開ルートはソースチェックアウトの外に置くこと。アーカイブが作成したリンクをたどる仕組みで展開してはならない。

## 5. 独立したリビルドと照合 — 必須

独立した照合は、`INSTALL.txt` と `SHA256SUMS.files` を含む**すべての**アーカイブメンバーを対象としなければならない。`sha256sum -c SHA256SUMS.files` の実行だけでは、攻撃者が管理するマニフェストが攻撃者が管理するアーカイブと自己整合的であることを証明するに過ぎず、ソースとの対応関係を確立するものではない。

1. 独立に認証されたソースコミットでクリーンなチェックアウトを用意する。§4 で検証・安全に展開されたルートを使用すること。展開されたアーカイブやコピー・陳腐化したビルドツリーをチェックアウト配下に置いてはならない。Tailwind はプロジェクトツリーをスキャンするため、そのような残余物が生成 CSS を変更し、偽の不一致を引き起こす可能性がある。

```bash
set -euo pipefail
export QR_CRYPT_SOURCE_SHA=<independently-authenticated-full-source-commit>
export QR_CRYPT_CHECKOUT=/absolute/path/to/clean-checkout
export QR_CRYPT_ARCHIVE_ROOT=/absolute/path/outside-checkout/<extracted-root>
test "$(git -C "$QR_CRYPT_CHECKOUT" rev-parse HEAD)" = \
  "$QR_CRYPT_SOURCE_SHA"
test -z "$(git -C "$QR_CRYPT_CHECKOUT" status \
  --porcelain --untracked-files=all)"
```

2. `mise.toml` で固定された Node および aube のバージョンをインストール・使用し、認証済みコミットをビルドアイデンティティとしてビルドする：

```bash
(
  cd "$QR_CRYPT_CHECKOUT"
  mise install
  mise exec -- aube ci
  VITE_BUILD_SHA="$QR_CRYPT_SOURCE_SHA" \
    mise exec -- aube run build:prod
)
```

3. アプリケーションペイロードの全ファイルセットとすべてのペイロードバイトを比較する。`about/` やその他のアーカイブペイロードメンバーを除外してはならない：

```bash
export QR_CRYPT_COMPARE_TMP="$(mktemp -d)"
(
  cd "$QR_CRYPT_CHECKOUT/dist"
  find . -type f -printf '%P\n' |
    LC_ALL=C sort
) > "$QR_CRYPT_COMPARE_TMP/rebuilt.files"
(
  cd "$QR_CRYPT_ARCHIVE_ROOT"
  find . -type f \
    ! -path './INSTALL.txt' \
    ! -path './SHA256SUMS.files' \
    -printf '%P\n' |
    LC_ALL=C sort
) > "$QR_CRYPT_COMPARE_TMP/archive-payload.files"
diff -u "$QR_CRYPT_COMPARE_TMP/rebuilt.files" \
  "$QR_CRYPT_COMPARE_TMP/archive-payload.files"
(
  cd "$QR_CRYPT_CHECKOUT/dist"
  while IFS= read -r file; do
    sha256sum -- "$file"
  done < "$QR_CRYPT_COMPARE_TMP/rebuilt.files"
) > "$QR_CRYPT_COMPARE_TMP/rebuilt.sha256"
(
  cd "$QR_CRYPT_ARCHIVE_ROOT"
  while IFS= read -r file; do
    sha256sum -- "$file"
  done < "$QR_CRYPT_COMPARE_TMP/archive-payload.files"
) > "$QR_CRYPT_COMPARE_TMP/archive-payload.sha256"
diff -u "$QR_CRYPT_COMPARE_TMP/rebuilt.sha256" \
  "$QR_CRYPT_COMPARE_TMP/archive-payload.sha256"
```

4. アーカイブの `INSTALL.txt` と、認証済みチェックアウト側の `$QR_CRYPT_CHECKOUT/docs/develop/install-route-a/README.md` を並べて開く。アーカイブに表示されたバージョン、タグ、完全なソースコミットを独立に認証された値と照合する。次に、すべての手順、禁止事項、前提条件、セキュリティ上の仮定、およびサーバー要件をこのドキュメントと比較する。アーカイブは根拠を簡略化してもよく、独立に検証されたリリースメタデータを代入してもよいが、運用上の要件を追加、省略、弱体化、または変更してはならない。特に、§4 の展開前検証、および §7 の監査済み・事前インストール済み・独立に取得されたサーバーを要求しなければならない。いかなる乖離も改竄の兆候である：中止してリリースを拒否すること。アーカイブのコピーをローカルで「修復」してはならない。

5. アーカイブのマニフェストを信頼したり単にチェックするのではなく、`SHA256SUMS.files` をローカルで再生成する。独立にリビルドしたペイロードとステップ 4 に合格した `INSTALL.txt` の正確なバイトから期待ルートを組み立て、ソート済みマニフェストをローカルに生成し、マニフェストのバイトを比較し、最後に完全なルートを比較する。これによりペイロード、`INSTALL.txt`、および `SHA256SUMS.files` が網羅される：

```bash
export QR_CRYPT_REBUILT_ROOT="$QR_CRYPT_COMPARE_TMP/rebuilt-root"
mkdir -p "$QR_CRYPT_REBUILT_ROOT"
cp -a "$QR_CRYPT_CHECKOUT/dist/." "$QR_CRYPT_REBUILT_ROOT/"
cp -- "$QR_CRYPT_ARCHIVE_ROOT/INSTALL.txt" \
  "$QR_CRYPT_REBUILT_ROOT/INSTALL.txt"
(
  cd "$QR_CRYPT_REBUILT_ROOT"
  find . -type f ! -path './SHA256SUMS.files' -printf '%P\0' |
    LC_ALL=C sort -z |
    xargs -0 -r sha256sum
) > "$QR_CRYPT_REBUILT_ROOT/SHA256SUMS.files"
test -s "$QR_CRYPT_REBUILT_ROOT/SHA256SUMS.files"
if grep -Evq \
  '^[0-9a-f]{64}  [A-Za-z0-9._/-]+$' \
  "$QR_CRYPT_REBUILT_ROOT/SHA256SUMS.files"; then
  printf 'locally generated invalid SHA256SUMS.files entry\n' >&2
  exit 1
fi
diff -u "$QR_CRYPT_REBUILT_ROOT/SHA256SUMS.files" \
  "$QR_CRYPT_ARCHIVE_ROOT/SHA256SUMS.files"
diff -qr "$QR_CRYPT_REBUILT_ROOT" "$QR_CRYPT_ARCHIVE_ROOT"
rm -rf -- "$QR_CRYPT_COMPARE_TMP"
```

最後の `diff` は差異なしを報告しなければならない。これは許可されたすべてのメンバーを網羅する。§4 の展開前パス、型、重複名、および展開サイズチェックの代替ではない。

CI ゲートが証明**しない**こと：CI 内ダブルビルドは同一環境での決定論性のみを示すものであり、環境非依存の再現性を示すものではない。Cosign 署名は、当該ワークフローが当該アーティファクトを公開したこと（ワークフローおよびソースコミットの来歴）を証明する。いずれもソースからバイナリへの対応関係を確立するものではない。`INSTALL.txt` は現在リリースワークフロー内で生成されており、バージョン管理されたソースから導出されていないため、現時点では独立にバイト再現できない。ステップ 4 は命令レベルの比較であり、そのレビュー済みバイトを期待ルートにコピーしてもこの残余は除去されない。決定論的ジェネレータまたはテンプレートをバージョン管理されたソースに移行することは、このブランチの範囲外のオープンなリリースパイプライン項目である。これが修正されるまで、認証済みリポジトリドキュメントからの `INSTALL.txt` のいかなる乖離もリリース拒否の根拠となる。残りのペイロードとローカルに再生成されたマニフェストは独立にバイト比較される。

## 6. 推奨プラクティス、INSTALL.txt の範囲外

以下は**推奨**であり必須ではない。`INSTALL.txt` はこれを要求していない。必須として扱うことはアーカイブのコピーと矛盾する。

- 検証およびリビルド・照合の結果を、別途管理された第二の環境（異なるマシン、異なる管理者、独立に入手した Cosign および信頼ルート）で確認する。
- 検証済み ZIP ハッシュ、認証済みソースコミット、およびリビルドに使用したツールチェーンバージョン（`mise.toml` のピンおよび Cosign バージョン）のインストール記録を保管する。

## 7. オフラインデバイスへのデプロイ

1. 検証済みアーカイブをオフラインデバイスに移動する。USB メモリや SD カードなど、何で運ぶにしても、それ自体も信頼できなければならない。ストレージを変更できるものは何でもアプリを変更できる。
2. §4 で生成された、コンテナ検証済み・トラバーサル安全な展開結果のみを使用すること。ZIP は単一のディレクトリを作成する。そのディレクトリがドキュメントルートとなる。
3. `127.0.0.1` のみにバインドされた、**オフラインデバイスに事前インストール済みで、独立した信頼できるプロセスを通じて取得され、監査された静的サーバー**で配信する。「信頼できる」と呼ばれる経路でインストールしただけのサーバーは同等ではない。バンドルされた `_headers` および `_redirects` のセマンティクスを適用しなければならない：セキュリティヘッダ、正しい MIME タイプ、`/index.html` への SPA フォールバック、および到達性センチネルに対する `no-store`。プロダクションビルドは同じ CSP のサポートされている部分をフォールバックとして meta タグにも含んでいるが、`frame-ancestors` はそこでは強制できず、`_headers` レスポンスヘッダを通じてのみ利用可能である。衝突しやすいデフォルト（8000 や 8080 など）ではない、一般的でない固定の高ポートを1つ選び、そのポートを QR Crypt 用に予約すること。
4. 正確な `http://127.0.0.1:PORT` オリジンを開き、アプリがオフライン使用の準備完了を報告するまで待つ。
5. サーバーを停止し、転送メディアを取り外し、ネットワークを物理的に切断し、秘密情報の入力・復元の**前に** QR Crypt がオフラインと報告していることを確認する。インストールサーバー自体のセンチネルは意図的にアプリからそのオリジンを到達可能として扱わせるため、サーバー動作中に秘密情報を入力してはならない。

`file://` で `index.html` を開くことはサポートされていない。LAN アドレスでのプレーン HTTP もサポートされていない。

## 8. オリジンが境界である理由

その正確なホストとポートがセキュリティおよびストレージの境界となる。ブラウザのオリジンはスキーム、ホスト、およびポートのみで決定される。このローカル HTTP デプロイメントには TLS もホスト認証もない。`localhost` と `127.0.0.1` は異なるオリジンであるため、常に `127.0.0.1` を使用すること。

後から同じ host:port で別のページが配信された場合、そのページは保存された鍵と Vault 鍵に対して同一オリジンアクセスを持つ。extractable でない鍵であっても `crypto.subtle` を通じて復号に使用できる。インストール後にポートを変更すると、QR Crypt は保存データにアクセスできない別のオリジンとなる。選択した host:port で他のものを配信してはならず、そのポートを固定に保つこと。
