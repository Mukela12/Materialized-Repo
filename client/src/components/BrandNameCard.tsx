/**
 * The brand's name, editable by its owner. A brand is named from the sign-up
 * form's "Your name or brand name", so someone who typed their own name had
 * no way to put the company's name on it, and that name is what creators see
 * when they tag a brand.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { apiRequest, queryClient, serverMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function BrandNameCard() {
  const { toast } = useToast();
  const { data: brand } = useQuery<{ id: string; name: string }>({ queryKey: ["/api/brands/mine"] });
  const [name, setName] = useState("");
  useEffect(() => { if (brand) setName(brand.name); }, [brand?.id, brand?.name]);

  const save = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", `/api/brands/${brand!.id}`, { name })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brands/mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/brands"] });
      toast({ title: "Brand name saved" });
    },
    onError: async (err: any) => {
      const detail = serverMessage(err);
      toast({ title: "Could not save the name", description: detail || undefined, variant: "destructive" });
    },
  });

  if (!brand) return null;
  const trimmed = name.trim();
  const changed = trimmed !== brand.name && trimmed.length >= 2;

  return (
    <Card data-testid="card-brand-name">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4" /> Brand name</CardTitle>
        <CardDescription>What creators see when they tag your brand, and what invitations say.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => { e.preventDefault(); if (changed) save.mutate(); }}
        >
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="brand-name">Name</Label>
            <Input id="brand-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} data-testid="input-brand-name" />
          </div>
          <Button type="submit" disabled={!changed || save.isPending} data-testid="button-save-brand-name">
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
