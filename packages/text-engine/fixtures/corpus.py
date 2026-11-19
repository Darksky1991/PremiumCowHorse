# 样本语料。每种语言 >= 30 句，运维 / 业务 / 日志场景；句中的 {n} 由生成器替换为不同数字，避免句子逐字重复。
# 注意：为了让 Python 各编解码器与 WHATWG（TextDecoder）一致，日文语料不使用 〜（U+301C）、－、―、∥ 等两边映射不同的字符。

# ---------------------------------------------------------------- 日文（只用 JIS X 0208，无厂商扩展）
JA = [
    "本日{n}時にバッチ処理が正常に完了しました。",
    "データベースのバックアップを開始します。",
    "ファイルサーバの空き容量が不足しています。残り{n}GBです。",
    "ご担当者様、お世話になっております。障害対応の件でご連絡いたします。",
    "夜間メンテナンスのため、システムは{n}時から停止いたします。",
    "認証に失敗しました。パスワードを再入力してください。",
    "ジョブネット「月次締め処理」が異常終了しました。",
    "お客様情報の更新は、営業部の承認後に反映されます。",
    "ネットワーク機器の再起動を実施し、通信の復旧を確認しました。",
    "サーバ{n}号機のディスクエラーを検知したため、交換を依頼しました。",
    "本件につきましては、原因調査の上あらためてご報告いたします。",
    "請求書の発行日は毎月末日、支払期限は翌月末日となります。",
    "ログ出力先のディレクトリが存在しないため、処理を中断しました。",
    "リリース作業は無事に終了しました。引き続き監視を継続します。",
    "共有フォルダへのアクセス権限を申請してください。",
    "データ移行の結果、{n}件の不整合が見つかりました。",
    "定期点検の結果、特に異常はありませんでした。",
    "ユーザーアカウントが{n}回連続でロックされました。",
    "仕様変更に伴い、帳票レイアウトを修正する必要があります。",
    "設定ファイルの読み込みに失敗したため、既定値で起動します。",
    "ご不明な点がございましたら、お気軽にお問い合わせください。",
    "メモリ使用率が{n}パーセントを超えたため、警告を通知します。",
    "本番環境への反映は、テスト結果の確認後に実施してください。",
    "監視システムからのアラートを受信し、一次切り分けを開始しました。",
    "受注データの取り込みが完了し、在庫の引当を行いました。",
    "証明書の有効期限が{n}日後に切れます。更新手続きをお願いします。",
    "再現手順を添付いたしますので、ご確認のほどよろしくお願いいたします。",
    "オンラインストレージの利用状況を月次で報告します。",
    "不要になったテスト用ファイルは、担当者の判断で整理してください。",
    "システム障害の影響範囲は、東京リージョンの一部に限られます。",
    "パッチ適用後、サービスの再起動を忘れずに行ってください。",
    "お見積りの有効期限は、発行日より{n}日間です。",
    "プリンタの紙詰まりが発生しています。トレイを確認してください。",
    "この操作は取り消すことができません。よろしいですか。",
]

# 第二水準漢字（JIS X 0208 の 3 区以降、読みの難しい字）を含む文
JA_JIS2 = [
    "取引先との齟齬が生じたため、契約書の文言を再確認しました。",
    "鬱蒼とした森の奥に、古い蔵が静かに佇んでいます。",
    "データの毀損を防ぐため、書込み前に検証を実施します。",
    "稟議書の決裁が滞り、プロジェクトの進行に支障が出ています。",
    "蘇生措置の訓練を兼ねて、防災演習を開催しました。",
    "贖罪の意を込めて、再発防止策を徹底いたします。",
    "憑依したかのように、ログが延々と出力され続けています。",
    "煩雑な手続きを簡素化し、運用の負担を軽減しました。",
    "闇雲に再起動を繰り返しても、根本原因は解消しません。",
    "艶のある画面表示のため、液晶パネルの交換を検討しています。",
    "渦巻き状の依存関係が、循環参照の原因となっていました。",
    "臆することなく、疑問点は早めに質問してください。",
    "嚢胞の検査結果を、健康診断の報告書に記載しました。",
    "誹謗中傷にあたる書込みは、管理者が削除いたします。",
    "鼈甲色の外装を持つ、限定モデルの筐体が届きました。",
    "璧のような完成度を目指して、品質管理を徹底します。",
]

