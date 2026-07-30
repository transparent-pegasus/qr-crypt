// Translations for the landing page.
//
// English is NOT listed here: it is the text already written in index.html, and
// about.js captures it from the document on load. That keeps exactly one copy of
// the English wording and makes drift impossible.
//
// To add a language: append one entry below, keyed by its BCP 47 code. The
// switcher, the <html lang> attribute and the document title all follow from it.
// Every key in `strings` must match a data-i18n* attribute in index.html;
// tests/unit/about-page-i18n.test.ts fails the build when the two disagree.
//
// Japanese follows the repo's house style in src/i18n/messages.ts: no manual
// space between Japanese characters and adjacent Latin letters or digits, and
// the same page names the app itself shows.

export const DEFAULT_LOCALE = { code: "en", label: "English" }

export const LOCALES = {
  ja: {
    label: "日本語",
    strings: {
      "meta.title": "QR Crypt — ネットワークの外で暗号化する",
      "meta.description":
        "暗号化と復号を、完全にオフラインの端末上で行うアプリです。メッセージを送るとき、ネットワークを通るのは暗号文だけです。",

      "a11y.skip": "本文へ移動",
      "a11y.language": "言語",
      "a11y.installQr": "qr-crypt.pages.devを開くQRコード",

      "hero.eyebrow": "前提",
      "hero.line1": "一度でもネットワークに接続した端末は、",
      "hero.line2": "すでに侵害されている可能性がある。",
      "hero.answer":
        "だから、暗号化と復号は完全にオフラインの端末で行う。\nメッセージを送るとき、ネットワークに流すのは、鍵がなければ読めない暗号文だけにする。",
      "hero.scroll": "続きを読む",

      "seam.label": "ネットワークの届かない場所",
      "seam.body1": "この境界を越えるのは光だけ——",
      "seam.body2":
        "片方の画面に表示されたQRコードを、もう片方のカメラで読み取る。",

      "what.eyebrow": "概要",
      "what.heading": "オフラインで暗号化し、QRコードで運ぶ",
      "what.body":
        "QR Cryptは、常にオフラインで使う端末上で動作する小さなアプリです。メッセージを入力すると、アプリが暗号化し、暗号文をQRコードとして画面に表示します。普段使いのオンライン端末でそのQRコードを読み取り、文字列に変換して、いつものメッセージアプリで送ります。受信者は同じ手順を逆にたどります。想定どおりに使えば、平文を扱うのは送信者と受信者のオフライン端末だけで、オンライン端末は暗号文を中継するだけです。",
      "what.fact1":
        "アカウント不要。QR Crypt専用の中継サーバー不要。平文や秘密の鍵情報がネットワーク通信に載ることはありません。",
      "what.fact2": "1人につき2台。オフライン用とオンライン用を1台ずつ。",
      "what.fact3":
        "Apache License 2.0で公開されているオープンソースです。独立した監査は受けていません。",

      "locks.eyebrow": "暗号方式",
      "locks.heading": "手軽さか、長期的な機密性か",
      "locks.lede":
        "メッセージをどのくらい長く秘密にしておく必要があるかに応じて選びます。",
      "locks.aes.name": "AES-256",
      "locks.aes.when": "日常のやり取り向け",
      "locks.aes.body":
        "現在広く使われている標準的な暗号方式です。QR Cryptでは、既定でこの方式を使用します。メッセージは1枚のQRコードに収まり、鍵は対面で交換します。",
      "locks.pq.name": "ML-KEM-1024",
      "locks.pq.when": "数十年先まで守りたいとき",
      "locks.pq.body":
        "十分に高性能な量子コンピューターが実用化されると、現在広く使われている公開鍵暗号による鍵交換の多くが破られる可能性があります。ML-KEM-1024は、国家機関レベルの攻撃を含む将来の量子攻撃に備えるための鍵カプセル化方式として使用します。QR Cryptでは、そうした高度な攻撃者に対しても長期的な機密性を必要とするメッセージ向けに採用しています。その代わり、処理量とデータ量が増えるため、メッセージは複数のQRコードに分割されます。",

      "install.eyebrow": "入手",
      "install.heading": "導入方法は2通り",
      "install.a.tag": "方法A",
      "install.a.heading": "署名付きZIPを検証して導入する",
      "install.a.body1":
        "これは既定の導入方法であり、高い保証水準が必要な用途に適するのは、この方法だけです。信頼できるコンピューターで署名付きリリースをダウンロードし、別経路で入手した検証値を使って、署名とチェックサムを確認してください。同じコミットを独立に再ビルドし、成果物に含まれるファイル一式と各ハッシュをリリースと比較してください。Cosignが証明するのは、どのワークフローが成果物を公開したかまでです。ソースコードとバイナリの対応関係までは証明しません。",
      "install.a.body2":
        "アーカイブをオフライン端末へ移して展開し、そのフォルダーを127.0.0.1のみで待ち受ける静的Webサーバーから配信してください。同梱のINSTALL.txtに従い、独立した信頼できる手順で入手し、オフライン端末にあらかじめインストールしておいた監査済みの静的Webサーバーを使用します。さらに、同梱のヘッダーとリダイレクト設定を適用してください。単に「信頼できる」と称する経路からインストールしただけでは、同じ保証は得られません。",
      "install.a.body3":
        "index.htmlをfile:// URLから直接開いてはいけません。この環境ではブラウザーのストレージ分離が機能せず、別のローカルHTMLファイルから鍵を読み取られるおそれがあります。転送に使うUSBメモリーやSDカードも、信頼できるものに限ってください。記録媒体を改変できる攻撃者は、アプリも改ざんできます。詳しい手順はリポジトリのドキュメントにあります。",
      "install.a.link": "最新リリースを取得",
      "install.a.docLink": "導入手順の全文を読む",
      "install.a.docUrl": "docs/develop/install-route-a/README.ja.md",
      "install.a.docHref":
        "https://github.com/transparent-pegasus/qr-crypt/blob/main/docs/develop/install-route-a/README.ja.md",
      "install.b.tag": "方法B",
      "install.b.heading": "インターネット上の配信元からインストールする",
      "install.b.body1":
        "これからオフラインで使う端末でこのサイトを開き、「インストール」または「ホーム画面に追加」を選んだ後、端末をすべてのネットワークから切り離します。この方法には、利用者側で実行できる完全性検証の手段がありません。配信元サーバー、TLS終端、またはCDNを支配する攻撃者は、特定の端末1台だけに改変済みのバンドルを送り、検知を逃れる可能性があります。さらに、Service Workerによって、その改変版が端末に残り続けます。インストール後も、アプリはインターネット上の配信元に関連付けられたままです。",
      "install.b.body2":
        "端末が再接続されると、同じ配信元へ到達確認の通信が送信されます。消去処理はその応答を待ってから始まるため、この通信は必ず消去より先に端末外へ出ます。方法Aで使用する配信元は127.0.0.1だけです。専用サーバーを停止し、予約したポートを再利用しなければ、そこには何も待ち受けていません。機内モードだけを根拠に端末を信頼しないでください。",
      "install.b.link": "アプリを開く",
      "install.b.qrHint":
        "ずっとオフラインで使う端末で、このQRコードを読み取ってください。",

      "flow.eyebrow": "使い方",
      "flow.heading": "文章が相手に届くまで",
      "flow.lede":
        "以下の6つの手順を通じて、平文はどちらのオフライン端末からも外へ出ません。境界を越えるのは、暗号文と運搬に必要な付帯情報だけです。方式によって異なるのは鍵の交換方法です。共通鍵方式では、一方向に読み取るだけで済みます。ポスト量子ID方式では、署名を使う場合、または双方向にメッセージをやり取りする場合に、双方が相手の公開鍵を読み取る必要があります。以下では、ポスト量子ID方式の流れを示します。",
      "flow.online": "オンライン",
      "flow.onlineSub": "侵害されている前提",
      "flow.offline": "オフライン",
      "flow.offlineSub": "平文を扱う場所",
      "flow.page.keys": "鍵ページ",
      "flow.page.encrypt": "暗号化ページ",
      "flow.page.decrypt": "復号ページ",
      "flow.page.relay": "リレーページ",
      "flow.s1.title": "それぞれが自分の鍵を作る",
      "flow.s1.where": "作成ダイアログ",
      "flow.s2.title": "相手の鍵を読み込む",
      "flow.s2.where": "読込ダイアログ",
      "flow.s2.note":
        "鍵は対面で交換し、画面に表示される指紋（フィンガープリント）を照合してください。その鍵が意図した相手本人のものかどうかを、アプリ自身が確認することはできません。",
      "flow.s3.title": "送信者が文章を暗号化する",
      "flow.s3.where": "暗号化ページ",
      "flow.s3.note":
        "相手の鍵でメッセージを暗号化します。署名付きの方式を選んだ場合は、自分の鍵で署名し、送信者であることを示します。",
      "flow.s4.title": "QRコードを読み取り、文字列として送る",
      "flow.s4.where": "オンラインモード",
      "flow.s4.cross":
        "オンライン端末で、オフライン端末の画面に出たQRコードを読み取ります。",
      "flow.s5.title": "受信者が文字列をQRコードに戻す",
      "flow.s5.where": "オンラインモード",
      "flow.s6.title": "受信者が復号して読む",
      "flow.s6.where": "復号ページ",
      "flow.s6.cross":
        "オフライン端末で、オンライン端末の画面に出たQRコードを読み取ります。",
      "flow.s6.note": "復号されたメッセージは、この端末の外へ出ません。",

      "warn.eyebrow": "注意",
      "warn.heading": "利用前に必ずお読みください",
      "warn.one.title":
        "一度でもネットワークに接続した端末は、完全には信用できません",
      "warn.one.body":
        "機内モードは画面上の設定にすぎず、通信が止まっている保証にはなりません。侵害された端末上のソフトウェアは、実際には接続されていても、オフラインに見せかけることができます。導入が終わったら、端末をすべてのネットワークから恒久的に切り離し、二度と接続しないでください。",
      "warn.two.title":
        "オフライン端末がオンラインになると、アプリは保存データの消去を試みます",
      "warn.two.body":
        "アプリは保存している鍵とデータの削除を試み、失敗した手順があれば通知します。ただし、論理的に削除しても、物理的に消去されたとは限りません。記録媒体には復元可能な痕跡が残ることがあります。データを復元困難な状態にする必要がある場合は、記録媒体に適した方法（NIST SP 800-88 Rev. 2など）でストレージをサニタイズするか、端末を物理的に破壊してください。",

      "foot.repo": "GitHubのソースコード",
      "foot.license": "Apache-2.0",
      "foot.noTrackers":
        "このページにはトラッキング機能がなく、外部サービスのリソースも読み込みません。",
    },
  },
}
