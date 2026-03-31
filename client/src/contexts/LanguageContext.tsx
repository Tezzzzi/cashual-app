import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { trpc } from "@/lib/trpc";

// ─── Translation Dictionaries ─────────────────────────────────────────────────

const translations = {
  ru: {
    // Navigation
    nav_home: "Главная",
    nav_transactions: "Записи",
    nav_reports: "Отчёты",
    nav_family: "Семья",
    nav_settings: "Ещё",

    // Home
    greeting: "Привет,",
    user_fallback: "Пользователь",
    total_balance: "Общий баланс",
    income: "Доходы",
    expenses: "Расходы",
    voice_input: "Голосовой ввод",
    recent_records: "Последние записи",
    all_records: "Все →",
    no_records: "Нет записей. Начните с голосового ввода!",
    transaction_label: "Транзакция",
    confirm_transaction: "Подтвердите транзакцию",
    new_transaction: "Новая транзакция",
    recognized: "Распознано:",
    initializing: "Инициализация...",
    authorizing: "Авторизация...",
    open_via_telegram: "Откройте приложение через Telegram бота",
    voice_finance_tracker: "Голосовой финансовый трекер",

    // Transaction form
    expense: "Расход",
    income_btn: "Доход",
    amount: "Сумма",
    currency: "Валюта",
    category: "Категория",
    select_category: "Выберите категорию",
    description: "Описание",
    description_placeholder: "Описание транзакции",
    date: "Дата",
    personal: "Личное",
    family: "Семейное",
    select_group: "Выберите группу",
    cancel: "Отмена",
    save: "Сохранить",
    add: "Добавить",
    enter_amount: "Введите сумму",
    select_category_error: "Выберите категорию",
    transaction_added: "Транзакция добавлена",
    transaction_updated: "Транзакция обновлена",

    // Transactions page
    transactions_title: "Транзакции",
    all: "Все",
    filter_expense: "Расходы",
    filter_income: "Доходы",
    no_transactions: "Нет транзакций",
    edit: "Редактировать",
    delete: "Удалить",
    confirm_delete: "Удалить транзакцию?",
    confirm_delete_desc: "Это действие нельзя отменить.",
    delete_confirm: "Удалить",
    transaction_deleted: "Транзакция удалена",
    family_badge: "Семья",

    // Reports
    reports_title: "Отчёты",
    week: "Неделя",
    month: "Месяц",
    year: "Год",
    all_time: "Всё",
    balance: "Баланс",
    by_category: "По категориям",
    no_data: "Нет данных за выбранный период",
    export_csv: "CSV",

    // Family
    family_title: "Семейный бюджет",
    your_group: "Ваша группа",
    invite_code: "Код приглашения",
    members: "Участники",
    leave_group: "Покинуть группу",
    create_group: "Создать группу",
    join_group: "Войти по коду",
    group_name: "Название группы",
    enter_invite_code: "Введите код приглашения",
    create: "Создать",
    join: "Войти",
    no_family_group: "У вас нет семейной группы",
    create_or_join: "Создайте новую или войдите по коду приглашения",
    leave_confirm: "Покинуть группу?",
    leave_confirm_desc: "Вы покинете семейную группу. Ваши транзакции останутся.",
    leave_btn: "Покинуть",
    group_created: "Группа создана",
    joined_group: "Вы вступили в группу",
    left_group: "Вы покинули группу",
    copied: "Скопировано!",
    copy_code: "Скопировать код",
    owner_badge: "Владелец",

    // Settings
    settings_title: "Настройки",
    interface_language: "Язык интерфейса",
    default_currency: "Валюта по умолчанию",
    categories: "Категории",
    add_category: "Добавить",
    your_categories: "Ваши категории",
    preset_categories: "Стандартные",
    about: "О приложении",
    about_text: "CA$HUAL — голосовой финансовый трекер для Telegram. Диктуйте расходы и доходы голосом на русском, азербайджанском или английском языке.",
    logout: "Выйти",
    settings_saved: "Настройки сохранены",
    new_category: "Новая категория",
    category_name: "Название",
    icon: "Иконка",
    color: "Цвет",
    income_expense: "Доход и расход",
    expense_only: "Только расход",
    income_only: "Только доход",
    category_created: "Категория создана",
    category_deleted: "Категория удалена",
    login_to_view: "Войдите для просмотра",
    default_budget: "Бюджет по умолчанию",
    default_budget_personal: "Личный",
    default_budget_family: "Семейный",
    default_budget_desc: "Какой бюджет выбирать по умолчанию при добавлении транзакции",

    // Receipt
    scan_receipt: "Сканировать чек",
    receipt_title: "Распознать чек",
    receipt_desc: "Сфотографируйте чек или скриншот банковской транзакции",
    take_photo: "Сфотографировать",
    upload_image: "Загрузить фото",
    processing_receipt: "Распознаю чек...",
    processing_receipt_desc: "Анализирую изображение с помощью ИИ",
    receipt_recognized: "Чек распознан",
    receipt_error: "Не удалось распознать чек",
    confidence: "Точность",
    confidence_high: "Высокая",
    confidence_medium: "Средняя",
    confidence_low: "Низкая",
    review_carefully: "Проверьте данные перед сохранением",
    review_and_confirm: "Проверьте и подтвердите данные транзакции:",
  },

  az: {
    // Navigation
    nav_home: "Ana səhifə",
    nav_transactions: "Əməliyyatlar",
    nav_reports: "Hesabatlar",
    nav_family: "Ailə",
    nav_settings: "Daha çox",

    // Home
    greeting: "Salam,",
    user_fallback: "İstifadəçi",
    total_balance: "Ümumi balans",
    income: "Gəlirlər",
    expenses: "Xərclər",
    voice_input: "Səsli giriş",
    recent_records: "Son qeydlər",
    all_records: "Hamısı →",
    no_records: "Qeyd yoxdur. Səsli girişlə başlayın!",
    transaction_label: "Əməliyyat",
    confirm_transaction: "Əməliyyatı təsdiqləyin",
    new_transaction: "Yeni əməliyyat",
    recognized: "Tanındı:",
    initializing: "Başlanır...",
    authorizing: "Giriş edilir...",
    open_via_telegram: "Tətbiqi Telegram botu vasitəsilə açın",
    voice_finance_tracker: "Səsli maliyyə izləyicisi",

    // Transaction form
    expense: "Xərc",
    income_btn: "Gəlir",
    amount: "Məbləğ",
    currency: "Valyuta",
    category: "Kateqoriya",
    select_category: "Kateqoriya seçin",
    description: "Təsvir",
    description_placeholder: "Əməliyyatın təsviri",
    date: "Tarix",
    personal: "Şəxsi",
    family: "Ailə",
    select_group: "Qrup seçin",
    cancel: "Ləğv et",
    save: "Saxla",
    add: "Əlavə et",
    enter_amount: "Məbləği daxil edin",
    select_category_error: "Kateqoriya seçin",
    transaction_added: "Əməliyyat əlavə edildi",
    transaction_updated: "Əməliyyat yeniləndi",

    // Transactions page
    transactions_title: "Əməliyyatlar",
    all: "Hamısı",
    filter_expense: "Xərclər",
    filter_income: "Gəlirlər",
    no_transactions: "Əməliyyat yoxdur",
    edit: "Redaktə et",
    delete: "Sil",
    confirm_delete: "Əməliyyat silinsin?",
    confirm_delete_desc: "Bu əməliyyat geri qaytarıla bilməz.",
    delete_confirm: "Sil",
    transaction_deleted: "Əməliyyat silindi",
    family_badge: "Ailə",

    // Reports
    reports_title: "Hesabatlar",
    week: "Həftə",
    month: "Ay",
    year: "İl",
    all_time: "Hamısı",
    balance: "Balans",
    by_category: "Kateqoriyaya görə",
    no_data: "Seçilmiş dövr üçün məlumat yoxdur",
    export_csv: "CSV",

    // Family
    family_title: "Ailə büdcəsi",
    your_group: "Qrupunuz",
    invite_code: "Dəvət kodu",
    members: "Üzvlər",
    leave_group: "Qrupdan çıx",
    create_group: "Qrup yarat",
    join_group: "Kodla qoşul",
    group_name: "Qrupun adı",
    enter_invite_code: "Dəvət kodunu daxil edin",
    create: "Yarat",
    join: "Qoşul",
    no_family_group: "Ailə qrupunuz yoxdur",
    create_or_join: "Yeni qrup yaradın və ya dəvət kodu ilə qoşulun",
    leave_confirm: "Qrupdan çıxılsın?",
    leave_confirm_desc: "Siz ailə qrupundan çıxacaqsınız. Əməliyyatlarınız qalacaq.",
    leave_btn: "Çıx",
    group_created: "Qrup yaradıldı",
    joined_group: "Qrupa qoşuldunuz",
    left_group: "Qrupdan çıxdınız",
    copied: "Kopyalandı!",
    copy_code: "Kodu kopyala",
    owner_badge: "Sahib",

    // Settings
    settings_title: "Parametrlər",
    interface_language: "İnterfeys dili",
    default_currency: "Standart valyuta",
    categories: "Kateqoriyalar",
    add_category: "Əlavə et",
    your_categories: "Sizin kateqoriyalar",
    preset_categories: "Standart",
    about: "Proqram haqqında",
    about_text: "CA$HUAL — Telegram üçün səsli maliyyə izləyicisi. Xərclərinizi və gəlirlərinizi Azərbaycan, rus və ya ingilis dilində diktə edin.",
    logout: "Çıxış",
    settings_saved: "Parametrlər saxlandı",
    new_category: "Yeni kateqoriya",
    category_name: "Ad",
    icon: "İkon",
    color: "Rəng",
    income_expense: "Gəlir və xərc",
    expense_only: "Yalnız xərc",
    income_only: "Yalnız gəlir",
    category_created: "Kateqoriya yaradıldı",
    category_deleted: "Kateqoriya silindi",
    login_to_view: "Baxmaq üçün daxil olun",
    default_budget: "Standart büdcə",
    default_budget_personal: "Şəxsi",
    default_budget_family: "Ailə",
    default_budget_desc: "Əməliyyat əlavə edərkən hansı büdcəni standart seçmək",

    // Receipt
    scan_receipt: "Çeki skan et",
    receipt_title: "Çeki tanı",
    receipt_desc: "Çekin və ya bank əməliyyatının ekran görüntüsünü çəkin",
    take_photo: "Foto çək",
    upload_image: "Şəkil yüklə",
    processing_receipt: "Çek tanınır...",
    processing_receipt_desc: "Süni intellekt ilə şəkil analiz edilir",
    receipt_recognized: "Çek tanındı",
    receipt_error: "Çeki tanımaq mümkün olmadı",
    confidence: "Dəqiqlik",
    confidence_high: "Yüksək",
    confidence_medium: "Orta",
    confidence_low: "Aşağı",
    review_carefully: "Saxlamadan əvvəl məlumatları yoxlayın",
    review_and_confirm: "Əməliyyat məlumatlarını yoxlayın və təsdiqləyin:",
  },

  en: {
    // Navigation
    nav_home: "Home",
    nav_transactions: "Records",
    nav_reports: "Reports",
    nav_family: "Family",
    nav_settings: "More",

    // Home
    greeting: "Hello,",
    user_fallback: "User",
    total_balance: "Total Balance",
    income: "Income",
    expenses: "Expenses",
    voice_input: "Voice Input",
    recent_records: "Recent Records",
    all_records: "All →",
    no_records: "No records yet. Start with voice input!",
    transaction_label: "Transaction",
    confirm_transaction: "Confirm Transaction",
    new_transaction: "New Transaction",
    recognized: "Recognized:",
    initializing: "Initializing...",
    authorizing: "Authorizing...",
    open_via_telegram: "Open the app through Telegram bot",
    voice_finance_tracker: "Voice Finance Tracker",

    // Transaction form
    expense: "Expense",
    income_btn: "Income",
    amount: "Amount",
    currency: "Currency",
    category: "Category",
    select_category: "Select category",
    description: "Description",
    description_placeholder: "Transaction description",
    date: "Date",
    personal: "Personal",
    family: "Family",
    select_group: "Select group",
    cancel: "Cancel",
    save: "Save",
    add: "Add",
    enter_amount: "Enter amount",
    select_category_error: "Select a category",
    transaction_added: "Transaction added",
    transaction_updated: "Transaction updated",

    // Transactions page
    transactions_title: "Transactions",
    all: "All",
    filter_expense: "Expenses",
    filter_income: "Income",
    no_transactions: "No transactions",
    edit: "Edit",
    delete: "Delete",
    confirm_delete: "Delete transaction?",
    confirm_delete_desc: "This action cannot be undone.",
    delete_confirm: "Delete",
    transaction_deleted: "Transaction deleted",
    family_badge: "Family",

    // Reports
    reports_title: "Reports",
    week: "Week",
    month: "Month",
    year: "Year",
    all_time: "All",
    balance: "Balance",
    by_category: "By Category",
    no_data: "No data for the selected period",
    export_csv: "CSV",

    // Family
    family_title: "Family Budget",
    your_group: "Your Group",
    invite_code: "Invite Code",
    members: "Members",
    leave_group: "Leave Group",
    create_group: "Create Group",
    join_group: "Join by Code",
    group_name: "Group Name",
    enter_invite_code: "Enter invite code",
    create: "Create",
    join: "Join",
    no_family_group: "You have no family group",
    create_or_join: "Create a new one or join with an invite code",
    leave_confirm: "Leave group?",
    leave_confirm_desc: "You will leave the family group. Your transactions will remain.",
    leave_btn: "Leave",
    group_created: "Group created",
    joined_group: "You joined the group",
    left_group: "You left the group",
    copied: "Copied!",
    copy_code: "Copy code",
    owner_badge: "Owner",

    // Settings
    settings_title: "Settings",
    interface_language: "Interface Language",
    default_currency: "Default Currency",
    categories: "Categories",
    add_category: "Add",
    your_categories: "Your Categories",
    preset_categories: "Preset",
    about: "About",
    about_text: "CA$HUAL — a voice finance tracker for Telegram. Dictate your expenses and income in Russian, Azerbaijani, or English.",
    logout: "Log Out",
    settings_saved: "Settings saved",
    new_category: "New Category",
    category_name: "Name",
    icon: "Icon",
    color: "Color",
    income_expense: "Income & Expense",
    expense_only: "Expense only",
    income_only: "Income only",
    category_created: "Category created",
    category_deleted: "Category deleted",
    login_to_view: "Log in to view",
    default_budget: "Default Budget",
    default_budget_personal: "Personal",
    default_budget_family: "Family",
    default_budget_desc: "Which budget to select by default when adding a transaction",

    // Receipt
    scan_receipt: "Scan Receipt",
    receipt_title: "Scan Receipt",
    receipt_desc: "Take a photo of a receipt or a bank transaction screenshot",
    take_photo: "Take Photo",
    upload_image: "Upload Image",
    processing_receipt: "Recognizing receipt...",
    processing_receipt_desc: "Analyzing image with AI",
    receipt_recognized: "Receipt recognized",
    receipt_error: "Could not recognize receipt",
    confidence: "Confidence",
    confidence_high: "High",
    confidence_medium: "Medium",
    confidence_low: "Low",
    review_carefully: "Please review the data before saving",
    review_and_confirm: "Review and confirm transaction details:",
  },
} as const;

