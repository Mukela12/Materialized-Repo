import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"
import { useScrollEdges, mergeRefs } from "@/hooks/useScrollEdges"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => {
  const edges = useScrollEdges<HTMLDivElement>()
  const merged = React.useMemo(() => mergeRefs(ref, edges), [ref, edges])
  return (
    <TabsPrimitive.List
      ref={merged}
      className={cn(
        // max-w-full + overflow-x-auto: a tab bar wider than the screen scrolls
        // inside itself. It used to stretch the page (the analytics tabs were
        // 685px on a 375px phone), which also dragged every table below it.
        // justify-start so the first tab is always reachable when it scrolls.
        // scroll-fade: when it does scroll, the hidden side fades out so it
        // reads as "more this way" rather than as clipped.
        // Radius 10px around 4px of padding, so the 6px triggers sit
        // concentric inside it (inner = outer - padding).
        "scroll-fade inline-flex h-10 max-w-full items-center justify-start overflow-x-auto overflow-y-hidden rounded-[10px] bg-muted p-1 text-muted-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
      {...props}
    />
  )
})
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