# cp932（Windows-31J）拡張：丸数字・㈱・髙・№ など
JA_CP932 = [
    "①受注確認　②在庫引当　③出荷指示　④請求書発行",
    "㈱山田商事 髙橋様宛ての見積書を送付しました。",
    "管理№{n}の端末は、㈲鈴木工業から借用中です。",
    "手順③のコマンド実行後、結果を㈱東洋システムへ報告してください。",
    "髙島屋向けの納品データ№{n}を、夜間バッチで取り込みます。",
    "㊤の資料は社外秘です。取扱いにご注意ください。",
    "Ⅰ期工事は完了し、Ⅱ期工事の見積りを提出しました。",
    "テナント№{n} 髙田ビル 3F 納期は⑤営業日以内です。",
    "㈱ABC商事／㈲ＸＹＺ工業の取引先マスタを更新しました。",
    "温度は25℃、湿度は㌫表示のため、数値を確認してください。",
    "①～⑩の項目を順に確認し、チェックを入れてください。",
    "㎏・㎡・㎝ の単位変換表を、帳票の末尾に追加しました。",
]

# 半角片仮名（日本の旧システムのログ・帳票でよく見る）
JA_HW = [
    "ﾊﾞｯｸｱｯﾌﾟ ｶｲｼ",
    "ﾊﾞｯｸｱｯﾌﾟ ｼｭｳﾘｮｳ",
    "ｴﾗｰ ｺｰﾄﾞ=E{n}",
    "ﾌｧｲﾙ ｺﾋﾟｰ ｶﾝﾘｮｳ",
    "ｼﾞｮﾌﾞ ｲｼﾞｮｳ ｼｭｳﾘｮｳ",
    "ﾃﾞｰﾀ ﾄﾘｺﾐ {n}ｹﾝ ｶﾝﾘｮｳ",
    "ｼｽﾃﾑ ｷﾄﾞｳ ｼﾏｼﾀ",
    "ｾﾂｿﾞｸ ﾀｲﾑｱｳﾄ",
    "ﾕｰｻﾞｰ ﾆﾝｼｮｳ ｼｯﾊﾟｲ",
    "ｷｬｯｼｭ ｸﾘｱ ｼﾞｯｺｳ",
    "ﾃｽﾄ ﾃﾞｰﾀ ｻｸｼﾞｮ",
    "ｺﾞｳｷｰ ｼｮﾘ ﾁｭｳﾀﾞﾝ",
    "ﾌﾟﾘﾝﾀ ｴﾗｰ ﾍﾟｰﾊﾟｰ ﾂﾞﾏﾘ",
    "ｼｭｯｶ ｼｼﾞ ﾃﾞｰﾀ ｿｳｼﾝ",
    "ｾｯﾃｲ ﾌｧｲﾙ ﾖﾐｺﾐ ｼｯﾊﾟｲ",
    "ﾒﾓﾘ ﾌｿｸ ﾁｭｳｲ",
]
# 半角片仮名と全角日本語の混在
JA_HW_MIXED = [
    "ｴﾗｰ: ファイル「売上一覧.csv」が見つかりません。",
    "ﾊﾞｯﾁ処理 ｼｭｳﾘｮｳ（正常終了）",
    "ﾏｽﾀ更新 ｶﾝﾘｮｳ：{n}件を反映しました。",
    "ﾕｰｻﾞｰ名：ﾔﾏﾀﾞ ﾀﾛｳ（山田 太郎）様",
    "ｼｽﾃﾑ管理者に連絡してください。ﾃﾞｰﾀ破損の可能性があります。",
    "ﾌｧｲﾙ名：請求書_{n}.pdf ｻｲｽﾞ：大",
    "ｱﾗｰﾄ受信 → 担当者へ通知済み（ﾒｰﾙ送信 ｶﾝﾘｮｳ）",
    "ｼﾞｮﾌﾞ「月次締め」が異常終了しました ｺｰﾄﾞ=E{n}",
    "ﾊﾞｯｸｱｯﾌﾟ先：共有サーバ ﾃﾞｨｽｸ空き容量 {n}GB",
    "ﾃｽﾄ環境のﾃﾞｰﾀを本番へ反映しないでください。",
]

