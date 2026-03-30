# Подключение Voice Finance Tracker к Telegram

Это руководство описывает, как подключить веб-приложение Voice Finance Tracker в качестве Telegram Mini App.

---

## Шаг 1. Создание бота через BotFather

Откройте Telegram и найдите **@BotFather**. Отправьте команду `/newbot`, следуйте инструкциям: укажите имя бота (например, `Voice Finance Tracker`) и username (например, `voice_finance_bot`). BotFather выдаст вам **токен бота** — сохраните его.

---

## Шаг 2. Настройка Mini App (Web App)

Отправьте BotFather команду `/newapp`, выберите вашего бота, затем укажите:

- **Название:** Voice Finance Tracker
- **Описание:** Голосовой финансовый трекер
- **URL веб-приложения:** вставьте URL вашего задеплоенного приложения (например, `https://voice-finance-tracker-xxx.manus.space`)
- **Короткое имя:** `finance` (или любое другое)

---

## Шаг 3. Настройка кнопки меню

Отправьте BotFather команду `/setmenubutton`, выберите бота и укажите:

- **URL:** тот же URL веб-приложения
- **Текст кнопки:** `Открыть трекер`

Теперь у бота появится кнопка для открытия Mini App прямо в чате.

---

## Шаг 4. Настройка описания бота

Отправьте BotFather следующие команды:

- `/setdescription` — описание бота: `Голосовой финансовый трекер. Диктуйте расходы и доходы голосом на русском, азербайджанском или английском.`
- `/setabouttext` — краткое описание: `Трекер финансов с голосовым вводом 🎙️`

---

## Шаг 5 (опционально). Обработка голосовых сообщений через бота

Для обработки голосовых сообщений, отправленных напрямую боту в Telegram, потребуется создать webhook-обработчик. Пример реализации на Node.js:

```javascript
// bot-webhook.mjs
import express from 'express';

const BOT_TOKEN = 'YOUR_BOT_TOKEN';
const WEBAPP_URL = 'https://your-app-url.manus.space';

const app = express();
app.use(express.json());

app.post(`/api/bot/${BOT_TOKEN}`, async (req, res) => {
  const message = req.body.message;

  if (message?.voice) {
    // Получить файл голосового сообщения
    const fileId = message.voice.file_id;
    const fileResp = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`
    );
    const fileData = await fileResp.json();
    const filePath = fileData.result.file_path;
    const audioUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

    // Здесь вызовите ваш API для транскрипции и парсинга
    // const result = await transcribeAndParse(audioUrl);

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: message.chat.id,
        text: `Транзакция записана! Откройте трекер для подробностей.`,
        reply_markup: {
          inline_keyboard: [[{
            text: '📊 Открыть трекер',
            web_app: { url: WEBAPP_URL }
          }]]
        }
      })
    });
  } else if (message?.text === '/start') {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: message.chat.id,
        text: 'Добро пожаловать в Voice Finance Tracker! 🎙️\n\nОтправьте голосовое сообщение с описанием расхода или дохода, или откройте приложение через кнопку меню.',
        reply_markup: {
          inline_keyboard: [[{
            text: '📊 Открыть трекер',
            web_app: { url: WEBAPP_URL }
          }]]
        }
      })
    });
  }

  res.sendStatus(200);
});

// Установка webhook
const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=https://your-server.com/api/bot/${BOT_TOKEN}`
  );
  console.log(`Bot webhook running on port ${PORT}`);
});
```

---

## Архитектура приложения

| Компонент | Технология |
|---|---|
| Фронтенд | React 19, Tailwind CSS 4, shadcn/ui |
| Бэкенд | Node.js, Express, tRPC |
| База данных | MySQL (TiDB) |
| Голосовой ввод | OpenAI Whisper API |
| Парсинг транзакций | LLM (GPT) с JSON Schema |
| Хранилище файлов | S3 |
| Диаграммы | Recharts |

## Функционал

| Функция | Описание |
|---|---|
| Голосовой ввод | Запись через микрофон в приложении, распознавание RU/AZ/EN |
| Транзакции | Создание, редактирование, удаление расходов и доходов |
| 15+ категорий | Предустановленные + пользовательские категории |
| Семейный режим | Создание групп, код приглашения, семейные транзакции |
| Отчёты | Баланс, доходы/расходы, диаграммы по категориям |
| CSV экспорт | Выгрузка транзакций в CSV файл |
| Мультивалютность | AZN, RUB, USD, EUR, TRY, GEL |
