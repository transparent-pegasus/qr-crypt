# 環境脅威カタログ

English: [docs/security/environment-threat-catalog.md](../../../security/environment-threat-catalog.md)

QR Cryptと信頼性のある関係を持つ**物理的およびオペレーション環境**技法の正式な一覧。
`.claude/skills/nation-state-security`のレビュー手順は本ファイルを参照し、
その最新性を評価したうえで、重要な変更を脅威モデル、所見、実装、テスト、
および主張へ反映させる。

[threat-model.md](../../../security/threat-model.md)とのスコープ境界：同文書は`T`識別子、
対策、および**アプリケーション**が対処する脅威の残留リスク記述を所有する。
本カタログはアプリケーションの**周囲の環境**に作用する技法
——部屋、操作者、ハードウェア、メディア、およびデバイスが隣接する
ネットワーク——を所有し、アプリケーションがまったく対処できない技法も含む。
本カタログからは新しい`T`識別子を作成しない。アプリケーションで
対処可能と判明したエントリは脅威モデルに昇格し、本カタログから相互参照される。

## エントリの読み方

- **Relationship（関係性）** — なぜこの技法が*本システム*に具体的に関わるか。
  これがないエントリは本カタログに属さない。
- **Evidence（証拠）** — 3 つのラベルのいずれか。`Evidence`方向へ暗黙に
  格上げしてはならない。
  - `Evidence` — 日付のある公開出典、リポジトリ内の計測、または本リポジトリの
    他所にすでに記録された挙動により実現可能性が裏付けられている。
  - `Observed` — プラットフォームまたは設計の直接観測可能な性質であり、
    研究成果ではなく定義的であるため引用すべき出典が存在しない。
    `Evidence`を無理に広げる代わりにこちらを用いる。引用が必要なのに
    それを欠くエントリは`Observed`ではない。
  - `Speculation` — 本スタックに対してもっともらしいが未計測。
- **Position（位置づけ）** — レビュースキルに基づく制御分類：
  `REPOSITORY_IMPLEMENTABLE`、`DEPLOYMENT_ENFORCED`、`EXTERNAL_ASSURANCE`、
  または`ARCHITECTURAL_RESIDUAL`。
- **Touches（関連項目）** — そのエントリが制約する脅威モデルの行または文書。

深刻度はエントリごとには再掲しない。それはレビューが作成する所見に属し、
そこで帰結と実現可能性が個別に記録される。

## 最新性

- 2026-09-07にE1〜E12の出典と適用可能性を評価し、2026-08-14のレビューを更新した。
  特定の配備やデバイスの安全性を認証するものではない。
- E5はUSENIX 2026の最終論文に基づく記述へ置換した。ML-KEM-768の結果は
  シミュレーションであり、ネイティブ実験はML-KEM-512を使用する。どちらも
  QR CryptのJS ML-KEM-1024スタックに対する攻撃計測ではない。
- E1は汎用リポジトリへの旧リダイレクトに代えて著者公開論文を使用する。
  E3のvan Eck原論文は今回取得できず、Kuhnの論文が機構の根拠となる。
  E4の2004年論文は一次資料の要旨を読み、全文は取得していない。
  E7の特定できない「2013年の開示」という主張は削除した。
- E8には個別の一次実証例を記載し、E9ではHTTPへの干渉と認証済みHTTPSを区別した。
  E10には2026-07-16のサニタイズFAQを追加した。E11は完全なアイデンティティ比較と
  実際の信頼判断を記録し、E12はセンチネル限定の境界とRoute A §7の手順4を示す。
- この評価から新しい技法の追加や`T`行への昇格は正当化されない。
  E8/T21の正当な対称転送に残る送信者制御可能な277ビットの下限は変わらない。
  出典取得と実機計測の不足は下記に残す。あらゆる攻撃を網羅した探索ではない。
- `.claude/skills/freshness/targets.yaml`の`environment-threats`に登録済み。
  アプリとリリースの統合検証は未了であり、ユニット全体が合格するまで以前の
  `last_checked`を維持する。実機および手順の有効性は未計測である。

---

## E1 — 表示されたQRの光学的キャプチャ

**Relationship（関係性）。** 鍵QR（`OCK2`）、公開バンドル（`OCI2`）、暗号文フレームは
光学転送のために表示される。十分な視線と解像度を持つカメラは、操作者の視野外の
角度からも、ソフトウェア侵害やアプリから見える痕跡なしに取得できる場合がある。

