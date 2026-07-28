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
      "meta.title": "QR Crypt — ネットワークの届かない場所で暗号化する",
      "meta.description":
        "暗号化も復号も、完全にオフラインの端末だけで行うアプリ。ネットワークに出るのは、読めない文字列だけです。",

      "a11y.skip": "本文へ移動",
      "a11y.language": "言語",
      "a11y.installQr": "qr-crypt.pages.devを開くQRコード",

      "hero.eyebrow": "前提",
      "hero.line1": "一度でもネットワークに接続した端末は、",
      "hero.line2": "すでに侵害されている可能性がある。",
      "hero.answer":
        "だから、暗号化と復号は完全にオフラインの端末で行う。\nネットワークに出すのは、誰にも読めない文字列だけにする。",
      "hero.scroll": "続きを読む",

      "seam.label": "ここが境目",
      "seam.body1": "この線から先は、ネットワークの外。",
      "seam.body2": "越えられるのは、画面に映したQRコードの光だけです。",

      "what.eyebrow": "概要",
      "what.heading": "オフラインで暗号にして、QRコードで運ぶ",
      "what.body":
        "QR Cryptは、ずっとオフラインのまま使う端末で動く小さなアプリです。文章を入力すると暗号をかけ、結果をQRコードとして画面に表示します。普段使いのスマートフォンでそのQRコードを読み取って文字列に変換し、いつものメッセージアプリで送ります。受け取った側は、同じ手順を逆にたどります。元の文章を読めるのは、2台のオフライン端末の中だけ。中継するオンライン端末が運ぶのは読めない文字だけです。",
      "what.fact1": "アカウントなし。サーバーなし。メッセージも鍵も通信に載りません。",
      "what.fact2": "1人につき2台。オフライン用と、オンライン用。",
      "what.fact3": "オープンソース、Apache-2.0。独立した監査は受けていません。",

      "locks.eyebrow": "暗号方式",
      "locks.heading": "手軽さか、長期間の強度か",
      "locks.lede":
        "どちらを使うかは、その文章をどれだけ長く秘密にしておきたいかで決まります。",
      "locks.aes.name": "AES-256",
      "locks.aes.when": "日常のやり取り向け",
      "locks.aes.body":
        "いま世界中で広く使われている標準的な暗号です。2026年時点で、現実的に破る方法は知られていません。とくに選ばなければ、こちらが使われます。QRコードは1枚で、鍵は対面で手渡します。",
      "locks.pq.name": "ML-KEM-1024",
      "locks.pq.when": "数十年先まで守りたいとき",
      "locks.pq.body":
        "十分な規模の量子コンピューターが現れると、いまの鍵の受け渡し方はいずれ破られます。ML-KEM-1024は、それに耐えるよう設計された方式です。国家レベルの解読能力を持つ相手に対しても、メッセージが長期間読めないままであることが期待されます。そのぶん重く、QRコードは複数枚に分かれます。",

      "install.eyebrow": "入手",
      "install.heading": "導入方法は2通り",
      "install.a.tag": "方法A",
      "install.a.heading": "署名付きZIPを検証して導入する",
      "install.a.body":
        "これは既定の導入方式であり、高保証用途に適した唯一の方式です。信頼できるパソコンで署名付きのリリースをダウンロードし、その場で署名とチェックサムを確認します。確認に使う値は、ダウンロードとは別の経路で入手してください。同じコミットを独立に再ビルドし、成果物のファイル集合とハッシュをリリースと比較してください。Cosignが証明するのはどのワークフローが成果物を公開したかまでで、ソースとバイナリの対応ではありません。オフライン端末へ移して解凍し、そのフォルダーを127.0.0.1だけに向けた静的Webサーバーで配信します。同梱のINSTALL.txtが求めるとおり、監査済みで、オフライン端末にあらかじめインストールされ、独立した信頼できるプロセスで入手した静的Webサーバーを使い、同梱のヘッダーとリダイレクトの設定を適用してください。「信頼できる」と呼ばれる経路でインストールしただけのサーバーは同等ではありません。index.htmlをファイルとして直接開く方法は使えません。その場合ブラウザーの保存領域の分離が働かず、別のローカルHTMLファイルから鍵を読み出せることがあります。運ぶのに使うUSBメモリーやSDカードも、信頼できるものだけを使ってください。そこに細工できる相手は、アプリも改ざんできます。完全な手順はリポジトリのdocs/develop/install-route-a.mdにあります。",
      "install.a.link": "最新リリースを取得",
      "install.b.tag": "方法B",
      "install.b.heading": "生きた配信元からインストールする",
      "install.b.body":
        "これからオフラインにする端末でこのサイトを開き、「インストール」または「ホーム画面に追加」を選んでから、すべてのネットワークから切り離します。この方式には、受け取った側が実行できる完全性検証がありません。配信元、TLS、CDNのいずれかを掌握した攻撃者は、標的にした1台だけへ検出されずに改変バンドルを配信でき、Service Workerが改変物を永続化します。端末はその生きたオリジンも保持し続けます。再接続すると同一オリジンへ到達性プローブが送られ、wipeはsentinelの応答を待ってから発火するため、ビーコンは必ずwipeより先に出ます。方式Aのオリジンは127.0.0.1だけです。専用サーバーを停止し、予約したポートを再利用しなければ、そこに応答する相手はいません。機内モードだけで端末が信頼できるようになるとは考えないでください。",
      "install.b.link": "アプリを開く",
      "install.b.qrHint":
        "ずっとオフラインで使う端末で、このQRコードを読み取ってください。",

      "flow.eyebrow": "使い方",
      "flow.heading": "文章が相手に届くまで",
      "flow.lede":
        "この6手順のあいだ、読める状態の文章がオフライン端末から出ることはありません。境目を越えるのは暗号文と、その運搬に必要な枠組みの情報だけです。方式で変わるのは鍵の受け渡しで、共通鍵は片方が読み取れば済みます。ポスト量子IDは、署名を付ける場合と双方向にやり取りする場合に、互いの公開鍵を読み取る必要があります。以下はポスト量子IDの場合です。",
      "flow.online": "オンライン",
      "flow.onlineSub": "侵害されている前提",
      "flow.offline": "オフライン",
      "flow.offlineSub": "見られるのは自分だけ",
      "flow.page.keys": "鍵ページ",
      "flow.page.encrypt": "暗号化ページ",
      "flow.page.decrypt": "復号ページ",
      "flow.page.relay": "リレーページ",
      "flow.s1.title": "それぞれが自分の鍵を作る",
      "flow.s1.where": "作成ダイアログ",
      "flow.s2.title": "相手の鍵を読み込む",
      "flow.s2.where": "読込ダイアログ",
      "flow.s2.note":
        "この交換は対面で行い、画面に出る指紋を突き合わせてください。その鍵が本人のものかどうかを、アプリは確認できません。",
      "flow.s3.title": "送信者が文章を暗号化する",
      "flow.s3.where": "暗号化ページ",
      "flow.s3.note":
        "暗号化には相手の鍵を使います。署名付きの方式を選んだ場合は、自分の鍵で自分が送ったことを示します。",
      "flow.s4.title": "QRコードを読み取って文字で送る",
      "flow.s4.where": "オンラインモード",
      "flow.s4.cross":
        "オンライン端末で、オフライン端末の画面に出たQRコードを読み取ります。",
      "flow.s5.title": "受け取った人が文字をQRコードに戻す",
      "flow.s5.where": "オンラインモード",
      "flow.s6.title": "受け取った人が復号して読む",
      "flow.s6.where": "復号ページ",
      "flow.s6.cross":
        "オフライン端末で、オンライン端末の画面に出たQRコードを読み取ります。",
      "flow.s6.note": "読める状態の文章が、この端末から出ることはありません。",

      "warn.eyebrow": "注意",
      "warn.heading": "使いはじめる前に、必ず読んでください",
      "warn.one.title":
        "一度でもネットワークにつないだ端末は、その後もずっと信用できません",
      "warn.one.body":
        "機内モードは画面上の設定にすぎず、通信が止まっている保証にはなりません。侵害された端末は、オフラインのように見せかけることもできます。導入が終わったら、その端末をネットワークから完全に切り離し、そのまま二度とつなげないでください。",
      "warn.two.title":
        "オフライン端末をオンラインにすると、アプリはデータを全て消去します",
      "warn.two.body":
        "消えるのはアプリが保存している鍵とデータですが、完全に消えているとは限りません。消去は最善努力で行われ、途中で失敗した場合はアプリがその旨を表示します。端末の中からは、あとで取り出せることがあります。絶対に取り出せないようにする必要があるなら、媒体に応じた消去手順（NIST SP 800-88など）を使うか、端末そのものを壊してください。",

      "foot.repo": "GitHubのソースコード",
      "foot.license": "Apache-2.0",
      "foot.noTrackers": "このページは利用者を追跡せず、外部にも接続しません。",
    },
  },
}