// ─── Category Name Translations ───────────────────────────────────────────────
// Maps Russian preset category names → AZ and EN equivalents
export const categoryTranslations: Record<string, { az: string; en: string }> = {
  "Продукты":     { az: "Ərzaq",          en: "Groceries" },
  "Транспорт":    { az: "Nəqliyyat",      en: "Transport" },
  "Жильё":        { az: "Mənzil",         en: "Housing" },
  "Развлечения":  { az: "Əyləncə",        en: "Entertainment" },
  "Здоровье":     { az: "Sağlamlıq",      en: "Health" },
  "Одежда":       { az: "Geyim",          en: "Clothing" },
  "Образование":  { az: "Təhsil",         en: "Education" },
  "Рестораны":    { az: "Restoranlar",    en: "Restaurants" },
  "Связь":        { az: "Rabitə",         en: "Communication" },
  "Подписки":     { az: "Abunəliklər",    en: "Subscriptions" },
  "Подарки":      { az: "Hədiyyələr",     en: "Gifts" },
  "Зарплата":     { az: "Maaş",           en: "Salary" },
  "Фриланс":      { az: "Frilansinq",     en: "Freelance" },
  "Инвестиции":   { az: "İnvestisiyalar", en: "Investments" },
  "Другое":       { az: "Digər",          en: "Other" },
};

