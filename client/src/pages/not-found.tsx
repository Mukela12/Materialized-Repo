/**
 * The page shown when a URL matches nothing.
 *
 * It used to read, in full: "404 Page Not Found — Did you forget to add the
 * page to the router?" That is a note from one developer to another, and it was
 * being shown to the client, on her own product, between demo calls. It tells
 * the reader nothing about what happened and offers no way out, so the only
 * conclusion available to them is that the site is broken.
 *
 * What actually produces this is nearly always a mistyped or stale address —
 * `/Admin` rather than `/admin`, or a link from an old email. So the page now
 * says which address failed, why that usually happens, and offers the way back.
 */
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowLeft, Home } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";

/** Where "home" is depends on which portal the person belongs to. */
const HOME_FOR: Record<string, string> = {
  creator: "/creator",
  brand: "/brand",
  affiliate: "/affiliate",
};

export default function NotFound() {
  const [location, navigate] = useLocation();
  const { data: user } = useCurrentUser();
  const home = user ? (HOME_FOR[user.role] ?? "/creator") : "/";

  return (
    <div className="min-h-[60vh] w-full flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6">
          <div className="flex mb-3 gap-2 items-center">
            <AlertCircle className="h-6 w-6 text-destructive shrink-0" />
            <h1 className="text-xl font-bold text-foreground">This page doesn't exist</h1>
          </div>

          <p className="text-sm text-muted-foreground">
            Nothing is here:{" "}
            <code className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded break-all">
              {location}
            </code>
          </p>
          <p className="text-sm text-muted-foreground mt-3">
            Usually a mistyped address or an old link. Web addresses are
            case-sensitive, so <code className="font-mono text-xs">/Admin</code> is not the
            same as <code className="font-mono text-xs">/admin</code>.
          </p>

          <div className="flex gap-2 mt-5">
            <Button onClick={() => navigate(home)} className="gap-1.5" data-testid="button-404-home">
              <Home className="h-3.5 w-3.5" />
              Go to my dashboard
            </Button>
            <Button
              variant="outline"
              onClick={() => window.history.back()}
              className="gap-1.5"
              data-testid="button-404-back"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </Button>
          </div>

          {user?.isAdmin && (
            <p className="text-xs text-muted-foreground mt-4">
              Looking for the admin area? It's{" "}
              <button
                onClick={() => navigate("/admin")}
                className="underline hover:text-foreground"
                data-testid="link-404-admin"
              >
                /admin
              </button>
              , or use Switch Portal at the top of any page.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
