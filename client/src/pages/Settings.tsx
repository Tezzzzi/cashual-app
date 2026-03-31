import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Globe,
  Coins,
  Tag,
  Plus,
  Trash2,
  Loader2,
  LogOut,
  Info,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { useLanguage, type Lang } from "@/contexts/LanguageContext";

const EMOJI_OPTIONS = [
  "🛒", "🚗", "🏠", "🎬", "💊", "👕", "📚", "🍽️", "📱", "📺",
  "🎁", "💰", "💻", "📈", "📦", "✈️", "🏋️", "🎵", "🐕", "🧹",
];

const COLOR_OPTIONS = [
  "#22c55e", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444",
  "#ec4899", "#06b6d4", "#f97316", "#6366f1", "#a855f7",
];

export default function Settings() {
  const { isAuthenticated, user, logout } = useAuth();
  const { t, lang, setLang, translateCategory } = useLanguage();
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatIcon, setNewCatIcon] = useState("📦");
  const [newCatColor, setNewCatColor] = useState("#6366f1");
  const [newCatType, setNewCatType] = useState<"income" | "expense" | "both">("both");

  const { data: categories } = trpc.categories.list.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const utils = trpc.useUtils();

  const updateSettings = trpc.settings.update.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      toast.success(t("settings_saved"));
    },
    onError: (err) => toast.error(err.message),
  });

  const createCategory = trpc.categories.create.useMutation({
    onSuccess: () => {
      utils.categories.list.invalidate();
      setShowAddCategory(false);
      setNewCatName("");
      toast.success(t("category_created"));
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteCategory = trpc.categories.delete.useMutation({
    onSuccess: () => {
      utils.categories.list.invalidate();
      toast.success(t("category_deleted"));
    },
    onError: (err) => toast.error(err.message),
  });

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">{t("login_to_view")}</p>
      </div>
    );
  }

  const customCategories = categories?.filter((c) => !c.isPreset) || [];
  const presetCategories = categories?.filter((c) => c.isPreset) || [];

  const handleLanguageChange = (val: string) => {
    const newLang = val as Lang;
    // Update local state immediately for instant UI feedback
    setLang(newLang);
    // Persist to server
    updateSettings.mutate({ preferredLanguage: val });
  };

  return (
    <div className="px-4 pt-4 pb-8 space-y-4 max-w-lg mx-auto">
      {/* Header */}
      <h1 className="text-xl font-bold">{t("settings_title")}</h1>

      {/* User Info */}
      <div className="tg-card flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center text-lg font-bold">
          {(user?.telegramFirstName || user?.name || "U")[0]}
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold">
            {user?.telegramFirstName || user?.name || t("user_fallback")}
          </p>
          <p className="text-xs text-muted-foreground">
            {user?.email || user?.telegramUsername || ""}
          </p>
        </div>
      </div>

      {/* Language */}
      <div className="tg-card space-y-3">
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t("interface_language")}</span>
        </div>
        <Select
          value={lang}
          onValueChange={handleLanguageChange}
        >
          <SelectTrigger className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ru">🇷🇺 Русский</SelectItem>
            <SelectItem value="az">🇦🇿 Azərbaycanca</SelectItem>
            <SelectItem value="en">🇬🇧 English</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Currency */}
      <div className="tg-card space-y-3">
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t("default_currency")}</span>
        </div>
        <Select
          value={user?.preferredCurrency || "AZN"}
          onValueChange={(val) => updateSettings.mutate({ preferredCurrency: val })}
        >
          <SelectTrigger className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="AZN">AZN — Manat</SelectItem>
            <SelectItem value="RUB">RUB — Рубль</SelectItem>
            <SelectItem value="USD">USD — Dollar</SelectItem>
            <SelectItem value="EUR">EUR — Euro</SelectItem>
            <SelectItem value="TRY">TRY — Lira</SelectItem>
            <SelectItem value="GEL">GEL — Lari</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Default Budget */}
      <div className="tg-card space-y-3">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-muted-foreground" />
          <div>
            <span className="text-sm font-medium">{t("default_budget")}</span>
            <p className="text-[10px] text-muted-foreground">{t("default_budget_desc")}</p>
          </div>
        </div>
        <Select
          value={user?.defaultBudget || "personal"}
          onValueChange={(val) => updateSettings.mutate({ defaultBudget: val as "personal" | "family" })}
        >
          <SelectTrigger className="h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="personal">{t("default_budget_personal")}</SelectItem>
            <SelectItem value="family">{t("default_budget_family")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Categories */}
      <div className="tg-card space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t("categories")}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddCategory(true)}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t("add_category")}
          </Button>
        </div>

        {/* Custom categories */}
        {customCategories.length > 0 && (
          <div>
            <p className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wider">
              {t("your_categories")}
            </p>
            <div className="space-y-1.5">
              {customCategories.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between py-1.5"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="w-6 h-6 rounded-full flex items-center justify-center text-xs"
                      style={{ backgroundColor: c.color + "30" }}
                    >
                      {c.icon}
                    </span>
                    <span className="text-sm">{translateCategory(c.name)}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={() => deleteCategory.mutate({ id: c.id })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Preset categories */}
        <div>
          <p className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wider">
            {t("preset_categories")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {presetCategories.map((c) => (
              <span
                key={c.id}
                className="text-xs px-2 py-1 rounded-full bg-secondary"
              >
                {c.icon} {translateCategory(c.name)}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="tg-card space-y-2">
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t("about")}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("about_text")}
        </p>
      </div>

      {/* Logout */}
      <Button
        variant="outline"
        className="w-full h-12 text-destructive border-destructive/20"
        onClick={() => logout()}
      >
        <LogOut className="h-4 w-4 mr-2" />
        {t("logout")}
      </Button>

      {/* Add Category Dialog */}
      <Dialog open={showAddCategory} onOpenChange={setShowAddCategory}>
        <DialogContent className="max-w-md mx-auto max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("new_category")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder={t("category_name")}
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              className="h-12"
            />

            {/* Icon picker */}
            <div>
              <p className="text-xs text-muted-foreground mb-2">{t("icon")}</p>
              <div className="flex flex-wrap gap-2">
                {EMOJI_OPTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all ${
                      newCatIcon === emoji
                        ? "bg-primary/20 ring-2 ring-primary"
                        : "bg-secondary hover:bg-secondary/80"
                    }`}
                    onClick={() => setNewCatIcon(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            {/* Color picker */}
            <div>
              <p className="text-xs text-muted-foreground mb-2">{t("color")}</p>
              <div className="flex flex-wrap gap-2">
                {COLOR_OPTIONS.map((color) => (
                  <button
                    key={color}
                    className={`w-8 h-8 rounded-full transition-all ${
                      newCatColor === color
                        ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                        : ""
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setNewCatColor(color)}
                  />
                ))}
              </div>
            </div>

            {/* Type */}
            <Select
              value={newCatType}
              onValueChange={(v) => setNewCatType(v as any)}
            >
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="both">{t("income_expense")}</SelectItem>
                <SelectItem value="expense">{t("expense_only")}</SelectItem>
                <SelectItem value="income">{t("income_only")}</SelectItem>
              </SelectContent>
            </Select>

            <Button
              className="w-full h-12"
              onClick={() =>
                createCategory.mutate({
                  name: newCatName,
                  icon: newCatIcon,
                  color: newCatColor,
                  type: newCatType,
                })
              }
              disabled={!newCatName.trim() || createCategory.isPending}
            >
              {createCategory.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t("create")
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