# ---------------------------------------------------------------- 简体中文
ZH_CN = [
    "今天凌晨{n}点数据库备份已经顺利完成。",
    "服务器磁盘空间不足，剩余容量仅有{n}GB。",
    "请各位同事在下班前提交本周的工作日报。",
    "用户登录失败，请检查用户名和密码是否正确。",
    "夜间维护期间，系统将于{n}点暂停服务，敬请谅解。",
    "接口调用超时，已自动重试{n}次，仍然没有返回结果。",
    "本次发布包含三个缺陷修复和两项性能优化。",
    "网络设备重启之后，通信状态已经恢复正常。",
    "客户资料的修改需要销售部门经理审批后才能生效。",
    "监控系统发出告警，运维人员正在进行初步排查。",
    "配置文件读取失败，程序将使用默认参数启动。",
    "订单数据导入完成，库存已经按照订单进行分配。",
    "证书将在{n}天后到期，请及时办理续期手续。",
    "这个操作无法撤销，请确认是否继续执行。",
    "测试环境的数据请不要同步到生产环境。",
    "项目进度略有延迟，主要原因是需求变更频繁。",
    "打印机出现卡纸故障，请检查纸盒并重新放入纸张。",
    "补丁安装完成之后，请务必重新启动相关服务。",
    "日志目录不存在，处理流程已被中断并通知了负责人。",
    "内存使用率超过百分之{n}，系统已经发送预警邮件。",
    "我们将在周五下午召开故障复盘会议，欢迎大家参加。",
    "共享文件夹的访问权限需要提前向管理员申请。",
    "数据迁移结束后，发现了{n}条不一致的记录。",
    "报表的格式根据新的业务规则做了调整，请重新导出。",
    "云端存储的使用情况将按月向财务部门汇报。",
    "定期巡检结果显示，所有机房设备运行平稳。",
    "请把复现步骤和截图一并附上，方便研发同事定位问题。",
    "本次故障的影响范围仅限于华东地区的部分用户。",
    "应用程序在高并发场景下出现了线程阻塞的现象。",
    "报价单自开具之日起{n}天内有效，逾期需重新确认。",
    "防火墙策略已经更新，新增了对内网网段的访问限制。",
    "技术支持热线的服务时间是工作日上午九点至下午六点。",
    "升级过程中请勿关闭电源，否则可能导致系统损坏。",
]
# GB18030 四字节字符（GBK 之外的字符）：扩展 B 区汉字、emoji、欧元符号等
ZH_GB18030_4B = [
    "这位员工的名字里有生僻字𠮷，系统必须能够正确显示。",
    "表情符号😀也会出现在客服的聊天记录中。",
    "𡈽𠀀𪚥是罕见的汉字，旧版数据库无法保存它们。",
    "报销金额为€{n}，请在财务系统中确认汇率。",
    "测试数据包含生僻字𤭢𧻓，用来检查四字节编码的处理。",
    "📦发货完成，🚚运输中，✅已签收。",
    "地名“𣲘”读作 xiàn，在户籍系统中必须完整保存。",
    "客户备注：喜欢喝🍵，不吃🌶。",
]
# GBK 二级汉字 / 较生僻字
ZH_RARE = [
    "他对这份合同提出了异议，认为条款过于苛刻。",
    "机房内弥漫着一股焦糊的气味，值班人员立即切断了电源。",
    "运维团队殚精竭虑，终于在凌晨修复了线上故障。",
    "新员工需要熟悉巡检流程，并且熟练掌握应急预案。",
    "这个模块的耦合度太高，亟待重构。",
    "管理员对账号进行了封禁，避免恶意爬虫继续骚扰。",
    "数据库出现了死锁，事务相互等待，谁也无法继续。",
    "服务端的缓存雪崩导致请求瞬间激增，系统濒临崩溃。",
]