**Evidence（証拠）。** 読み取れる画面の直接撮影は`Observed`。
間接光路については`Evidence`：Backes, Dürmuth, Unruh,
[*Compromising Reflections*（2008）](https://kodu.ut.ee/~unruh/publications/reflections.pdf)、
Backes et al.,
[*Tempest in a Teapot*（2009）](https://www.mia.uni-saarland.de/Publications/backes-sp09.pdf)。
反射からの復元を扱うが、このスマートフォン・画面での距離や解像度の限界は未計測。

**Position（位置づけ）。** 表示は`ARCHITECTURAL_RESIDUAL`、視線・窓の遮蔽・カメラの
排除は`DEPLOYMENT_ENFORCED`。アプリが寄与するのは機密表示の警告と出力確認のみ。

**Touches（関連項目）。** threat-model T3, T19, 非目標6。

## E2 — アプリケーション自身のカメラによる環境キャプチャ

**Relationship（関係性）。** ユーザー起動のスキャン中、QR周囲の書類、画面、人が
撮影され得る。QR CryptはQRだけが取得されるというプライバシー境界を提供しない。

**Evidence（証拠）。** カメラフレームに周囲の画素が含まれることは`Observed`。
[W3C Media Capture and Streams草案（2025-10-09）](https://www.w3.org/TR/2025/CRD-mediacapture-streams-20251009/)
には切り抜き・拡縮の制約があるが、センサーやプラットフォームが周囲を一度も取得
しなかった証明にはならない。カメラ停止はアプリの制御であり、実機での停止時間と
部屋の保護効果は別々の未計測事項である。

**Position（位置づけ）。** スキャン場所は`DEPLOYMENT_ENFORCED`、撮影時間を制限する
ティアダウンは`REPOSITORY_IMPLEMENTABLE`。

**Touches（関連項目）。** threat-model T12, T19, 非目標2/3。

## E3 — 画面の電磁放射（TEMPEST / ファンエック放射）

**Relationship（関係性）。** 表示された対称鍵QRが復元されれば鍵が漏洩する。
コントラストと誤り訂正は復号に役立ち得るが、受信機の実現可能性、距離、
スマートフォンの放射特性を示すものではない。

**Evidence（証拠）。** 一般的な機構は`Evidence`：van Eck,
*Electromagnetic Radiation from Video Display Units*（1985）、Kuhn,
[*Electromagnetic Eavesdropping Risks of Flat-Panel Displays*（2004）](https://www.cl.cam.ac.uk/~mgk25/pet2004-fpd.pdf)。
2026-09-07にはvan Eckの原論文を再取得できず、Kuhnが調べた画面・ケーブルの
機構を根拠とする。現代のスマートフォンOLEDから所定距離でQRを復元することは
`Speculation`であり、ここに計測はなく、研究対象の画面とも異なる。

**Position（位置づけ）。** 遮蔽、距離、施設選択は`EXTERNAL_ASSURANCE`。
引用された実証からアプリの耐性は導けない。

**Touches（関連項目）。** threat-model 非目標1/5。耐性を主張する`T`行はない。

## E4 — 平文入力時の音響および機械的放射

**Relationship（関係性）。** 平文入力は暗号化に先行するため、入力の観測は
メッセージの暗号を迂回し得る。

**Evidence（証拠）。** 物理キーボードについては`Evidence`：Asonov & Agrawal,
[*Keyboard Acoustic Emanations*（一次要旨、2004-08-16）](https://research.ibm.com/publications/keyboard-acoustic-emanations)、
Zhuang, Zhou, Tygar,
[*Keyboard Acoustic Emanations Revisited*（2005）](https://www.cs.cornell.edu/~shmat/courses/cs6431/zhuang.pdf)、
Harrison, Toreini, Mehrnezhad,
[*A Practical Deep Learning-Based Acoustic Side Channel Attack on Keyboards*（投稿2023-08-02）](https://arxiv.org/abs/2308.01074)。
2023年の研究はスマートフォン・Zoom録音からノートPCのキーを分類し、スマートフォンの
タッチ入力を扱わない。ここで想定するタッチ入力は`Speculation`であり、相対的な弱さや
モーションセンサー変種は未計測。2004年の全文は今回取得していない。

**Position（位置づけ）。** 操作者のオンライン端末を含む録音機器を平文入力場所から
排除することは`DEPLOYMENT_ENFORCED`。

**Touches（関連項目）。** threat-model 非目標2、資産行「平文」。

## E5 — 暗号実装に対する物理的サイドチャネル

**Relationship（関係性）。** ML-KEM-1024の脱カプセル化とML-DSA-87の署名は
JavaScriptで実行される。採用した
[Noble 0.7.1のセキュリティ記述](https://github.com/paulmillr/noble-post-quantum/blob/0.7.1/README.md#security)
は、暗黙棄却を含めJS/JITでの定数時間実行を保証しない。
[security-review.md](../../../security/security-review.md) §1のバッファ消去改善は、
タイミング・電力・EM漏洩やGC・ネイティブコピーを制限する保証ではない。

**Evidence（証拠）。** 格子KEM実装への一般的な攻撃は`Evidence`：Ravi et al.,
[*Generic Side-channel attacks on CCA-secure lattice-based PKE and KEMs*（2020-06-19）](https://tches.iacr.org/index.php/TCHES/article/view/8592)。
Guo, Nabokov, Johanssonの
[USENIX Security 2026論文](https://www.usenix.org/conference/usenixsecurity26/presentation/guo-qian)
（[最終PDF](https://www.usenix.org/system/files/usenixsecurity26-guo-qian.pdf)）は、
**ML-KEM-768のシミュレーション**でオラクル精度95%、2,950クエリの結果を報告する。
**ネイティブGoFetch実験はML-KEM-512**、Apple M1/macOS 13.5を使用し、別アドレス
空間の非特権コードとネイティブの高精度時計を前提とする。100回中73回で回復鍵の
ハミング距離が4以下となり、これを論文の成功定義とする。ブラウザサンドボックスの
制約は明示的に対象外。QR Cryptについては`Speculation`であり、そのML-KEM-1024
JavaScript・ブラウザ・実機構成への攻撃計測は提示も試行もされていない。

**Position（位置づけ）。** `EXTERNAL_ASSURANCE`。対象を定めたレビューとタイミング・
電力・EM計測では、ハードウェア、ファームウェア、OS・ブラウザ、ビルド、処理内容、
攻撃者のアクセス、統計的限界を記録する必要がある。一般的な監査や処理速度の
ベンチマークだけでは実際のスタックの漏洩限界を示せず、独立レビューの未了は残る。

**Touches（関連項目）。** security-review §1、threat-model T14、サイドチャネルの禁止主張。

## E6 — セッション間のオフラインデバイスの管理

**Relationship（関係性）。** 常時オフラインのデバイスは、監視されない時間にも鍵を
保持し得る。短い物理アクセスでもブートやファームウェアが標的となる。QR Cryptは
その層を認証できず、侵害を修復できない。

**Evidence（証拠）。** 研究対象のシステムについては`Evidence`：Rutkowska,
[*Evil Maid goes after TrueCrypt!*（2009-10-15）](https://blog.invisiblethings.org/2009/10/15/evil-maid-goes-after-truecrypt.html)、ESET,
[*LoJax*（2018-09-27、Secure Boot訂正2018-10-09）](https://www.welivesecurity.com/2018/09/27/lojax-first-uefi-rootkit-found-wild-courtesy-sednit-group/)。
ブート改ざんとファームウェアの永続化を裏付けるが、あらゆるスマートフォンへの攻撃や
プラットフォーム監視の不在を意味しない。特定の配備へのアクセス確率は`Speculation`で
あり、ここにその確率を制限する計測はない。

**Position（位置づけ）。** 管理、改ざん証跡、保管は`DEPLOYMENT_ENFORCED`。
アプリのブート・ワイプゲートは侵害された下位層の信頼を回復しない。

**Touches（関連項目）。** threat-model 非目標1/5、T17。

## E7 — 公認された越境手段としてのリムーバブルメディア

**Relationship（関係性）。** Route Aはアーカイブをオフライン端末へ運び、明示的な
T11出力もメディアで持ち出せる。この橋渡しには、見えるファイルだけでなく
コントローラ・ファームウェアの挙動も含まれる。

**Evidence（証拠）。** `Evidence`：SRLabs,
[*BadUSB / USB peripherals that turn evil*（2014-07-31）](https://srlabs.de/blog/usb-peripherals-turn)
は、ファイルシステム検査の外にある再プログラム可能なコントローラを説明する。
特定できない「2013年の開示」は検証済み根拠として残さない。

**Position（位置づけ）。** `DEPLOYMENT_ENFORCED`。認証済みZIPや正常なファイル
システムはコントローラを認証しない。Route A §7では信頼できる転送と管理を要求し、
**この脅威モデルを満たせないメディアや転送は拒否する**。本カタログは特定の媒体を
承認するものではない。

**Touches（関連項目）。** install-route-a/README.md §7、threat-model T11、非目標4。

## E8 — 侵害済みオフラインデバイスからのエアギャップ秘密チャネル

**Relationship（関係性）。** プラットフォーム侵害後、T21の正規QR出力だけが出口では
ない。他の放射源へのアクセスは機器と権限次第であり、QR構文を狭めても総漏洩量を
制限できない。

**Evidence（証拠）。** 異なるネイティブホストでの実証は`Evidence`：
[AirHopper（2014-11-02）](https://arxiv.org/abs/1411.0237)、
[BitWhisper（2015-03-26）](https://arxiv.org/abs/1503.07919)、
[LED-it-GO（2017-02-22）](https://arxiv.org/abs/1702.06715)、
[MAGNETO（2018-02-07）](https://arxiv.org/abs/1802.02317)、
[MOSQUITO（2018-03-09）](https://arxiv.org/abs/1803.03422)。
無線、熱、LED、磁気、音声の経路はそれぞれ異なる能力と受信機を必要とする。
このPWAから各放射源へのアクセスは`Speculation`であり実機計測はない。
あらゆる電話が制御可能なファン、無線機、HDDのLEDを備えるわけではない。

**Position（位置づけ）。** `ARCHITECTURAL_RESIDUAL`。QR、クリップボード、PNG、ZIP、
リムーバブルメディア経由の正規出力による漏洩とT21の277ビット下限は残る。
メディアで運ぶ出力はリレーパーサーを全く通らない。

**Touches（関連項目）。** threat-model T21, T17、install-route-a/README.md §1。

## E9 — オンラインリレー使用場所での敵対的ネットワーク

**Relationship（関係性）。** リレーは意図的にオンラインであり、破壊的な到達性判定は
同一オリジンのセンチネル本文一致に依存する。敵対的なネットワークは配送を妨害できるが、
通常のアクセスポイント支配だけで認証済みHTTPSを書き換えることはできず、追加の信頼・
プラットフォーム侵害が必要となる。

**Evidence（証拠）。** `Evidence`：リポジトリ内のT18はセンチネル通過を到達可能と扱う。
[RFC 8952（2020-11）](https://www.rfc-editor.org/rfc/rfc8952)はキャプティブポータルの
構成と認証済みTLSの扱いを記述する。HTTPの傍受と認証済みHTTPSは別のケースであり、
本文一致は物理的エアギャップや応答ヘッダー適合の証明ではない。

**Position（位置づけ）。** ネットワーク選択は`DEPLOYMENT_ENFORCED`、表示用と
破壊的プローブの分離は`REPOSITORY_IMPLEMENTABLE`。

**Touches（関連項目）。** threat-model T18, T19。

## E10 — メディアのサニタイゼーションと廃棄

**Relationship（関係性）。** ワイプは論理削除とVault鍵の破棄を試みる。
フラッシュ変換、ウェアレベリング、予備ブロックには旧データが残り得るため、
退役とオンライン時ワイプには別途媒体の保証が必要となる。

**Evidence（証拠）。** `Evidence`：
[NIST SP 800-88 Rev. 2（2025-09-26）](https://csrc.nist.gov/pubs/sp/800/88/r2/final)
はRev. 1を置換し、
[FAQ（2026-07-16）](https://csrc.nist.gov/files/pubs/sp/800/88/r2/final/docs/sp800-88r2-faq.pdf)
はサニタイズプログラムの指針と個別技法の規格を区別する。ブラウザ削除とVault鍵破棄の
試行はNISTの暗号学的消去を実証しない。過去の平文、全鍵コピー、実装、媒体特性、
および検証が重要である。

**Position（位置づけ）。** 媒体に応じたサニタイズと検証済み廃棄は`EXTERNAL_ASSURANCE`。
引用だけで特定の物理破壊法を承認することはできない。

**Touches（関連項目）。** threat-model §5「更新パスなし」、T17。

## E11 — 操作者の状態

**Relationship（関係性）。** 人物の紐付けは、独立したチャネルを介した意図した相手との
手動比較に依存する。Route Aのリビルドや警告の受け入れも操作者次第である。
疲労、強要、時間的圧力、攻撃者が支配する比較チャネルはこれらの手順を破り得る。

**Evidence（証拠）。** 2026-09-07のアプリ実装記録
（[security-review.md](../../../security/security-review.md) §1.4）による`Evidence`：
`formatFingerprint`は小文字16進数の64桁すべてを4桁ずつ、一つの表示に出す。
インポートと保存済み鍵の確認では、複合アイデンティティの完全なダイジェストが
正式な比較対象であり、完全なKEM・署名鍵ハッシュは補足である。確認済みとして
保存するには、独立したチャネルで意図した相手と全桁を比較した旨の確認が必要。
**未確認のまま保存**は別の選択肢であり、未確認バンドルは暗号化の宛先にできない。
その保存鍵に対する署名は、人物の紐付けを主張せず検証できる。対称鍵インポートも
全桁比較を要求するが信頼状態は保存しない。統合ツリー上の独立した回帰検証は未了。

**Position（位置づけ）。** 表示と信頼状態ゲートは`REPOSITORY_IMPLEMENTABLE`、比較手順は
`EXTERNAL_ASSURANCE`。チェックボックスや閉じられないダイアログは、比較が行われた
証明にも、疲労・強要・チャネルの信頼性に対する限界の保証にもならない。

**Touches（関連項目）。** threat-model T6, T15, T21, T22, T23、
install-route-a/README.md §§2–5/7。

## E12 — Route Aローカルサーバーの配信設定

**Relationship（関係性）。** ヘッダー、MIME、SPAフォールバック、センチネルのキャッシュは
実際のローカルサーバーの属性である。署名済みアーカイブは、そのサーバーが`_headers`を
解釈し、意図したポリシーを送ることを保証しない。

**Evidence（証拠）。** 2026-09-07のソースレビューによる`Evidence`：
[Cloudflareのヘッダー形式](https://developers.cloudflare.com/pages/configuration/headers/)
はホスト依存であり、[CSPのmeta配信](https://w3c.github.io/webappsec-csp/#meta-element)
では全応答ヘッダー制御を配信できない。参照サーバーと共有パーサーが実装するのは
本リポジトリの規則であり、Cloudflare言語全体ではない。

**Position（位置づけ）。** `DEPLOYMENT_ENFORCED`。アプリはセンチネル応答について
`/*`の7ヘッダー値、`Cache-Control: no-store`、MIME、ステータス、リダイレクト、URLを
検査し、判定を永続化して、不合格または不在ならRouterのマウントを拒否する。
これは既存の制御であり、新しいナビゲーション検証ではない。

**Residual（残余）。** 期待ポリシーは同じチェックアウトの`public/_headers`から導出され、
独立に導入されたセキュリティ下限ではない。センチネル合格は、実際のナビゲーションや
任意のスクリプト・スタイル・WASM・Service Worker応答、ブラウザでの強制を証明しない。
Route Aでは、選んだサーバーでこれらの実応答、キャッシュ・MIME規則、SPA処理、
メソッド制限、パス封じ込めを別のチェッカーで確認する必要がある。
参照サーバーでのリリーステストは別の証拠であり、その義務を免除しない。

**Touches（関連項目）。** threat-model §2, T18、boot-and-reset-v2.md §2.2、
[install-route-a/README.md](../develop/install-route-a/README.md) §7、手順4。

---

## 含めなかった項目とその理由

- ML-KEM/ML-DSAまたはAES-GCMの暗号解析：環境技法ではない。
  暗号スイートの選択と監査ブロッカーに属する。
- 一般的なマルウェア、OS侵害、画面録画：脅威モデルの非目標 1～3に
  すでに明示されている。本カタログはそれらを再掲しない。
- ブラウザホスト型エアギャップPWAとの信頼できる関係性を持たない技法
  （例えばデプロイメントが使用しないハイパーバイザーを必要とする攻撃）：
  意図的に除外。追加する場合は関係性を明記すること。