export type Lang = keyof typeof translations;
export type TranslationKey = keyof typeof translations.ru;

// ─── Context ─────────────────────────────────────────────────────────────────

type LanguageContextType = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey) => string;
  translateCategory: (ruName: string) => string;
};

const LanguageContext = createContext<LanguageContextType>({
  lang: "ru",
  setLang: () => {},
  t: (key) => translations.ru[key],
  translateCategory: (ruName) => ruName,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    // Try to read from localStorage first for instant load
    try {
      const stored = localStorage.getItem("cashual_lang") as Lang | null;
      if (stored && stored in translations) return stored;
    } catch {}
    return "ru";
  });

  // Sync with server-side preferredLanguage from auth.me
  const meQuery = trpc.auth.me.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const serverLang = meQuery.data?.preferredLanguage as Lang | undefined;
    if (serverLang && serverLang in translations && serverLang !== lang) {
      setLangState(serverLang);
      try {
        localStorage.setItem("cashual_lang", serverLang);
      } catch {}
    }
  // Only sync when server data arrives, not on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meQuery.data?.preferredLanguage]);

  const setLang = (newLang: Lang) => {
    setLangState(newLang);
    try {
      localStorage.setItem("cashual_lang", newLang);
    } catch {}
  };

  const t = (key: TranslationKey): string => {
    return (translations[lang] as any)[key] ?? (translations.ru as any)[key] ?? key;
  };

  // Translate a Russian category name to the current language
  const translateCategory = (ruName: string): string => {
    if (lang === "ru") return ruName;
    const entry = categoryTranslations[ruName];
    if (!entry) return ruName; // fallback: keep Russian for custom categories
    return lang === "az" ? entry.az : entry.en;
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, t, translateCategory }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
