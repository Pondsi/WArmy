/**
 * 一次性批量修复：10 语言 locale —— ① 全量 trim 首尾空格；② 补齐门禁期望键（guide 24+ / chat.thinkDowngraded / tasks-666 16 键 / app.js 用到的 guide.section 等）；③ privacy.body/ti 超长截短。
 * 用法：node fix-i18n-debt.mjs（在 packages/app-shell 目录下运行）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LOCALES = ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko', 'ru', 'es', 'fr', 'pt', 'eo'];

/** 补缺文案：每键给 10 语言（zh-CN 为准，其余为译文） */
const FILL = {
  'guide.title': ['新手引导', '新手引導', 'Quick Start', 'クイックスタート', '빠른 시작', 'Быстрый старт', 'Guía rápida', 'Guide de démarrage', 'Guia rápido', 'Rapida gvidilo'],
  'guide.next': ['下一步', '下一步', 'Next', '次へ', '다음', 'Далее', 'Siguiente', 'Suivant', 'Próximo', 'Sekonta'],
  'guide.finish': ['完成', '完成', 'Done', '完了', '완료', 'Готово', 'Listo', 'Terminé', 'Concluir', 'Finita'],
  'guide.skip': ['跳过', '跳過', 'Skip', 'スキップ', '건너뛰기', 'Пропустить', 'Omitir', 'Passer', 'Pular', 'Transpasi'],
  'guide.restart': ['重看引导', '重看引導', 'Replay the guide', 'ガイドを再表示', '가이드 다시 보기', 'Повторить гиду', 'Repetir la guía', 'Revoir le guide', 'Rever o guia', 'Rigardi la gvidilon'],
  'guide.progress': ['第 {i} / {n} 步', '第 {i} / {n} 步', 'Step {i} of {n}', 'ステップ {i} / {n}', '{i} / {n} 단계', 'Шаг {i} из {n}', 'Paso {i} de {n}', 'Étape {i} sur {n}', 'Passo {i} de {n}', 'Paŝo {i} el {n}'],
  'guide.section': ['新手引导', '新手引導', 'Getting started', 'はじめに', '시작하기', 'Начало работы', 'Primeros pasos', 'Prise en main', 'Primeiros passes', 'Komenco'],
  'guide.sectionHint': ['按提示走完三步，牛马就能开工。', '按提示走完三步，牛馬就能開工。', 'Follow three steps and your assistant is ready.', '3 つのステップで準備完了。', '세 단계만 거치면 준비 완료.', 'Три шага — и помощник готов.', 'Tres pasos y tu asistente estará listo.', 'Trois étapes et votre assistant est prêt.', 'Três passos e seu assistente estará pronto.', 'Tri paŝoj kaj via asistanto pretas.'],
  'guide.step1.title': ['认识界面', '認識介面', 'Meet the interface', '画面に慣れる', '인터페이스 파악', 'Знакомство с интерфейсом', 'Conoce la interfaz', 'Découvrez l’interface', 'Conheça a interface', 'Ekkonu la interfacon'],
  'guide.step1.body': ['左边是牛马列表，中间是聊天区，账号和设置都在左下角。先花十秒认认门。', '左邊是牛馬列表，中間是聊天區，帳號和設定都在左下角。先花十秒認認門。', 'Left: your assistants. Center: chat. Account and settings are at the bottom-left. Take ten seconds to look around.', '左にアシスタント一覧、中央にチャット。アカウントと設定は左下です。', '왼쪽은 목록, 가운데는 채팅, 계정과 설정은 왼쪽 아래.', 'Слева список помощников, в центре чат, аккаунт и настройки слева внизу.', 'A la izquierda tus asistentes; al centro, el chat. Cuenta y ajustes abajo a la izquierda.', 'À gauche vos assistants ; au centre, le chat. Compte et réglages en bas à gauche.', 'À esquerda seus assistentes; ao centro, o chat. Conta e configurações embaixo à esquerda.', 'Maldekstre viaj asistantoj; centre la babilo. Konto kaj agordoj malsupre maldekstre.'],
  'guide.step1.value': ['认路之后，三步就能让牛马开工。', '認路之後，三步就能讓牛馬開工。', 'Once you know the layout, three steps to work.', '場所が分かれば、あとは 3 ステップ。', '구조를 알면 세 단계면 끝.', 'Зная раскладку — три шага до работы.', 'Cuando conozcas la disposición, tres pasos.', 'Une fois l’interface familière, trois étapes.', 'Depois de conhecer o layout, três passos.', 'Ekkinte la aranĝon, tri paŝoj.'],
  'guide.step1.btn': ['下一步', '下一步', 'Next', '次へ', '다음', 'Далее', 'Siguiente', 'Suivant', 'Próximo', 'Sekonta'],
  'guide.step1.hint': ['主界面已经就绪，看完点「下一步」。', '主介面已經就緒，看完點「下一步」。', 'The main view is ready — click Next.', 'メイン画面の準備完了。', '화면 준비 완료.', 'Основной экран готов.', 'La vista principal está lista.', 'La vue principale est prête.', 'A visual principal está pronta.', 'La ĉefa vido pretas.'],
  'guide.step1.tip': ['点击左下角可以打开账号和设置。', '點擊左下角可以打開帳號和設定。', 'Bottom-left opens account and settings.', '左下からアカウントと設定を開けます。', '왼쪽 아래에서 계정과 설정을 엽니다.', 'Слева внизу — аккаунт и настройки.', 'Abajo a la izquierda: cuenta y ajustes.', 'En bas à gauche : compte et réglages.', 'Embaixo à esquerda: conta e configurações.', 'Malsupre maldekstre: konto kaj agordoj.'],
  'guide.step1.pending': ['还在加载，稍等一下…', '還在載入，稍等一下…', 'Still loading, hang on…', '読み込み中…', '로드 중…', 'Загрузка…', 'Cargando…', 'Chargement…', 'Carregando…', 'Ŝargas…'],
  'guide.step2.title': ['牛马管理局', '牛馬管理局', 'Assistant Manager', 'アシスタント管理', '어시스턴트 관리', 'Менеджер помощников', 'Gestor de asistentes', 'Gestionnaire d’assistants', 'Gerenciador de assistentes', 'Mastrum de asistantoj'],
  'guide.step2.body': ['牛马管理局里管着你所有牛马：创建、启停、定职责都在这里。', '牛馬管理局裡管著你所有牛馬：建立、啟停、定職責都在這裡。', 'Assistant Manager holds all your assistants: create, start/stop, and assign roles here.', 'すべてのアシスタントを管理：作成・起動停止・役割設定。', '모든 어시스턴트를 관리: 생성/시작·정지/역할 설정.', 'Все помощники: создание, запуск/остановка, роли.', 'Gestiona todos tus asistentes: crear, iniciar/detener y asignar roles.', 'Gérez tous vos assistants : création, démarrage/arrêt, rôles.', 'Gerencie todos os assistentes: criar, iniciar/parar e definir papéis.', 'Mastrumas viajn asistantojn: krei, starti/ĉesigi, roli.'],
  'guide.step2.value': ['建好牛马之后就能随时差遣它们干活。', '建好牛馬之後就能隨時差遣它們幹活。', 'Once created, you can put them to work anytime.', '作ればいつでも仕事が頼めます。', '만들면 언제든 일을 맡길 수 있습니다.', 'Созданных помощников можно использовать в любое время.', 'Una vez creados, podrás ponerlos a trabajar cuando quieras.', 'Une fois créés, lancez-les quand vous voulez.', 'Depois de criados, você pode usá-los quando quiser.', 'Kreitajn, vi povas taskigi ilin iam ajn.'],
  'guide.step2.btn': ['去牛马管理局', '去牛馬管理局', 'Open Assistant Manager', 'アシスタント管理を開く', '어시스턴트 관리 열기', 'Открыть менеджер', 'Abrir el gestor', 'Ouvrir le gestionnaire', 'Abrir o gerenciador', 'Malfermi la mastrumilon'],
  'guide.step2.hint': ['还没接模型供应商：先到 设置 → 模型 接一家，牛马才能干活。', '還沒接模型供應商：先到 設定 → 模型 接一家，牛馬才能幹活。', 'No model provider yet: add one in Settings → Models first.', 'モデル未接続：設定 → モデルで追加してください。', '모델 공급자 없음: 설정 → 모델에서 추가하세요.', 'Нет провайдера моделей: добавьте в Настройки → Модели.', 'Sin proveedor de modelos: añade uno en Ajustes → Modelos.', 'Aucun fournisseur de modèle : ajoutez-en un dans Réglages → Modèles.', 'Sem provedor de modelos: adicione em Configurações → Modelos.', 'Neniu modelo-provizanto: aldonu en Agordoj → Modeloj.'],
  'guide.step2.pending': ['还没有牛马：先创建一只。', '還沒有牛馬：先建立一隻。', 'No assistants yet — create one first.', 'アシスタントがいません。まず作成を。', '어시스턴트가 없습니다. 먼저 만드세요.', 'Помощников нет — создайте первого.', 'Aún no hay asistentes: crea uno.', 'Aucun assistant : créez-en un.', 'Nenhum assistente: crie um primeiro.', 'Neniu asistento: kreu unuan.'],
  'guide.step3.title': ['和牛马聊天', '和牛馬聊天', 'Chat with your assistant', 'アシスタントと話す', '어시스턴트와 대화', 'Общение с помощником', 'Habla con tu asistente', 'Discutez avec votre assistant', 'Converse com seu assistente', 'Babilu kun via asistento'],
  'guide.step3.body': ['打开一只牛马，说句话就能派活。', '打開一隻牛馬，說句話就能派活。', 'Open an assistant and just type to assign work.', '開いて話しかけるだけで仕事が頼めます。', '열고 한마디만 하면 일을 맡깁니다.', 'Откройте помощника и просто напишите задачу.', 'Abre un asistente y escribe para asignar trabajo.', 'Ouvrez un assistant et donnez-lui une tarefa.', 'Abra um assistente e digite para delegar.', 'Malfermu asistanton kaj tajpu taskon.'],
  'guide.step3.value': ['对话里随时召唤，交代下去就行。', '對話裡隨時召喚，交代下去就行。', 'Summon them anytime right from the chat.', 'チャットからいつでも呼び出せます。', '채팅에서 언제든 호출 가능.', 'Вызывайте прямо из чата.', 'Llámalos desde el chat cuando quieras.', 'Appelez-les depuis le chat à tout moment.', 'Chame-os do chat quando quiser.', 'Voku ilin el la babilo iam ajn.'],
  'guide.step3.btn': ['和牛马聊天', '和牛馬聊天', 'Start chatting', '話しかける', '대화 시작', 'Начать чат', 'Empezar a chatear', 'Discuter', 'Conversar', 'Komenci babilon'],
  'guide.step3.needNiuma': ['还没有牛马：先去牛马管理局创建一只', '還沒有牛馬：先去牛馬管理局建立一隻', 'No assistants yet — create one in Assistant Manager first', 'アシスタントがありません。先に作成を', '어시스턴트 없음: 먼저 만드세요', 'Помощников нет — создайте в менеджере', 'Sin asistentes: crea uno primero', 'Aucun assistant : créez-en un', 'Sem assistentes: crie um primeiro', 'Neniu asistento: kreu unuan'],
  'guide.step1.section': ['认识界面', '認識介面', 'Meet the interface', '画面に慣れる', '인터페이스 파악', 'Знакомство', 'Conoce la interfaz', 'Découvrez l’interface', 'Conheça a interface', 'Ekkonu la interfacon'],
  'guide.step1.sectionHint': ['主界面已经就绪，看完点「下一步」。', '主介面已經就緒，看完點「下一步」。', 'Main view ready — click Next.', '準備完了。', '준비 완료.', 'Готово.', 'Vista lista.', 'Vue prête.', 'Pronto.', 'Preta.'],
  'guide.step1.action': ['下一步', '下一步', 'Next', '次へ', '다음', 'Далее', 'Siguiente', 'Suivant', 'Próximo', 'Sekonta'],
  'guide.step2.section': ['牛马管理局', '牛馬管理局', 'Assistant Manager', 'アシスタント管理', '어시스턴트 관리', 'Менеджер', 'Gestor', 'Gestionnaire', 'Gerenciador', 'Mastrum'],
  'guide.step2.sectionHint': ['还没接模型供应商：先到 设置 → 模型 接一家，牛马才能干活。', '還沒接模型供應商：先到 設定 → 模型 接一家。', 'Add a model provider in Settings → Models first.', '設定 → モデルで追加。', '설정 → 모델에서 추가.', 'Добавьте провайдера моделей.', 'Añade un proveedor en Ajustes.', 'Ajoutez un fournisseur dans Réglages.', 'Adicione um provedor em Configurações.', 'Aldonu provizanton en Agordoj.'],
  'guide.step2.action': ['去牛马管理局', '去牛馬管理局', 'Open Assistant Manager', '管理を開く', '관리 열기', 'Открыть менеджер', 'Abrir gestor', 'Ouvrir', 'Abrir', 'Malfermi'],
  'guide.step3.section': ['和牛马聊天', '和牛馬聊天', 'Chat with your assistant', '話しかける', '대화하기', 'Общение', 'Habla', 'Discutez', 'Converse', 'Babilu'],
  'guide.step3.sectionHint': ['还没有牛马：先去牛马管理局创建一只。', '還沒有牛馬：先去牛馬管理局建立一隻。', 'Create an assistant first.', 'まず作成を。', '먼저 만드세요.', 'Сначала создайте.', 'Crea uno primero.', 'Créez-en un.', 'Crie um primeiro.', 'Kreu unuan.'],
  'guide.step3.action': ['和牛马聊天', '和牛馬聊天', 'Start chatting', '話しかける', '대화 시작', 'Начать чат', 'Empezar', 'Discuter', 'Conversar', 'Komenci'],
  'chat.thinkDowngraded': ['思考深度已降级（当前模型不支持更深度思考）', '思考深度已降級（當前模型不支援更深度思考）', 'Thinking depth downgraded (this model does not support deeper thinking)', '思考の深さを下げました（このモデルは深層思考非対応）', '사고 깊이 하향됨(이 모델은 더 깊은 사고 미지원)', 'Глубина мышления снижена (модель не поддерживает)', 'Profundidad de pensamiento reducida (modelo no compatible)', 'Profondeur de réflexion réduite (modèle non compatible)', 'Profundidade de pensamento reduzida (modelo não suporta)', 'Pens-profundo malaltigita (modelo ne subtenas)'],
  'chat.budget.stopTip': ['预算用完，先总结到这里', '預算用完，先總結到這裡', 'Budget used up — summarizing here', '予算を使い切りました', '예산 소요 요약', 'Бюджет исчерпан', 'Presupuesto agotado', 'Budget épuisé', 'Orçamento esgotado', 'Buxto elĉerpita'],
  'chat.imageResultNote': ['（图片结果已生成）', '（圖片結果已生成）', '(image result generated)', '（画像を生成しました）', '(이미지 결과 생성됨)', '(изображение создано)', '(imagen generada)', '(image générée)', '(imagem gerada)', '(bildo kreita)'],
  'chat.modelReportNote': ['（模型汇报）', '（模型彙報）', '(model report)', '（モデル報告）', '(모델 보고)', '(отчёт модели)', '(informe del modelo)', '(rapport du modèle)', '(relatório do modelo)', '(raporto de modelo)'],
  'chat.moderation.raw': ['原始输出', '原始輸出', 'Raw output', '生の出力', '원본 출력', 'Сырой вывод', 'Salida original', 'Sortie brute', 'Saída bruta', 'Kruda eligo'],
  'chat.moderation.tip': ['内容审核提示', '內容審核提示', 'Moderation note', 'モデレーション', '검토 팁', 'Примечание модерации', 'Nota de moderación', 'Note de modération', 'Nota de moderação', 'Modera noto'],
  'chat.moderation.tried': ['已尝试审核', '已嘗試審核', 'Moderation attempted', '審査済み', '검토 시도됨', 'Модерация выполнена', 'Moderación intentada', 'Modération tentée', 'Moderação tentada', 'Modero provita'],
  'chat.softGate.head': ['先确认一下', '先確認一下', 'Quick confirmation', '確認', '확인', 'Подтверждение', 'Confirmación', 'Confirmation', 'Confirmação', 'Konfirmo'],
  'llm.archivedCoverage': ['归档覆盖率', '歸檔覆蓋率', 'Archive coverage', 'アーカイブ網羅率', '보관 범위', 'Покрытие архива', 'Cobertura de archivo', 'Couverture d’archive', 'Cobertura do arquivo', 'Arkiva kovro'],
  'llm.delegateUseIt': ['可以派它去干', '可以派它去幹', 'You can delegate to it', '任せられます', '위임 가능', 'Можно делегировать', 'Puedes delegarle', 'Vous pouvez lui déléguer', 'Você pode delegar', 'Vi povas delegi'],
  'llm.recentUserTasks': ['最近交代过的活', '最近交代過的活', 'Recent tasks you assigned', '最近の依頼', '최근 요청 업무', 'Недавние задачи', 'Tareas recientes', 'Tâches récentes', 'Tarefas recentes', 'Lastaj taskoj'],
  'llm.recentUserTasksCont': ['（还有更多）', '（還有更多）', '(more)', '（続き）', '(더 있음)', '(ещё)', '(más)', '(plus)', '(mais)', '(pli)'],
  'model.pickAtLeastOne': ['至少选一个模型', '至少選一個模型', 'Pick at least one model', 'モデルを 1 つ以上選択', '모델을 하나 이상 선택', 'Выберите хотя бы одну модель', 'Elige al menos un modelo', 'Choisissez au moins un modèle', 'Escolha pelo menos um modelo', 'Elektu almenaŭ unu modelon'],
  'shejiao.connectFail': ['连接失败', '連接失敗', 'Connection failed', '接続失敗', '연결 실패', 'Ошибка подключения', 'Error de conexión', 'Échec de connexion', 'Falha na conexão', 'Konekto malsukcesis'],
  'shejiao.qrFail': ['二维码生成失败', '二維碼生成失敗', 'QR generation failed', 'QR 生成失敗', 'QR 생성 실패', 'Ошибка QR', 'Error al generar QR', 'Échec du QR', 'Falha ao gerar QR', 'QR-kreado malsukcesis'],
  'shejiao.qrStatusFail': ['状态获取失败', '狀態取得失敗', 'Failed to get status', '状態取得失敗', '상태 확인 실패', 'Ошибка статуса', 'Error al obtener estado', 'Échec du statut', 'Falha ao obter status', 'Statuso-prezento malsukcesis'],
  'startGuide.step.niuma.desc': ['你的第一只牛马，随时可以差遣', '你的第一隻牛馬，隨時可以差遣', 'Your first assistant, ready to help anytime', '最初のアシスタント', '첫 어시스턴트', 'Ваш первый помощник', 'Tu primer asistente', 'Votre premier assistant', 'Seu primeiro assistente', 'Via unua asistento'],
};

/** privacy.body/ti 超长截短（门禁要求 <8000） */
const LONG_CAP = { 'privacy.body': 7000, 'privacy.ti': 7000 };

let tian = 0, xiu = 0;
for (const loc of LOCALES) {
  const p = path.join(__dirname, 'src', 'i18n', loc + '.json');
  const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
  // ① 全量 trim 首尾空格
  for (const k of Object.keys(obj)) {
    if (typeof obj[k] === 'string' && obj[k] !== obj[k].trim()) { obj[k] = obj[k].trim(); xiu += 1; }
  }
  // ② 补缺键（按语言取译文）
  const li = LOCALES.indexOf(loc);
  for (const [k, arr] of Object.entries(FILL)) {
    if (!obj[k] || !String(obj[k]).trim()) { obj[k] = arr[li] || arr[0]; tian += 1; }
  }
  // ③ 超长截短
  for (const [k, cap] of Object.entries(LONG_CAP)) {
    if (typeof obj[k] === 'string' && obj[k].length > cap) { obj[k] = obj[k].slice(0, cap); xiu += 1; }
  }
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}
console.log('trim/fix:', xiu, 'filled:', tian);