# ---------------------------------------------------------------- 繁體中文（台灣用語）
ZH_TW = [
    "今天凌晨{n}點資料庫備份已經順利完成。",
    "伺服器硬碟空間不足，剩餘容量只有{n}GB。",
    "請各位同仁在下班前提交本週的工作日報。",
    "使用者登入失敗，請檢查帳號與密碼是否正確。",
    "夜間維護期間，系統將於{n}點暫停服務，敬請見諒。",
    "介面呼叫逾時，已自動重試{n}次，仍然沒有回應。",
    "本次發佈包含三項錯誤修正與兩項效能最佳化。",
    "網路設備重新啟動之後，連線狀態已經恢復正常。",
    "客戶資料的變更需經業務部門主管核准後才會生效。",
    "監控系統發出警示，維運人員正在進行初步檢查。",
    "設定檔讀取失敗，程式將以預設值啟動。",
    "訂單資料匯入完成，庫存已依訂單進行配置。",
    "憑證將於{n}天後到期，請儘早辦理續約。",
    "此操作無法復原，請確認是否繼續執行。",
    "測試環境的資料請勿同步到正式環境。",
    "專案進度稍有延遲，主要原因是需求變更頻繁。",
    "印表機發生卡紙，請檢查紙匣並重新放入紙張。",
    "修補程式安裝完成後，請務必重新啟動相關服務。",
    "記錄檔目錄不存在，處理流程已中斷並通知負責人。",
    "記憶體使用率超過百分之{n}，系統已寄出預警郵件。",
    "我們將於週五下午召開障礙檢討會議，歡迎大家參加。",
    "共用資料夾的存取權限需事先向管理員申請。",
    "資料遷移完成後，發現有{n}筆紀錄不一致。",
    "報表格式已依新的業務規則調整，請重新匯出。",
    "雲端儲存空間的使用情形將按月向財務部門報告。",
    "定期巡檢結果顯示，所有機房設備運作穩定。",
    "請將重現步驟與螢幕截圖一併附上，方便研發同仁查找問題。",
    "本次故障的影響範圍僅限於北部地區的部分使用者。",
    "應用程式在高併發情境下出現執行緒阻塞的現象。",
    "報價單自開立日起{n}天內有效，逾期須重新確認。",
    "防火牆規則已經更新，新增了對內部網段的存取限制。",
    "技術支援專線的服務時間為平日上午九點至下午六點。",
    "升級過程中請勿關閉電源，否則可能造成系統損毀。",
]
# Big5 二級字 / 罕用字
ZH_TW_RARE = [
    "這個鬱悶的星期一，伺服器竟然當機了三次。",
    "他的字跡潦草，簽名欄的龜裂線條幾乎無法辨識。",
    "豔陽高照的午後，機房的冷氣卻突然故障。",
    "資料庫的鎖定機制導致交易彼此糾纏，無法繼續。",
    "蠶絲般細緻的流程設計，讓維運作業更加順暢。",
    "請勿濫用管理者權限，以免造成無法挽回的損失。",
    "籲請各單位配合此次演練，確保備援機制運作正常。",
    "這份合約的條款過於嚴苛，法務部門已提出異議。",
    "纜線整理不善，造成機櫃內部散熱不佳。",
    "饕客們湧入訂位系統，導致網站瞬間癱瘓。",
]

