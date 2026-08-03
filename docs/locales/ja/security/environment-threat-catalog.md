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

- カタログ作成 2026-08-03；同日付でエントリをレビュー。
- `.claude/skills/freshness/targets.yaml`に登録（ユニット
  `environment-threats`）。スイープは日付付き出典を再検証し、
  信頼できる関係性を獲得した技法を追加し、変更内容を記録する。
- 引用する外部出典には日付を付す。置き換えられた出典は蓄積せず置換する。

---

## E1 — 表示されたQRの光学的キャプチャ

**Relationship（関係性）。** QR表示こそが転送メカニズムそのものである。
すべての鍵QR（`OCK2`）、公開バンドル（`OCI2`）、および暗号文フレームは、
操作者から見えない角度を含め、レンズを持つあらゆるものが読み取れる画面上に
レンダリングされる。これは本システムに対する最も直接的な環境技法であり、
ソフトウェアの侵害を必要とせず、デバイス上に痕跡を残さない。

**Evidence（証拠）。** 直接撮影については`Observed` — レンダリングされたQRは
レンズを持つあらゆるものが読み取れる。それこそが転送メカニズムたる所以である。
間接的な光路については`Evidence`：Backes, Dürmuth, Unruh, *Compromising Reflections — or How to Read
LCD Monitors Around the Corner*, IEEE S&P 2008; Backes et al., *Tempest in a
Teapot: Compromising Reflections Revisited*, IEEE S&P 2009
（眼鏡、ティーポット、および目の反射からの離れた距離での復元）。

**Position（位置づけ）。** ディスプレイ自体については`ARCHITECTURAL_RESIDUAL`；
部屋（視線、窓の覆い、カメラなし）については`DEPLOYMENT_ENFORCED`。
アプリケーションが寄与するのは、機密表示の警告と
エクスポート前の強確認ゲートのみ。

**Touches（関連項目）。** threat-model T3, T19, 非目標6。

## E2 — アプリケーション自身のカメラによる環境キャプチャ

**Relationship（関係性）。** スキャンはユーザー起動であるが、実行中カメラは
QRの背後にあるもの——机上の書類、他の画面、部屋にいる人——すべてを捉える。
デバイスは自身の視野を狭めることができず、操作者はコードを見ており
フレーム端を見ていない。

**Evidence（証拠）。** `Observed` — カメラは目の前のフレームを返し、
`getUserMedia`は視野の制限手段を公開していない。研究成果ではなく定義的であり、
引用すべきものも計測すべきものも存在しない。

**Position（位置づけ）。** `DEPLOYMENT_ENFORCED`（スキャンを行う場所）に加え、
カメラが稼動する*時間*を制限するアプリ内のティアダウン。

**Touches（関連項目）。** threat-model T12, T19, 非目標 2/3。

## E3 — 画面の電磁放射（TEMPEST / ファンエック放射）

**Relationship（関係性）。** QRは高コントラストで誤り訂正付きの
自己区切り画像であり、部分的な画面復元にとって最良の標的となる。
誤り訂正がまさにそのチャネルが生じる劣化を修復するためである。
この方法で復元された対称鍵QRは、デバイスへの近接なしに完全な鍵漏洩となる。

**Evidence（証拠）。** メカニズムについてはEvidence：van Eck,
*Electromagnetic Radiation from Video Display Units*, Computers & Security,
1985; Kuhn, *Electromagnetic Eavesdropping Risks of Flat-Panel Displays*,
PETS 2004（ノートPCのLCDを含むデジタルフラットパネルが離れた距離から
読み取り可能であること）。本スタックについてはSpeculation：
最新のスマートフォンOLEDからの所定距離でのQR復元に関する計測は存在せず、
スマートフォンのパネルはこれらの論文が特性評価したディスプレイとは異なる。

**Position（位置づけ）。** `EXTERNAL_ASSURANCE`（シールド、距離、施設の選択）。
アプリケーションはこれを軽減できない——QRのレンダリングこそが機能である。

**Touches（関連項目）。** threat-model 非目標 1/5 の境界；
`T`行は耐性を主張しておらず、計測なしに追加してはならない。

