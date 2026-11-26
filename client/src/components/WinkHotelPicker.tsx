/**
 * Put a WINK hotel in a video's carousel.
 *
 * The creator types a city or a hotel's name, picks a hotel, and it becomes a
 * card with WINK's photo, its lowest rate as a "from" label, and a BOOK NOW
 * button that opens WINK's booking page credited to MTRLZD. The hotel's
 * details are fetched again on the server when it is added, so nothing typed
 * here becomes the card.
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, serverMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BedDouble, Search, Star, Loader2 } from "lucide-react";

export interface WinkHotel {
  urlName: string;
  name: string;
  city: string | null;
  country: string | null;
  imageUrl: string | null;
  stars: number | null;
  fromPrice: string | null;
}

export function WinkHotelPicker({ videoId, onAdded }: { videoId: string; onAdded?: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: status } = useQuery<{ enabled: boolean; testMode?: boolean }>({ queryKey: ["/api/wink/status"] });
  const [typed, setTyped] = useState("");
  const [term, setTerm] = useState("");

  // Search once typing pauses, not on every key: each search is two calls to WINK.
  useEffect(() => {
    const t = setTimeout(() => setTerm(typed.trim()), 450);
    return () => clearTimeout(t);
  }, [typed]);

  const { data, isFetching, error } = useQuery<{ hotels: WinkHotel[] }>({
    queryKey: [`/api/wink/hotels?q=${encodeURIComponent(term)}`],
    enabled: term.length >= 2,
    staleTime: 5 * 60_000,
  });
  const hotels = data?.hotels ?? [];

  const addHotel = useMutation({
    mutationFn: async (h: WinkHotel) => apiRequest("POST", `/api/videos/${videoId}/hotels`, { urlName: h.urlName }),
    onSuccess: (_res, h) => {
      queryClient.invalidateQueries({ queryKey: ["/api/videos", videoId, "overlays"] });
      toast({ title: "Hotel added", description: `${h.name} is in the carousel with a Book Now button.` });
      onAdded?.();
    },
    onError: (err: unknown) =>
      toast({ title: "Couldn't add the hotel", description: serverMessage(err) || "Try again in a moment.", variant: "destructive" }),
  });

  return (
    <div className="space-y-2 border border-border rounded-lg p-3 bg-background" data-testid="wink-hotel-picker">
      <div className="space-y-1">
        <Label className="text-xs" htmlFor="wink-hotel-search">City or hotel</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id="wink-hotel-search"
            data-testid="input-wink-search"
            placeholder="e.g. Bangkok"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="h-8 pl-7 text-sm"
            autoComplete="off"
          />
          {isFetching && (
            <Loader2 className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" aria-label="Searching" />
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Hotels on WINK. Viewers book on WINK's page and MTRLZD earns commission on every stay.
        </p>
        {status?.testMode && (
          <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="text-wink-test-mode">
            Test mode: these are WINK's sample hotels and only admin accounts can see this.
          </p>
        )}
      </div>

      {error ? (
        <p className="text-xs text-destructive" data-testid="text-wink-error">{serverMessage(error) || "Couldn't search WINK."}</p>
      ) : term.length >= 2 && !isFetching && hotels.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2" data-testid="text-wink-empty">
          No WINK hotels for "{term}". Try the city's name.
        </p>
      ) : null}

      {hotels.length > 0 && (
        <ul className="max-h-72 space-y-1 overflow-y-auto" data-testid="list-wink-hotels">
          {hotels.map((h) => (
            <li key={h.urlName} className="flex items-center gap-2 rounded-md border border-border p-1.5">
              <div className="h-11 w-11 shrink-0 overflow-hidden rounded bg-muted">
                {h.imageUrl ? (
                  <img
                    src={h.imageUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    // Some WINK listings point at a photo that no longer loads.
                    onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
                  />
                ) : (
                  <BedDouble className="m-3 h-5 w-5 text-muted-foreground" aria-hidden />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{h.name}</p>
                <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                  {[h.city, h.country].filter(Boolean).join(", ")}
                  {h.stars ? (
                    <span className="inline-flex items-center gap-0.5" aria-label={`${h.stars} stars`}>
                      <span aria-hidden>·</span>{h.stars}<Star className="h-2.5 w-2.5 fill-current" aria-hidden />
                    </span>
                  ) : null}
                </p>
                {h.fromPrice && <p className="text-xs tabular-nums">{h.fromPrice} a night</p>}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 px-2 text-xs"
                onClick={() => addHotel.mutate(h)}
                disabled={addHotel.isPending}
                data-testid={`button-add-hotel-${h.urlName}`}
              >
                {addHotel.isPending && addHotel.variables?.urlName === h.urlName ? "Adding…" : "Add"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
