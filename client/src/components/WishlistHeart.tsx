import heartIcon from "@assets/WISHLIST_ICON_materialized_saas_1773416652092.png";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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

  return (
    <button
      onClick={toggle}
      disabled={isPending}
      data-testid={`wishlist-heart-${listingId}`}
      className="absolute -top-6 -right-6 z-10 w-12 h-12 p-0 border-none bg-transparent cursor-pointer select-none focus:outline-none"
      aria-label={wishlisted ? "Remove from wishlist" : "Add to wishlist"}
    >
      <img
        src={heartIcon}
        alt="wishlist"
        className="w-full h-full object-contain transition-all duration-300"
        style={{
          filter: wishlisted
            ? "drop-shadow(0 0 10px rgba(220,220,220,0.85)) brightness(1.15)"
            : "brightness(0.18) saturate(0)",
          transform: isPending ? "scale(0.85)" : "scale(1)",
        }}
      />
    </button>
  );
}
