import heartIcon from "@assets/WISHLIST_ICON_materialized_saas_1773416652092.png";
// The same chrome heart tinted red, for a saved video (4 Nov 2026): the old
// saved state only brightened the black heart, which barely read as "on".
import heartIconSaved from "@/assets/wishlist-heart-red.png";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface WishlistHeartProps {
  listingId: string;
  wishlisted: boolean;
}

export function WishlistHeart({ listingId, wishlisted }: WishlistHeartProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const addMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/wishlist/${listingId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wishlist"] });
    },
    onError: () => toast({ title: "Could not save to wishlist", variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/wishlist/${listingId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wishlist"] });
    },
    onError: () => toast({ title: "Could not remove from wishlist", variant: "destructive" }),
  });

  const toggle = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (wishlisted) {
      removeMutation.mutate();
    } else {
      addMutation.mutate();
    }
  };

  const isPending = addMutation.isPending || removeMutation.isPending;

  // Pop only when the heart turns red, not for every saved card on page load.
  const wasSaved = useRef(wishlisted);
  const [pop, setPop] = useState(false);
  useEffect(() => {
    if (wishlisted && !wasSaved.current) setPop(true);
    wasSaved.current = wishlisted;
  }, [wishlisted]);

  return (
    <button
      onClick={toggle}
      disabled={isPending}
      data-testid={`wishlist-heart-${listingId}`}
      className="absolute -top-6 -right-6 z-10 w-12 h-12 p-0 border-none bg-transparent cursor-pointer select-none focus:outline-none"
      aria-label={wishlisted ? "Remove from wishlist" : "Add to wishlist"}
      aria-pressed={wishlisted}
    >
      <img
        src={wishlisted ? heartIconSaved : heartIcon}
        alt=""
        className={`w-full h-full object-contain transition-[transform,filter] duration-200 ease-out ${pop && wishlisted ? "wishlist-heart-pop" : ""}`}
        onAnimationEnd={() => setPop(false)}
        style={{
          filter: wishlisted
            ? "drop-shadow(0 3px 6px rgba(190,20,45,.35))"
            : "brightness(0.18) saturate(0)",
          transform: isPending ? "scale(0.85)" : "scale(1)",
        }}
      />
    </button>
  );
}
