import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { Briefcase, Plus, Trash2, Pencil, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";

export default function Business() {
  const { isAuthenticated } = useAuth();
  const { t } = useLanguage();

  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("💼");
  const [editName, setEditName] = useState("");
  const [editIcon, setEditIcon] = useState("💼");

  const { data: groups, isLoading } = trpc.business.myGroups.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const utils = trpc.useUtils();

  const createGroup = trpc.business.create.useMutation({
    onSuccess: () => {
      utils.business.myGroups.invalidate();
      setShowCreate(false);
      setName("");
      setIcon("💼");
      toast.success(t("business_group_created"));
    },
    onError: (err) => toast.error(err.message),
  });

  const updateGroup = trpc.business.update.useMutation({
    onSuccess: () => {
      utils.business.myGroups.invalidate();
      setEditingId(null);
      toast.success(t("business_group_updated"));
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteGroup = trpc.business.delete.useMutation({
    onSuccess: () => {
      utils.business.myGroups.invalidate();
      setDeletingId(null);
      toast.success(t("business_group_deleted"));
    },
    onError: (err) => toast.error(err.message),
  });

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <p className="text-muted-foreground">{t("login_to_view")}</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-blue-500" />
          <h1 className="text-xl font-bold">{t("business_title")}</h1>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" />
          {t("business_add_group")}
        </Button>
      </div>

      {/* Description */}
      <p className="text-sm text-muted-foreground">{t("business_desc")}</p>

      {/* Groups list */}
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !groups || groups.length === 0 ? (
        <div className="text-center py-12 space-y-3">
          <div className="text-4xl">💼</div>
          <p className="text-muted-foreground">{t("no_business_groups")}</p>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {t("business_add_group")}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => (
            <div
              key={group.id}
              className="flex items-center justify-between p-4 rounded-xl border bg-card"
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-xl"
                  style={{ backgroundColor: group.color + "22" }}
                >
                  {group.icon}
                </div>
                <div>
                  <p className="font-semibold">{group.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(group.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setEditingId(group.id);
                    setEditName(group.name);
                    setEditIcon(group.icon);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeletingId(group.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("business_new_group")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="flex gap-2">
              <Input
                placeholder="💼"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                className="w-16 text-center text-xl"
                maxLength={2}
              />
              <Input
                placeholder={t("business_group_name_placeholder")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="flex-1 h-12"
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowCreate(false)}>
                {t("cancel")}
              </Button>
              <Button
                className="flex-1"
                disabled={!name.trim() || createGroup.isPending}
                onClick={() => createGroup.mutate({ name: name.trim(), icon })}
              >
                {createGroup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("create")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={editingId !== null} onOpenChange={(open) => !open && setEditingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("business_edit_group")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="flex gap-2">
              <Input
                placeholder="💼"
                value={editIcon}
                onChange={(e) => setEditIcon(e.target.value)}
                className="w-16 text-center text-xl"
                maxLength={2}
              />
              <Input
                placeholder={t("business_group_name_placeholder")}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="flex-1 h-12"
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setEditingId(null)}>
                {t("cancel")}
              </Button>
              <Button
                className="flex-1"
                disabled={!editName.trim() || updateGroup.isPending}
                onClick={() =>
                  editingId !== null &&
                  updateGroup.mutate({ id: editingId, name: editName.trim(), icon: editIcon })
                }
              >
                {updateGroup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deletingId !== null} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("business_delete_confirm")}</AlertDialogTitle>
            <AlertDialogDescription>{t("business_delete_desc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingId !== null && deleteGroup.mutate({ id: deletingId })}
            >
              {deleteGroup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