# ---------------------------------------------------------------- 英文
EN = [
    "The nightly backup finished successfully at {n}:00.",
    "Disk space on the file server is running low: only {n} GB left.",
    "Please submit your weekly status report before you leave today.",
    "Authentication failed. Check your user name and password.",
    "The system will be unavailable from {n}:00 for scheduled maintenance.",
    "The upstream API timed out; we retried {n} times without a response.",
    "This release contains three bug fixes and two performance improvements.",
    "After restarting the network switch, connectivity was restored.",
    "Changes to customer records require approval from the sales manager.",
    "An alert came in from the monitoring system and triage has started.",
    "The configuration file could not be read, so defaults will be used.",
    "Order data import is complete and stock has been allocated.",
    "The certificate expires in {n} days; please arrange the renewal.",
    "This action cannot be undone. Do you want to continue?",
    "Do not copy test data into the production environment.",
    "The project is slightly behind schedule because requirements keep changing.",
    "The printer reports a paper jam; please check the tray.",
    "Remember to restart the service after the patch has been applied.",
    "The log directory does not exist, so processing was aborted.",
    "Memory usage exceeded {n} percent and a warning mail was sent.",
    "We will hold the incident review on Friday afternoon; everyone is welcome.",
    "Access to the shared folder must be requested from an administrator.",
    "The migration finished, but {n} inconsistent records were found.",
    "The report layout was adjusted for the new business rules.",
    "Cloud storage usage will be reported to finance every month.",
    "The routine inspection found nothing unusual in the data center.",
    "Please attach the reproduction steps and a screenshot to the ticket.",
    "The outage affected only a subset of users in the Tokyo region.",
    "Under heavy load the application showed thread starvation.",
    "The quotation is valid for {n} days from the date of issue.",
    "The firewall policy was updated to restrict access to the internal segment.",
    "Support hotline hours are 9 a.m. to 6 p.m. on weekdays.",
    "Do not power off the machine during the upgrade or it may be damaged.",
]
# 含 Windows-1252 符号的英文（é ü £ 弯引号 — 等）
EN_1252 = [
    "The café’s point-of-sale system crashed during the lunch rush.",
    "Müller & Söhne invoiced £{n} for the “emergency” call-out.",
    "Résumé of the incident — root cause: a naïve retry loop.",
    "The “primary” node failed over to the ‘standby’ node at {n}:15.",
    "Contact José Álvarez (Zürich office) about the licence renewal.",
    "Total due: £1,{n}.50 — payable within 30 days.",
    "She said: “Don’t restart the server yet,” then left for the café.",
    "The señor from São Paulo reported a façade of errors — all false alarms.",
    "Price list: item A €{n}, item B £7.20, item C ¥480 — subject to change.",
    "Copyright © 2026 Example Corp. All rights reserved™.",
    "The deployment took 3½ hours, ± 10 minutes — much slower than expected…",
    "Operation “Blue Ocean” — phase two — begins Monday.",
]

