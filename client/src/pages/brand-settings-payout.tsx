import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Wallet, Building2, Mail, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { BrandPayoutMethod } from "@shared/schema";

type MethodType = "bank_transfer" | "paypal";

export default function BrandSettingsPayout() {
  const { toast } = useToast();
  const [selectedType, setSelectedType] = useState<MethodType>("bank_transfer");

  const { data: method, isLoading } = useQuery<BrandPayoutMethod | null>({
    queryKey: ["/api/brand/payout-method"],
  });

  const [form, setForm] = useState({
    bankName: "",
    iban: "",
    bic: "",
    paypalEmail: "",
  });

  const mutation = useMutation({
    mutationFn: (data: object) => apiRequest("PUT", "/api/brand/payout-method", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brand/payout-method"] });
      toast({ title: "Payout method saved", description: "Your payout details have been updated." });
    },
    onError: () => toast({ title: "Error", description: "Could not save payout method.", variant: "destructive" }),
  });

  const handleSave = () => {
    mutation.mutate({ type: selectedType, ...form });
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
          <h1 className="text-2xl font-bold tracking-tight">Payout Method</h1>
          <p className="text-muted-foreground text-sm">Where we send your affiliate earnings</p>
        </div>
      </div>

      {isLoading ? <Skeleton className="h-64 w-full rounded-xl" /> : (
        <>
          {method && (
            <Card className="border-green-200 dark:border-green-800">
              <CardContent className="p-4 flex items-center gap-3">
                <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium">Active payout method</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {method.type === "bank_transfer"
                      ? `${method.bankName ?? "Bank transfer"} · IBAN ending ${method.iban?.slice(-4) ?? "****"}`
                      : `PayPal · ${method.paypalEmail}`}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Wallet className="h-4 w-4 text-muted-foreground" /> {method ? "Update Method" : "Add Payout Method"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex gap-2">
                {(["bank_transfer", "paypal"] as MethodType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setSelectedType(t)}
                    data-testid={`button-type-${t}`}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      selectedType === t
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted/50"
                    }`}
                  >
                    {t === "bank_transfer" ? <Building2 className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                    {t === "bank_transfer" ? "Bank Transfer" : "PayPal"}
                  </button>
                ))}
              </div>

              {selectedType === "bank_transfer" ? (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="bankName">Bank Name</Label>
                    <Input id="bankName" placeholder="e.g. Deutsche Bank" value={form.bankName}
                      onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))} data-testid="input-bank-name" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="iban">IBAN</Label>
                    <Input id="iban" placeholder="DE89 3704 0044 0532 0130 00" value={form.iban}
                      onChange={e => setForm(f => ({ ...f, iban: e.target.value }))} data-testid="input-iban" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bic">BIC / SWIFT</Label>
                    <Input id="bic" placeholder="COBADEFFXXX" value={form.bic}
                      onChange={e => setForm(f => ({ ...f, bic: e.target.value }))} data-testid="input-bic" />
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="paypalEmail">PayPal Email</Label>
                  <Input id="paypalEmail" type="email" placeholder="payouts@yourbrand.com" value={form.paypalEmail}
                    onChange={e => setForm(f => ({ ...f, paypalEmail: e.target.value }))} data-testid="input-paypal-email" />
                </div>
              )}

              <Button className="rounded-full" onClick={handleSave} disabled={mutation.isPending} data-testid="button-save-payout">
                {mutation.isPending ? "Saving…" : "Save Payout Method"}
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