## E4 — 平文入力時の音響および機械的放射

**Relationship（関係性）。** 平文は暗号化前にオフラインデバイス上で入力される。
音響チャネルはメッセージがメッセージになる前にそれを捕捉するため、
すべての暗号制御を迂回する。

**Evidence（証拠）。** Evidence: Asonov & Agrawal, *Keyboard Acoustic
Emanations*, IEEE S&P 2004; Zhuang, Zhou, Tygar, *Keyboard Acoustic Emanations
Revisited*, CCS 2005; Harrison, Toreini, Mehrnezhad,
*A Practical Deep Learning-Based Acoustic Side Channel Attack on Keyboards*,
EuroS&PW 2023（スマートフォンのマイクおよびビデオ通話録音によるノートPC
キーボードの解析）。本スタックについてはSpeculation：
タッチスクリーンのソフトキーボード入力がここで想定される入力方式であり、
機械式キーボードに比べ音響標的としてはより弱い。同じアイデアの
モーションセンサー変種は存在するが、本システムでは未計測。

**Position（位置づけ）。** `DEPLOYMENT_ENFORCED`（オフラインデバイスの近くに、
操作者自身のスマートフォンを含め、録音機器を置かない）。

**Touches（関連項目）。** threat-model 非目標 2；資産行「平文」。

## E5 — 暗号実装に対する物理的サイドチャネル

**Relationship（関係性）。** ML-KEMの脱カプセル化とML-DSAの署名は、
消費者向けデバイス上のJavaScriptで実行される。`@noble/post-quantum`は
JS/JITの下では定数時間実行が保証されないことを文書化しており、
ML-KEMの暗黙棄却パスが明示的に名指しされている。タイミング、電力、
およびEMチャネルは、これを鍵回復に転じる古典的な手段である。

**Evidence（証拠）。** CCA安全な格子KEM実装に対する一般的なクラスについて
`Evidence`：Ravi, Roy, Chattopadhyay, Bhasin, *Generic Side-channel attacks
on CCA-secure lattice-based PKE and KEMs*, IACR TCHES 2020(3)。
実装上の注意事項自体についてはリポジトリ内の記録として`Evidence`
（`@noble/post-quantum`ドキュメント、
[security-review.md](../../../security/security-review.md) §1に記録）。
本システムについては`Speculation`：このJSスタックでこのハードウェア上での
鍵回復攻撃は実証されておらず、ここでは試行もされていない。

**Position（位置づけ）。** `EXTERNAL_ASSURANCE` — 独立監査がこれを制限する
メカニズムとなる。`release-approved`ブロッカーを参照。

**Touches（関連項目）。** security-review.md §1 サイドチャネル記述；
threat-model T14 残留リスク。禁止主張ルールにより、
絶対的なサイドチャネル主張はすでに禁じられている。

## E6 — セッション間のオフラインデバイスの管理

**Relationship（関係性）。** 運用モデルは再接続しない専用デバイスであり、
つまりその稼働時間の大部分は無人のまま鍵を保持している。
これはまさにevil-maidやインプラント技法が必要とする条件であり、
ネットワーク接続された標的と異なり、デバイス上には変更を監視するものがない。

**Evidence（証拠）。** クラスとしては`Evidence`：Rutkowska, *Evil Maid goes
after TrueCrypt!*, Invisible Things Lab, 2009年10月（暗号化ノートPCに対する
無人でのブートパス改ざん）；ESET, *LoJax: First UEFI rootkit found in the
wild*, 2018年9月（ディスク交換後も残存するファームウェアレベルの永続化）。
特定の個人設置への蔓延については`Speculation` — その種の攻撃者が
1台のデバイスに到達する確率を制限する計測はここに存在しない。

**Position（位置づけ）。** `DEPLOYMENT_ENFORCED`（管理、改ざん証跡、保管）——
アプリケーションのワイプおよびブートゲートは、その下のプラットフォームが
侵害された場合には耐えられない。

