import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, KeyRound, Plus, Trash2, Eye, EyeOff, Copy, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import type { BrandApiKey } from "@shared/schema";

export default function BrandSettingsApiKey() {
  const { toast } = useToast();
  const [newKeyName, setNewKeyName] = useState("");
  const [revealedRawKey, setRevealedRawKey] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: keys = [], isLoading } = useQuery<BrandApiKey[]>({
    queryKey: ["/api/brand/api-keys"],
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => apiRequest("POST", "/api/brand/api-keys", { name }),
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/brand/api-keys"] });
      setRevealedRawKey(data.rawKey);
      setShowRaw(true);
      setNewKeyName("");
      toast({ title: "API key created", description: "Copy it now — it won't be shown again." });
    },
    onError: () => toast({ title: "Error", description: "Could not create API key.", variant: "destructive" }),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/brand/api-keys/${id}`, undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brand/api-keys"] });
      toast({ title: "Key revoked", description: "The API key has been deactivated." });
    },
    onError: () => toast({ title: "Error", description: "Could not revoke key.", variant: "destructive" }),
  });

  const handleCopy = () => {
    if (!revealedRawKey) return;
    navigator.clipboard.writeText(revealedRawKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-2xl pb-12">
      <div className="flex items-center gap-3">
        <Link href="/brand/settings">
          <Button variant="ghost" size="icon" className="rounded-full" data-testid="button-back-settings">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API Keys</h1>
          <p className="text-muted-foreground text-sm">Manage keys for programmatic access to your account</p>
        </div>
      </div>

      {revealedRawKey && (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-medium flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" /> Key created — copy it now, it won't be shown again
            </p>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={showRaw ? revealedRawKey : "•".repeat(revealedRawKey.length)}
                className="font-mono text-xs bg-white dark:bg-black"
                data-testid="input-raw-api-key"
              />
              <Button variant="ghost" size="icon" onClick={() => setShowRaw(s => !s)} className="shrink-0">
                {showRaw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="icon" onClick={handleCopy} className="shrink-0" data-testid="button-copy-api-key">
                {copied ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4 w-4 text-muted-foreground" /> Create New Key
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="key-name">Key Name</Label>
            <Input
              id="key-name"
              placeholder="e.g. Production Integration"
              value={newKeyName}
              onChange={e => setNewKeyName(e.target.value)}
              data-testid="input-api-key-name"
            />
          </div>
          <Button
            className="rounded-full gap-2"
            disabled={!newKeyName.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate(newKeyName.trim())}
            data-testid="button-create-api-key"
          >
            <Plus className="h-4 w-4" />
            {createMutation.isPending ? "Creating…" : "Generate Key"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" /> Active Keys
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1,2].map(i => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
            </div>
          ) : keys.filter(k => k.isActive).length === 0 ? (
            <p className="text-center text-muted-foreground py-10 text-sm">No active API keys</p>
          ) : (
            keys.filter(k => k.isActive).map((k, i, arr) => (
              <div
                key={k.id}
                className={`flex items-center gap-4 px-4 py-3.5 ${i !== arr.length - 1 ? "border-b border-border" : ""}`}
                data-testid={`row-api-key-${k.id}`}
              >
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{k.name}</p>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">
                    {k.keyPrefix}•••••••••••• · created {k.createdAt ? format(new Date(k.createdAt), "d MMM yyyy") : ""}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full text-destructive hover:text-destructive"
                  onClick={() => revokeMutation.mutate(k.id)}
                  disabled={revokeMutation.isPending}
                  data-testid={`button-revoke-key-${k.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="p-4 rounded-xl bg-muted/50 text-sm text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Security notice</p>
        <p>API keys grant full access to your account. Never share them publicly or commit them to version control. Revoke immediately if compromised.</p>
      </div>
    </div>
  );
}
