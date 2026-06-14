import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  Download,
  Send,
  Eye,
  AlertTriangle,
  Bell,
  Camera,
  Smartphone,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { useLanguage, type Lang } from "@/contexts/LanguageContext";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

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
  const [profileName, setProfileName] = useState("");
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null);
  const [isProcessingAvatar, setIsProcessingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  // Delete all data flow
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showSaveCsvDialog, setShowSaveCsvDialog] = useState(false);
  const [showFinalConfirm, setShowFinalConfirm] = useState(false);
  const [csvPreview, setCsvPreview] = useState<{ csv: string; filename: string } | null>(null);
  const [showCsvPreview, setShowCsvPreview] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

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

  const exportCsv = trpc.reports.exportCsv.useMutation();
  const sendCsvToTelegram = trpc.reports.sendCsvToTelegram.useMutation();
  const deleteAllData = trpc.settings.deleteAllData.useMutation();

  useEffect(() => {
    if (!isAuthenticated || !user || user.timezone) return;
    const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detectedTimeZone) {
      updateSettings.mutate({ timezone: detectedTimeZone });
    }
    // Store timezone only once when it is missing, without re-running for mutation identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?.id, user?.timezone]);

  useEffect(() => {
    if (!user) return;
    setProfileName(user.customDisplayName || user.telegramFirstName || user.name || "");
    setProfileAvatar(user.customAvatarUrl || null);
  }, [user?.id, user?.customDisplayName, user?.customAvatarUrl, user?.telegramFirstName, user?.name]);

  const resizeAvatarToBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Failed to read avatar image"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Failed to load avatar image"));
        img.onload = () => {
          const maxSize = 200;
          const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
          const width = Math.max(1, Math.round(img.width * scale));
          const height = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Canvas is not supported"));
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.85));
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("profile_avatar_invalid"));
      return;
    }
    setIsProcessingAvatar(true);
    try {
      const resized = await resizeAvatarToBase64(file);
      setProfileAvatar(resized);
    } catch (err: any) {
      toast.error(err?.message || t("profile_avatar_invalid"));
    } finally {
      setIsProcessingAvatar(false);
      event.target.value = "";
    }
  };

  const displayAvatar = profileAvatar || user?.telegramPhotoUrl || null;

  const handleSaveProfile = () => {
    const trimmedName = profileName.trim();
    updateSettings.mutate({
      customDisplayName: trimmedName || null,
      customAvatarUrl: profileAvatar || null,
    });
  };

  const handleRemindersToggle = (checked: boolean) => {
    const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    updateSettings.mutate({
      remindersEnabled: checked,
      timezone: user?.timezone || detectedTimeZone || undefined,
    });
  };

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
    setLang(newLang);
    updateSettings.mutate({ preferredLanguage: val });
  };

  // --- Delete All Data Flow ---

  const handleDeleteAllClick = () => {
    setShowDeleteDialog(true);
  };

  // Step 1: User chose to save CSV first
  const handleSaveCsvFirst = () => {
    setShowDeleteDialog(false);
    setShowSaveCsvDialog(true);
  };

  // Step 1 alt: User chose to skip CSV and go straight to delete
  const handleSkipCsv = () => {
    setShowDeleteDialog(false);
    setShowFinalConfirm(true);
  };

  // Download CSV
  const handleDownloadCsv = async () => {
    try {
      const result = await exportCsv.mutateAsync({});
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("csv_downloaded"));
    } catch (err: any) {
      toast.error(err.message || "Error");
    }
  };

  // Send CSV to Telegram
  const handleSendTelegram = async () => {
    try {
      const result = await sendCsvToTelegram.mutateAsync({});
      toast.success(`${t("csv_sent_telegram")} (${result.transactionCount})`);
    } catch (err: any) {
      toast.error(err.message || "Error");
    }
  };

  // Preview CSV
  const handlePreviewCsv = async () => {
    try {
      const result = await exportCsv.mutateAsync({});
      setCsvPreview(result);
      setShowCsvPreview(true);
    } catch (err: any) {
      toast.error(err.message || "Error");
    }
  };

  // After saving CSV, proceed to final confirm
  const handleProceedToDelete = () => {
    setShowSaveCsvDialog(false);
    setShowFinalConfirm(true);
  };

  // Final delete
  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      const result = await deleteAllData.mutateAsync();
      setShowFinalConfirm(false);
      setIsDeleting(false);
      toast.success(`${t("all_data_deleted")} (${result.deletedCount})`);
      // Invalidate all queries
      utils.invalidate();
    } catch (err: any) {
      setIsDeleting(false);
      toast.error(err.message || "Error");
    }
  };

  // Parse CSV for preview table
  const parseCsvForPreview = (csv: string) => {
    const lines = csv.replace(/^\uFEFF/, "").split("\n").filter(Boolean);
    if (lines.length === 0) return { headers: [], rows: [] };
    // Simple CSV parse (handles quoted fields)
    const parseLine = (line: string) => {
      const result: string[] = [];
      let current = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === "," && !inQuotes) {
          result.push(current);
          current = "";
        } else {
          current += ch;
        }
      }
      result.push(current);
      return result;
    };
    const headers = parseLine(lines[0]);
    const rows = lines.slice(1).map(parseLine);
    return { headers, rows };
  };

  return (
    <div className="px-5 pt-6 pb-28 space-y-6 max-w-lg mx-auto">
      {/* Header */}
      <h1 className="text-2xl font-bold tracking-tight">{t("settings_title")}</h1>

      {/* Profile */}
      <div className="tg-card space-y-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="relative shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
            onClick={() => avatarInputRef.current?.click()}
            aria-label={t("profile_change_avatar")}
          >
            <Avatar className="h-16 w-16 border border-border/60 shadow-sm">
              {displayAvatar ? <AvatarImage src={displayAvatar} alt={profileName || t("user_fallback")} /> : null}
              <AvatarFallback className="bg-primary/10 text-lg font-bold">
                {(profileName || user?.telegramFirstName || user?.name || "U")[0]?.toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md">
              {isProcessingAvatar ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t("profile_section_title")}</p>
            <p className="truncate text-xs text-muted-foreground">
              {user?.email || user?.telegramUsername || ""}
            </p>
          </div>
        </div>

        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleAvatarChange}
        />

        <div className="space-y-2">
          <Input
            value={profileName}
            onChange={(event) => setProfileName(event.target.value)}
            placeholder={t("profile_name_placeholder")}
            maxLength={128}
          />
          <Button
            className="w-full"
            onClick={handleSaveProfile}
            disabled={updateSettings.isPending || isProcessingAvatar}
          >
            {updateSettings.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t("profile_save")}
          </Button>
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
            <SelectItem value="GBP">GBP — Pound</SelectItem>
            <SelectItem value="CHF">CHF — Franc</SelectItem>
            <SelectItem value="UAH">UAH — Гривна</SelectItem>
            <SelectItem value="KZT">KZT — Тенге</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Reminders */}
      <div className="tg-card space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <div>
              <span className="text-sm font-medium">{t("reminders")}</span>
              <p className="text-[10px] text-muted-foreground">{t("reminders_desc")}</p>
            </div>
          </div>
          <Switch
            checked={user?.remindersEnabled ?? true}
            onCheckedChange={handleRemindersToggle}
            disabled={updateSettings.isPending}
            aria-label={t("reminders")}
          />
        </div>
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

      {/* Apple Wallet */}
      <WalletSection />

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

      {/* Delete All Data */}
      <div className="tg-card space-y-2 border border-destructive/20">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <span className="text-sm font-medium text-destructive">{t("danger_zone")}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("delete_all_data_desc")}
        </p>
        <Button
          variant="destructive"
          className="w-full h-10"
          onClick={handleDeleteAllClick}
        >
          <Trash2 className="h-4 w-4 mr-2" />
          {t("delete_all_data")}
        </Button>
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

      {/* ─── Step 1: Save CSV before deleting? ─── */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delete_all_data")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("delete_save_csv_prompt")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              className="w-full"
              onClick={handleSaveCsvFirst}
            >
              <Download className="h-4 w-4 mr-2" />
              {t("save_csv_first")}
            </Button>
            <Button
              variant="destructive"
              className="w-full"
              onClick={handleSkipCsv}
            >
              {t("delete_without_saving")}
            </Button>
            <AlertDialogCancel className="w-full mt-0">
              {t("cancel")}
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Step 2: CSV Save Options ─── */}
      <Dialog open={showSaveCsvDialog} onOpenChange={setShowSaveCsvDialog}>
        <DialogContent className="max-w-md mx-auto">
          <DialogHeader>
            <DialogTitle>{t("save_csv_title")}</DialogTitle>
            <DialogDescription>
              {t("save_csv_desc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full h-12 justify-start"
              onClick={handleDownloadCsv}
              disabled={exportCsv.isPending}
            >
              {exportCsv.isPending ? (
                <Loader2 className="h-4 w-4 mr-3 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-3" />
              )}
              {t("csv_download")}
            </Button>
            <Button
              variant="outline"
              className="w-full h-12 justify-start"
              onClick={handleSendTelegram}
              disabled={sendCsvToTelegram.isPending}
            >
              {sendCsvToTelegram.isPending ? (
                <Loader2 className="h-4 w-4 mr-3 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-3" />
              )}
              {t("csv_send_telegram")}
            </Button>
            <Button
              variant="outline"
              className="w-full h-12 justify-start"
              onClick={handlePreviewCsv}
              disabled={exportCsv.isPending}
            >
              {exportCsv.isPending ? (
                <Loader2 className="h-4 w-4 mr-3 animate-spin" />
              ) : (
                <Eye className="h-4 w-4 mr-3" />
              )}
              {t("csv_preview")}
            </Button>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col mt-4">
            <Button
              variant="destructive"
              className="w-full"
              onClick={handleProceedToDelete}
            >
              {t("proceed_to_delete")}
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setShowSaveCsvDialog(false)}
            >
              {t("cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── CSV Preview Modal ─── */}
      {csvPreview && showCsvPreview && (
        <Dialog open={showCsvPreview} onOpenChange={setShowCsvPreview}>
          <DialogContent className="max-w-[95vw] max-h-[85vh] p-0 overflow-hidden">
            <div
              style={{
                background: "#ffffff",
                color: "#000000",
                width: "100%",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                maxHeight: "85vh",
              }}
            >
              {/* Header bar */}
              <div
                style={{
                  padding: "12px 16px",
                  borderBottom: "1px solid #e5e7eb",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexShrink: 0,
                }}
              >
                <span style={{ fontWeight: 600, fontSize: "14px", color: "#000" }}>
                  {csvPreview.filename}
                </span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    onClick={handleDownloadCsv}
                    style={{
                      padding: "4px 10px",
                      fontSize: "12px",
                      background: "#3b82f6",
                      color: "#fff",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                    }}
                  >
                    Download
                  </button>
                  <button
                    onClick={handleSendTelegram}
                    style={{
                      padding: "4px 10px",
                      fontSize: "12px",
                      background: "#0ea5e9",
                      color: "#fff",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                    }}
                  >
                    Telegram
                  </button>
                </div>
              </div>
              {/* Table */}
              <div style={{ overflow: "auto", flex: 1 }}>
                {(() => {
                  const { headers, rows } = parseCsvForPreview(csvPreview.csv);
                  return (
                    <table
                      style={{
                        borderCollapse: "collapse",
                        width: "100%",
                        fontSize: "11px",
                        color: "#000000",
                        background: "#ffffff",
                      }}
                    >
                      <thead>
                        <tr>
                          {headers.map((h, i) => (
                            <th
                              key={i}
                              style={{
                                padding: "6px 8px",
                                background: "#e5e7eb",
                                color: "#000",
                                fontWeight: 600,
                                textAlign: "left",
                                borderBottom: "2px solid #d1d5db",
                                whiteSpace: "nowrap",
                                position: "sticky",
                                top: 0,
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, ri) => (
                          <tr key={ri}>
                            {row.map((cell, ci) => (
                              <td
                                key={ci}
                                style={{
                                  padding: "4px 8px",
                                  borderBottom: "1px solid #e5e7eb",
                                  background: ri % 2 === 0 ? "#ffffff" : "#f9fafb",
                                  color: "#000000",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })()}
              </div>
              {/* Footer */}
              <div
                style={{
                  padding: "8px 16px",
                  borderTop: "1px solid #e5e7eb",
                  fontSize: "12px",
                  color: "#6b7280",
                  flexShrink: 0,
                }}
              >
                {parseCsvForPreview(csvPreview.csv).rows.length} {t("csv_rows")}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ─── Step 3: Final Confirmation ─── */}
      <AlertDialog open={showFinalConfirm} onOpenChange={setShowFinalConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              {t("final_delete_title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("final_delete_desc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              {t("confirm_delete_all")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

// ─── Apple Wallet Section ─────────────────────────────────────────────────────

const WEBHOOK_URL = "https://cashual-production.up.railway.app/api/wallet/transaction";

function WalletSection() {
  const { t } = useLanguage();
  const [showInstructions, setShowInstructions] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const utils = trpc.useUtils();

  const { data: tokenData, isLoading } = trpc.settings.getWalletToken.useQuery();

  const generateToken = trpc.settings.generateWalletToken.useMutation({
    onSuccess: () => {
      utils.settings.getWalletToken.invalidate();
      toast.success(t("wallet_token_generated"));
    },
    onError: (err) => toast.error(err.message),
  });

  const walletToken = tokenData?.walletToken || null;

  const handleConnect = () => {
    if (!walletToken) {
      generateToken.mutate();
    }
    setShowInstructions(true);
  };

  const handleRegenerate = () => {
    generateToken.mutate();
  };

  const copyToClipboard = useCallback(async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      toast.success(t("wallet_copied"));
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Fallback for environments where clipboard API is unavailable
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopiedField(field);
      toast.success(t("wallet_copied"));
      setTimeout(() => setCopiedField(null), 2000);
    }
  }, [t]);

  if (isLoading) {
    return (
      <div className="tg-card space-y-3">
        <div className="flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t("wallet_title")}</span>
        </div>
        <div className="flex justify-center py-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="tg-card space-y-3">
      <div className="flex items-center gap-2">
        <Smartphone className="h-4 w-4 text-muted-foreground" />
        <div>
          <span className="text-sm font-medium">{t("wallet_title")}</span>
          <p className="text-[10px] text-muted-foreground">{t("wallet_description")}</p>
        </div>
      </div>

      {!walletToken && !showInstructions && (
        <Button
          className="w-full"
          onClick={handleConnect}
          disabled={generateToken.isPending}
        >
          {generateToken.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Wallet className="mr-2 h-4 w-4" />
          )}
          {t("wallet_connect")}
        </Button>
      )}

      {walletToken && !showInstructions && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-green-600">
            <Check className="h-3.5 w-3.5" />
            <span>{t("wallet_connected")}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setShowInstructions(true)}
          >
            {t("wallet_show_instructions")}
            <ChevronDown className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {showInstructions && walletToken && (
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">{t("wallet_setup_title")}</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setShowInstructions(false)}
            >
              {t("wallet_hide_instructions")}
              <ChevronUp className="ml-1 h-3 w-3" />
            </Button>
          </div>

          <ol className="space-y-1.5 text-xs text-muted-foreground list-decimal list-inside">
            <li>{t("wallet_step_1")}</li>
            <li>{t("wallet_step_2")}</li>
            <li>{t("wallet_step_3")}</li>
            <li>{t("wallet_step_4")}</li>
          </ol>

          {/* URL */}
          <div className="space-y-1">
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("wallet_url_label")}
            </label>
            <div className="flex items-center gap-1.5">
              <code className="flex-1 text-[10px] bg-secondary/50 rounded px-2 py-1.5 break-all font-mono">
                {WEBHOOK_URL}
              </code>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => copyToClipboard(WEBHOOK_URL, "url")}
              >
                {copiedField === "url" ? (
                  <Check className="h-3 w-3 text-green-600" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </div>
          </div>

          {/* Token */}
          <div className="space-y-1">
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("wallet_token_label")}
            </label>
            <div className="flex items-center gap-1.5">
              <code className="flex-1 text-[10px] bg-secondary/50 rounded px-2 py-1.5 break-all font-mono">
                {walletToken}
              </code>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => copyToClipboard(walletToken, "token")}
              >
                {copiedField === "token" ? (
                  <Check className="h-3 w-3 text-green-600" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </div>
          </div>

          {/* Request details */}
          <div className="space-y-1.5 text-[10px] bg-secondary/30 rounded-md p-2.5">
            <p className="font-medium">{t("wallet_method")}</p>
            <p className="font-medium">{t("wallet_headers")}</p>
            <code className="block text-muted-foreground pl-2 font-mono">
              Authorization: Bearer {"<token>"}
            </code>
            <code className="block text-muted-foreground pl-2 font-mono">
              Content-Type: application/json
            </code>
            <p className="font-medium pt-1">{t("wallet_body")}</p>
            <pre className="text-muted-foreground pl-2 font-mono whitespace-pre-wrap">
{`{
  "amount": <Amount>,
  "merchant": "<Merchant>",
  "currency": "<Currency Code>",
  "date": "<ISO Date>",
  "cardName": "<Card Name>"
}`}
            </pre>
            <p className="text-muted-foreground italic pt-1">{t("wallet_body_hint")}</p>
          </div>

          {/* Regenerate token */}
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={handleRegenerate}
            disabled={generateToken.isPending}
          >
            {generateToken.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : null}
            {t("wallet_regenerate")}
          </Button>
        </div>
      )}
    </div>
  );
}