**Touches（関連項目）。** threat-model 非目標 1 および 5；T17 残留リスク
（「事前に実行されたコードに対しては防御できない」）。

## E7 — 公認された越境手段としてのリムーバブルメディア

**Relationship（関係性）。** ルートAは、ネットワーク接続してはならない
デバイスへZIPを物理メディアで運ぶことを要求し、
[threat-model.md](../../../security/threat-model.md) T11のダウンロード制御によりファイルが
同じ方法で外に出ることを許す。したがってメディアは双方向のブリッジであり、
そのコントローラ（ファイルシステムではなくファームウェア）は
両端から信頼されている。

**Evidence（証拠）。** Evidence: Nohl & Lell, *BadUSB — On Accessories that
Turn Evil*, Black Hat USA 2014（再プログラム可能なUSBコントローラ
ファームウェア；ファイルシステムスキャンでは検出不可能）。
出荷ハードウェアの妨害が国家的手法であることについてもEvidence
（2013年の開示）。

**Position（位置づけ）。** `DEPLOYMENT_ENFORCED`。ルートA §7はすでに、
アーカイブを運ぶものは信頼できなければならないと述べている。
本カタログは、クリーンに見えるファイルシステムがその保証にならない*理由*を記録する。

**Touches（関連項目）。** install-route-a/README.md §7；threat-model T11, 非目標 4。

## E8 — 侵害済みオフラインデバイスからのエアギャップ秘密チャネル

**Relationship（関係性）。** T21は、侵害されたオフラインエンドポイントが
ユーザーが運ぶQRパスを通じて情報を漏洩できることを確立している。
本エントリは、QRパスが唯一の出口ではないことを記録する。
同じ侵害されたエンドポイントは画面の輝度、LED、スピーカー、ファン、
および無線機を制御する。したがって、QRチャネルを閉じたり狭めたりしても
全体の漏洩量を制限することにはならない——この議論は脅威モデルが
決してしてはならないものである。

**Evidence（証拠）。** 多数の実証済み技法についてEvidence
（Guriらはエアギャップされたホストに対する光学的、音響的、熱的、
磁気的、およびRF変種を2014年以降公表している）。
本スタックについてはSpeculation：これらの実証はホスト上のネイティブコードを
前提としており、ブラウザサンドボックス内のPWAはこれらのエミッタへの
到達範囲がはるかに小さく、ここでは計測が存在しない。

**Position（位置づけ）。** `ARCHITECTURAL_RESIDUAL` — プラットフォームまたは
インストールが侵害された場合、アプリケーションの制御外（非目標 1 および 4）。

**Touches（関連項目）。** threat-model T21, T17；install-route-a/README.md §1
（ルートAが保証を決定する理由）。

## E9 — オンラインリレー使用場所での敵対的ネットワーク

**Relationship（関係性）。** リレーデバイスは意図的にオンラインであり、
ワイプ判定は同一オリジンのセンチネルボディの一致に依存する。
応答を書き換えたりリプレイしたりするネットワーク——キャプティブポータル、
敵対的アクセスポイント——はコードの属性ではなく、
*リレーデバイスが使用される場所*の環境属性である。

**Evidence（証拠）。** Evidence: T18はすでにキャプティブポータル通過の
ケースを到達可能と同等として記録している。HTTPレスポンスを変更する
キャプティブポータルは通常の観測される動作である。

**Position（位置づけ）。** `DEPLOYMENT_ENFORCED`（ネットワークの選択）、
表示プローブと破壊的プローブの分離をアプリ内の制限制御とする。

**Touches（関連項目）。** threat-model T18, T19。

## E10 — メディアのサニタイゼーションと廃棄

**Relationship（関係性）。** ワイプパスは明示的にベストエフォートの
論理削除とVaultキー破棄である。フラッシュ変換レイヤー、ウェアレベリング、
およびオーバープロビジョニングされたブロックにより、物理メディアは
アプリケーションが削除したと信じるものを保持し得る。
これはデバイスの退役時および`wipe-on-online`イベント後に問題となる。