# ---------------------------------------------------------------- 日志用的 ASCII 行与 CJK 插入语
LOG_LEVELS = ["INFO", "INFO", "INFO", "INFO", "WARN", "DEBUG", "ERROR"]
LOG_COMPONENTS = ["scheduler", "auth", "db.pool", "http.server", "batch", "mailer", "cache", "fs.watcher"]
LOG_ASCII = [
    "request completed status=200 bytes={n} elapsed={n2}ms",
    "connection pool size={n} active={n2} idle=3",
    "GET /api/v1/orders/{n} HTTP/1.1 200",
    "POST /api/v1/login HTTP/1.1 302",
    "heartbeat ok seq={n}",
    "cache miss key=user:{n} loading from db",
    "queue length={n} oldest_age={n2}s",
    "job started id={n}",
    "job finished id={n} rc=0",
    "retrying connection to 10.0.{n3}.{n2} attempt=2",
    "gc pause {n2}ms heap=512MB",
    "session expired user_id={n}",
    "file rotated path=/var/log/app/app.log.{n3}",
    "TLS handshake with 192.168.1.{n3} completed",
]
LOG_JA = [
    "ジョブ「夜間バッチ」が開始されました",
    "顧客マスタの更新に失敗しました: 接続がタイムアウトしました",
    "バックアップが完了しました（所要時間 {n} 分）",
    "認証エラー: ユーザー「田中」のパスワードが誤っています",
    "ディスク使用率が閾値を超えました",
    "請求データの取り込みを再実行します",
    "設定ファイルを再読み込みしました",
    "受注番号の重複を検出しました",
]
LOG_ZH_CN = [
    "任务“夜间批处理”已经开始执行",
    "客户主数据更新失败：连接超时",
    "备份已完成，耗时{n}分钟",
    "认证错误：用户“张伟”的密码不正确",
    "磁盘使用率已超过告警阈值",
    "正在重新执行账单数据的导入",
    "配置文件已重新加载",
    "检测到订单编号重复",
]
LOG_ZH_TW = [
    "工作「夜間批次」已開始執行",
    "客戶主檔更新失敗：連線逾時",
    "備份已完成，耗時{n}分鐘",
    "驗證錯誤：使用者「陳大文」的密碼不正確",
    "磁碟使用率已超過警示門檻",
    "正在重新執行帳單資料的匯入",
    "設定檔已重新載入",
    "偵測到訂單編號重複",
]
LOG_EN_1252 = [
    "customer “Müller” updated the café profile",
    "invoice total £{n}.00 — approved by José",
    "résumé upload failed: file too large",
    "user ‘Zoë’ logged in from Zürich",
]

# ---------------------------------------------------------------- CSV 的姓名 / 部门表
CSV_JA = {
    "header": "氏名,部署,金額,備考",
    "names": ["山田太郎", "鈴木花子", "佐藤健一", "高橋美咲", "田中誠", "伊藤直樹", "渡辺由美", "中村拓也", "小林優子", "加藤大輔", "吉田麻衣", "山本和彦"],
    "depts": ["営業部", "総務部", "情報システム部", "経理部", "人事部", "開発部"],
    "notes": ["通常", "要確認", "承認済み", "保留", "再申請"],
}
CSV_ZH_CN = {
    "header": "姓名,部门,金额,备注",
    "names": ["王伟", "李娜", "张磊", "刘洋", "陈静", "杨帆", "赵敏", "黄强", "周杰", "吴婷", "徐丽", "孙鹏"],
    "depts": ["销售部", "行政部", "信息系统部", "财务部", "人事部", "研发部"],
    "notes": ["正常", "待确认", "已批准", "搁置", "重新申请"],
}
CSV_ZH_TW = {
    "header": "姓名,部門,金額,備註",
    "names": ["王大明", "林淑芬", "陳志豪", "張雅婷", "李建宏", "黃怡君", "吳宗翰", "劉佳穎", "蔡明哲", "鄭婉如", "謝文彬", "許育誠"],
    "depts": ["業務部", "行政部", "資訊系統部", "財務部", "人事部", "研發部"],
    "notes": ["正常", "待確認", "已核准", "擱置", "重新申請"],
}
CSV_EN = {
    "header": "name,department,amount,note",
    "names": ["José Álvarez", "Anna Müller", "Chloé Dubois", "Søren Jensen", "Zoë Clark", "Núria Puig", "Renée Martin", "Björn Eriksson", "Ana Lopes", "François Petit"],
    "depts": ["Sales", "Finance", "Operations", "Café Services", "Engineering", "HR"],
    "notes": ["ok", "to confirm", "approved", "on hold", "résubmit"],
}

# 只有汉字（无假名、无 ASCII）的极短文本：多种旧编码下都是合法字节
KANJI_JA = ["顧客管理", "売上集計表", "在庫照会画面", "受注伝票"]
KANJI_ZH_CN = ["用户管理", "销售统计", "库存查询", "订单信息"]
KANJI_ZH_TW = ["使用者管理", "銷售統計", "庫存查詢", "訂單資訊"]
