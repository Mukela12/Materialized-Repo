import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const DEFAULT_MESSAGE_TEMPLATE = `Hey [First_Name],

I want to make my recent video for [Brand] shoppable using revolutionary video commerce, so my audience can shop your products instantly.

Click this link to create an account for FREE and sync your inventory. My video will then be published as shoppable with direct links to your POS.

I'm sure you'll love this!

Sincerely,`;
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Users,
  Building,
  TrendingUp,
  Search,
  Filter,
  UserPlus,
  ArrowUpDown,
  Loader2,
  Send,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Brand } from "@shared/schema";

const PRODUCT_CATEGORIES = ["Fashion", "Beauty", "Wellness", "Hotel", "Other"] as const;

const referralFormSchema = z.object({
  brandName: z.string().min(1, "Brand name is required"),
  prContactName: z.string().min(1, "Contact name is required"),
  prContactEmail: z.string().email("Valid email required"),
  productCategory: z.enum(PRODUCT_CATEGORIES, { required_error: "Product category is required" }),
  message: z.string().optional(),
});

type ReferralFormValues = z.infer<typeof referralFormSchema>;

export default function CRMAnalytics() {
  const { toast } = useToast();
  const [isReferralOpen, setIsReferralOpen] = useState(false);

  const { data: brands = [], isLoading } = useQuery<Brand[]>({
    queryKey: ["/api/brands"],
  });

  const form = useForm<ReferralFormValues>({
    resolver: zodResolver(referralFormSchema),
    defaultValues: {
      brandName: "",
      prContactName: "",
      prContactEmail: "",
      productCategory: undefined,
      message: DEFAULT_MESSAGE_TEMPLATE,
    },
  });

  const watchBrandName = form.watch("brandName");
  const watchContactName = form.watch("prContactName");

  useEffect(() => {
    const firstName = watchContactName.split(" ")[0] || "[First_Name]";
    const brandName = watchBrandName || "[Brand]";
    
    const updatedMessage = DEFAULT_MESSAGE_TEMPLATE
      .replace("[First_Name]", firstName)
      .replace("[Brand]", brandName);
    
    form.setValue("message", updatedMessage);
  }, [watchBrandName, watchContactName, form]);

  const referralMutation = useMutation({
    mutationFn: async (data: ReferralFormValues) => {
      const res = await apiRequest("/api/referrals", "POST", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/referrals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/brands"] });
      toast({
        title: "Brand Referral Sent",
        description: "An automated invitation email has been sent to the brand contact.",
      });
      setIsReferralOpen(false);
      form.reset();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to send brand referral. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmitReferral = (data: ReferralFormValues) => {
    referralMutation.mutate(data);
  };

  return (
    <div className="space-y-6 pb-24 md:pb-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">CRM Analytics</h1>
          <p className="text-muted-foreground mt-1">
            Manage brand relationships and track partnership performance
          </p>
        </div>
        <Button 
          className="rounded-full gap-2" 
          onClick={() => setIsReferralOpen(true)}
          data-testid="button-add-contact"
        >
          <UserPlus className="h-4 w-4" />
          Add Contact
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <Building className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{brands.length}</p>
                <p className="text-sm text-muted-foreground">Active Brands</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-chart-2/10 flex items-center justify-center">
                <Users className="h-6 w-6 text-chart-2" />
              </div>
              <div>
                <p className="text-2xl font-bold">0</p>
                <p className="text-sm text-muted-foreground">Total Contacts</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-green-500/10 flex items-center justify-center">
                <TrendingUp className="h-6 w-6 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">$0</p>
                <p className="text-sm text-muted-foreground">Partnership Revenue</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <CardTitle className="text-lg font-semibold">Brand Partners</CardTitle>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search brands..." className="pl-9" />
            </div>
            <Button variant="outline" size="icon">
              <Filter className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[250px]">
                  <Button variant="ghost" size="sm" className="gap-1 -ml-3">
                    Brand
                    <ArrowUpDown className="h-3 w-3" />
                  </Button>
                </TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Videos</TableHead>
                <TableHead>Revenue</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {brands.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Building className="h-8 w-8 opacity-50" />
                      <p>No brand partners yet</p>
                      <p className="text-sm">Start featuring brands in your videos to build partnerships</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                brands.map((brand) => (
                  <TableRow key={brand.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                          {brand.logoUrl ? (
                            <img src={brand.logoUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <Building className="h-5 w-5 text-muted-foreground" />
                          )}
                        </div>
                        <div>
                          <p className="font-medium">{brand.name}</p>
                          {brand.website && (
                            <p className="text-xs text-muted-foreground">{brand.website}</p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {brand.category ? (
                        <Badge variant="secondary">{brand.category}</Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {brand.prContactEmail || "-"}
                    </TableCell>
                    <TableCell>0</TableCell>
                    <TableCell>$0</TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={brand.isActive ? "bg-green-500/20 text-green-600" : ""}
                      >
                        {brand.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isReferralOpen} onOpenChange={setIsReferralOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Refer a Brand
            </DialogTitle>
            <DialogDescription>
              Send an automated invitation email to a brand contact. They'll receive information about joining the video commerce platform.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmitReferral)} className="space-y-4">
              <FormField
                control={form.control}
                name="brandName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Brand Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Nike, Apple" {...field} data-testid="input-brand-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="prContactName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Name</FormLabel>
                    <FormControl>
                      <Input placeholder="PR or Marketing contact" {...field} data-testid="input-contact-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="prContactEmail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Email</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="contact@brand.com" {...field} data-testid="input-contact-email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="productCategory"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Product Category</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-product-category">
                          <SelectValue placeholder="Select a category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PRODUCT_CATEGORIES.map((category) => (
                          <SelectItem key={category} value={category} data-testid={`option-category-${category.toLowerCase()}`}>
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="message"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Personal Message (Optional)</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Add a personal note to your referral..." 
                        className="resize-none" 
                        rows={3}
                        {...field} 
                        data-testid="input-referral-message"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end gap-3 pt-2">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setIsReferralOpen(false)}
                  data-testid="button-cancel-referral"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={referralMutation.isPending}
                  className="gap-2"
                  data-testid="button-send-referral"
                >
                  {referralMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Send Referral
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
