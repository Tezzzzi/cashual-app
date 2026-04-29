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
            <SelectItem value="GBP">GBP — Pound</SelectItem>
            <SelectItem value="CHF">CHF — Franc</SelectItem>
            <SelectItem value="UAH">UAH — Гривна</SelectItem>
            <SelectItem value="KZT">KZT — Тенге</SelectItem>
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