**Evidence（証拠）。** Evidence: NIST SP 800-88 Rev. 1,
*Guidelines for Media Sanitization*
（フラッシュメディアに対するクリア/パージ/破壊の区別）。
[threat-model.md](../../../security/threat-model.md) §5ですでに引用済み。

**Position（位置づけ）。** `EXTERNAL_ASSURANCE`（メディアに適切な
サニタイゼーションまたは物理的破壊）。

**Touches（関連項目）。** threat-model §5「更新パスなし」、T17 残留リスク。

## E11 — 操作者の状態

**Relationship（関係性）。** セキュリティ上重要なステップは手動であり、
デバイスによる検証が不可能である：帯域外のフィンガープリント比較
（システム内で唯一の人物紐付け）、ルートAのリビルドと比較、
および表示された警告を受け入れる判断。疲労、時間的圧力、強要、
および攻撃者が提供する「比較チャネル」は、コードの一バイトにも
触れることなくこれらを無効化する。

**Evidence（証拠）。** 本リポジトリ内のEvidence：脅威モデルは、
アプリケーションがユーザーが意図した相手と比較したことを確認できない
ことをすでに述べている（T6）。また、不可視文字スキャンは明示的に
検出補助であり、その価値はアラートが読まれる程度に稀であることに依存する（T21）。

**Position（位置づけ）。** 手順については`EXTERNAL_ASSURANCE`；
インターフェース変更により負荷を軽減できる場合のみ
`REPOSITORY_IMPLEMENTABLE` —— 例えば、まさにこの理由で存在する
意図的に非解除型のフィンガープリント確認。

**Touches（関連項目）。** threat-model T6, T15, T21, T22；
install-route-a/README.md §5–§6。

## E12 — Route A ローカルサーバーの配信設定

**関係。** Route A では、監査済みの静的サーバーを操作者自身が用意する。セキュリティ
ヘッダー、MIME タイプ、SPA フォールバック、センチネルの `no-store` 規則は、いずれも
署名済みバンドルではなく*そのサーバーの設定*の性質である。ほとんどの静的サーバーは
`_headers` を全く解釈しないため、正しいリリースが CSP 以外の6つのセキュリティ
ヘッダーを欠いたまま配信されうる。

**根拠。** `public/_headers` は一部のサーバーしか解釈しない Cloudflare 形式の
ファイルであり、`docs/develop/install-route-a/README.md` §3 が要件を記録し、
`scripts/serve-dist.mjs` をリファレンス動作として挙げている。

**位置づけ。** `DEPLOYMENT_ENFORCED`。境界を定めるアプリ内統制は deployment
verdict である。Service Worker から除外された唯一の経路である reachability
センチネル応答に対し、`/*` の7ヘッダー、センチネル自身の `Cache-Control: no-store`、
content type、ステータス、リダイレクト状態、応答 URL を検査し、判定を永続化して、
不合格または不在なら Router のマウントを拒否する。

**残余。** 検査対象はセンチネル応答のみである。トップレベルのナビゲーション応答が
同じヘッダーを持つことは証明しないため、経路ごとの設定ミスや敵対的サーバーは通過
しうる。これは設定ミスの検出であって独立した保証ではない。実際のナビゲーション応答、
MIME タイプ、SPA フォールバック、`/sw.js` と `/registerSW.js` のキャッシュヘッダー、
メソッド制限、パス境界を対象とする、独立に導入されたチェッカーが依然として必要である。

**Touches（関連項目）。** threat-model T18、boot-and-reset-v2.md §2.2、
install-route-a/README.md §3。

---

## 含めなかった項目とその理由

- ML-KEM/ML-DSAまたはAES-GCMの暗号解析：環境技法ではない。
  暗号スイートの選択と監査ブロッカーに属する。
- 一般的なマルウェア、OS侵害、画面録画：脅威モデルの非目標 1～3に
  すでに明示されている。本カタログはそれらを再掲しない。
- ブラウザホスト型エアギャップPWAとの信頼できる関係性を持たない技法
  （例えばデプロイメントが使用しないハイパーバイザーを必要とする攻撃）：
  意図的に除外。追加する場合は関係性を明記すること。
