import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Building2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { BrandBillingProfile } from "@shared/schema";

const COUNTRIES = [
  "Australia", "Austria", "Belgium", "Canada", "Denmark", "Finland", "France", "Germany",
  "Ireland", "Italy", "Luxembourg", "Netherlands", "New Zealand", "Norway", "Portugal",
  "Spain", "Sweden", "Switzerland", "United Kingdom", "United States",
];

export default function BrandSettingsBillingAddress() {
  const { toast } = useToast();

  const { data: profile, isLoading } = useQuery<BrandBillingProfile | null>({
    queryKey: ["/api/brand/billing-profile"],
  });

  const [form, setForm] = useState({
    companyName: "",
    vatNumber: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
  });

  useEffect(() => {
    if (profile) {
      setForm({
        companyName:  profile.companyName  ?? "",
        vatNumber:    profile.vatNumber    ?? "",
        addressLine1: profile.addressLine1 ?? "",
        addressLine2: profile.addressLine2 ?? "",
        city:         profile.city         ?? "",
        state:        profile.state        ?? "",
        postalCode:   profile.postalCode   ?? "",
        country:      profile.country      ?? "",
      });
    }
  }, [profile]);

  const mutation = useMutation({
    mutationFn: (data: object) => apiRequest("PUT", "/api/brand/billing-profile", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brand/billing-profile"] });
      toast({ title: "Billing address saved", description: "Your business information has been updated." });
    },
    onError: () => toast({ title: "Error", description: "Could not save billing address.", variant: "destructive" }),
  });

  const field = (id: keyof typeof form, label: string, placeholder: string, type = "text") => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} placeholder={placeholder} value={form[id]}
        onChange={e => setForm(f => ({ ...f, [id]: e.target.value }))}
        data-testid={`input-${id}`} />
    </div>
  );

  return (
    <div className="space-y-6 max-w-2xl pb-12">
      <div className="flex items-center gap-3">
        <Link href="/brand/settings">
          <Button variant="ghost" size="icon" className="rounded-full" data-testid="button-back-settings">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Billing Address</h1>
          <p className="text-muted-foreground text-sm">Business information used on invoices</p>
        </div>
      </div>

      {isLoading ? <Skeleton className="h-96 w-full rounded-xl" /> : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" /> Business Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {field("companyName",  "Company Name",   "Acme Brand GmbH")}
            {field("vatNumber",    "VAT Number",     "DE123456789")}
            {field("addressLine1", "Address Line 1", "Hauptstraße 1")}
            {field("addressLine2", "Address Line 2 (optional)", "Suite 200")}
            <div className="grid grid-cols-2 gap-4">
              {field("city",       "City",        "Berlin")}
              {field("state",      "State / Region", "Brandenburg")}
            </div>
            <div className="grid grid-cols-2 gap-4">
              {field("postalCode", "Postal Code", "10115")}
              <div className="space-y-1.5">
                <Label htmlFor="country">Country</Label>
                <select
                  id="country"
                  value={form.country}
                  onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
                  data-testid="select-country"
                  className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <option value="">Select country</option>
                  {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <Button className="rounded-full" onClick={() => mutation.mutate(form)} disabled={mutation.isPending} data-testid="button-save-billing-address">
              {mutation.isPending ? "Saving…" : "Save Address"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
