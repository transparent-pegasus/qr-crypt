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
// the same page and tab names the app itself shows.

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
      "seam.body":
        "この線から先は、ネットワークの外。\n越えられるのは、画面に映したQRコードの光だけです。",

      "what.eyebrow": "概要",
      "what.heading": "オフラインで暗号にして、QRコードで運ぶ",
      "what.body":
        "QR Cryptは、ずっとオフラインのまま使う端末で動く小さなアプリです。文章を入力すると暗号をかけ、結果をQRコードとして画面に表示します。普段使いのスマートフォンでそのQRコードを読み取って文字列に変換し、いつものメッセージアプリで送ります。受け取った側は、同じ手順を逆にたどります。元の文章を読めるのは、2台のオフライン端末の中だけ。あいだのスマートフォンが運ぶのは読めない文字だけですが、その大きさや分割数までは外から見えます。",
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
      "install.a.heading": "インストールしてから、ずっとオフラインにする",
      "install.a.body":
        "これからオフラインにする端末のブラウザーでこのサイトを開き、「インストール」または「ホーム画面に追加」を選びます。終わったら、その端末をネットワークから完全に切り離し、二度とつなげないでください。機内モードでは足りません。",
      "install.a.link": "アプリを開く",
      "install.a.qrHint":
        "ずっとオフラインで使う端末で、このQRコードを読み取ってください。",
      "install.b.tag": "方法B",
      "install.b.heading": "記録媒体からZIPで導入する",
      "install.b.body":
        "信頼できるパソコンで署名付きのリリースをダウンロードし、その場で署名とチェックサムを確認します。確認に使う値は、ダウンロードとは別の経路で入手してください。オフライン端末へ移して解凍し、そのフォルダーをローカルのWebサーバーから配信します。index.htmlをファイルとして直接開く方法は使えません。運ぶのに使うUSBメモリーやSDカードも、信頼できるものだけを使ってください。そこに細工できる相手は、アプリも改ざんできます。",
      "install.b.link": "最新リリースを取得",

      "flow.eyebrow": "使い方",
      "flow.heading": "文章が相手に届くまで",
      "flow.lede":
        "手順は全部で6つです。色と位置を見れば、どちらの端末で操作するか分かります。これはML-KEM-1024を使う場合の手順です。",
      "flow.online": "オンライン",
      "flow.onlineSub": "侵害されている前提",
      "flow.offline": "オフライン",
      "flow.offlineSub": "見られるのは自分だけ",
      "flow.page.keys": "鍵ページ",
      "flow.page.encrypt": "暗号・復号ページ",
      "flow.page.relay": "リレーページ",
      "flow.s1.title": "それぞれが自分の鍵を作る",
      "flow.s1.where": "作成タブ",
      "flow.s2.title": "相手の鍵を読み込む",
      "flow.s2.where": "読込タブ",
      "flow.s2.note":
        "この交換は対面で行い、画面に出る指紋を突き合わせてください。その鍵が本人のものかどうかを、アプリは確認できません。",
      "flow.s3.title": "送信者が文章を暗号化する",
      "flow.s3.where": "暗号化タブ",
      "flow.s3.note":
        "暗号化には相手の鍵を使います。署名付きの方式を選んだ場合は、自分の鍵で自分が送ったことを示します。",
      "flow.s4.title": "QRコードを読み取って文字で送る",
      "flow.s4.where": "オンラインモード",
      "flow.s4.cross":
        "オンライン端末で、オフライン端末の画面に出たQRコードを読み取ります。",
      "flow.s5.title": "受け取った人が文字をQRコードに戻す",
      "flow.s5.where": "オンラインモード",
      "flow.s6.title": "受け取った人が復号して読む",
      "flow.s6.where": "復号タブ",
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
        "オフライン端末をオンラインにすると、アプリは保持しているものを消去します",
      "warn.two.body":
        "消えるのはアプリが保存している鍵とデータですが、完全に消えているとは限りません。端末の中からは、あとで取り出せることがあります。絶対に取り出せないようにする必要があるなら、媒体に応じた消去手順（NIST SP 800-88など）を使うか、端末そのものを壊してください。",

      "foot.repo": "GitHubのソースコード",
      "foot.license": "Apache-2.0",
      "foot.noTrackers": "このページは利用者を追跡せず、外部にも接続しません。",
    },
  },
}
